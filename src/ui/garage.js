// GARAJE: menú de videojuego con tu ficha arriba y apartados (récords, historial, duelos,
// ajustes, permisos y datos). En vertical, el apartado ocupa la pantalla con «volver»;
// en horizontal, menú a la izquierda y apartado a la derecha.
import { settings, setSetting, runs, races, bests, deleteRun, totals, wipeAll, saveTotals } from '../core/store.js'
import { marksFor } from '../core/perf.js'
import { T, zeroLean, resetTrip, motionNeedsTap, requestMotion } from '../core/telemetry.js'
import { BIKES } from '../core/physics.js'
import { lobby } from '../core/lobby.js'
import { sfx } from '../core/audio.js'
import { geoPermission, isIOS, isStandalone, screenInfo } from '../core/device.js'
import { APP_VERSION, checkUpdate, updatePending } from '../core/update.js'
import { sendForAnalysis, buildExport, shareFile } from '../core/share.js'
import { logger } from '../core/logger.js'
import { cloud, cloudAvailable, syncNow, syncKey, blackboxLink, onCloud, pairCode } from '../core/cloud.js'
import { $, esc, layer, toast, toSpeed, speedUnit, toDist, distUnit, fmtT, fmtDate, fmtBytes, markLabel } from './util.js'
import { bikeSvg, pixelSvg } from './pixel.js'
import { editRider } from './title.js'
import { RACE_MODES } from '../core/race.js'
import { THEMES, DIGITS, themeOf, themeStyle } from './themes.js'
import { ACHIEVEMENTS, TIERS, unlocked, progress, stats, level } from '../core/achievements.js'
import { voiceAvailable, systemVoiceAvailable, voiceEngine, spanishVoices, VOICE_EVENTS, VOICE_DEFAULTS, SPEED_STEPS, say, MUSIC_MODES, audioSessionAvailable } from '../core/voice.js'
import { medalSvg } from './medals.js'

const ARROW = pixelSvg(['X....', 'XX...', 'XXX..', 'XXXX.', 'XXX..', 'XX...', 'X....'], { X: 'currentColor' }, { className: 'px-arrow' })
const BACK = pixelSvg(['....X', '...XX', '..XXX', '.XXXX', '..XXX', '...XX', '....X'], { X: 'currentColor' }, { className: 'px-arrow' })

const headMark = () => (settings.units === 'mph' ? 'm0-60' : 'k0-100')

const ITEMS = [
  {
    id: 'records',
    title: 'RECORDS',
    sub: () => {
      const b = bests()
      const parts = [headMark(), '1/4'].filter((id) => b[id]).map((id) => `${markLabel(id).replace(/ (KM\/H|MPH)$/, '')} ${fmtT(b[id].t)}`)
      return parts.length ? parts.join(' · ') : 'Sin marcas todavía'
    },
  },
  { id: 'history', title: 'HISTORIAL', sub: () => (runs.length ? `${runs.length} ${runs.length === 1 ? 'pasada' : 'pasadas'}` : 'Vacío') },
  {
    id: 'duels',
    title: 'DUELOS',
    sub: () => {
      const w = races.filter((r) => r.win).length
      return races.length ? `${w} ganados · ${races.length - w} perdidos` : 'Ninguno todavía'
    },
  },
  {
    id: 'trophies',
    title: 'LOGROS',
    sub: () => {
      const lv = level()
      return `Nivel ${lv.n} · ${lv.rank.toLowerCase()} · ${ACHIEVEMENTS.filter((a) => unlocked[a.id]).length}/${ACHIEVEMENTS.length}`
    },
  },
  { id: 'voice', title: 'VOZ', sub: () => (settings.voice ? 'Te habla por el casco' : 'Apagada') },
  { id: 'look', title: 'APARIENCIA', sub: () => `Tema ${themeOf(settings.theme).name.toLowerCase()} · pantallas del DASH` },
  { id: 'settings', title: 'AJUSTES', sub: () => 'Unidades, sonido, crono, radar' },
  { id: 'perms', title: 'PERMISOS', sub: () => (T.status === 'ok' ? 'GPS OK' : 'GPS sin señal') + (T.motion ? ' · movimiento OK' : '') },
  { id: 'data', title: 'DATOS', sub: () => (settings.logTelemetry ? 'Telemetría guardándose · exportar' : 'Telemetría apagada · exportar') },
  { id: 'about', title: 'VERSION', sub: () => `${APP_VERSION.split(' ')[0]} · buscar actualización` },
]

export function mountGarage(el, { applySource, editDash = () => {} }) {
  let sub = null
  let geo = 'unknown'
  const landscape = matchMedia('(orientation: landscape)')
  landscape.addEventListener('change', () => render())

  function render() {
    // En horizontal siempre hay un apartado abierto a la derecha
    const page = sub || (landscape.matches ? 'records' : null)
    const item = ITEMS.find((i) => i.id === page)
    el.innerHTML = `
      <div class="g-wrap ${page ? 'has-page' : ''} ${sub ? 'in-sub' : ''}">
        <div class="g-side">
          <div class="panel me-card">
            ${bikeSvg(settings.color)}
            <div class="me-who"><b>${esc(settings.name || 'PILOTO')}</b><span>${esc(settings.bike || 'Sin moto')}</span>${lvBadge()}<button class="btn small" data-act="edit">EDITAR</button></div>
          </div>
          <nav class="panel menu">
            ${ITEMS.map((i) => `<button class="mi ${page === i.id ? 'on' : ''}" data-sub="${i.id}"><span class="cur">${ARROW}</span><span class="mi-t">${i.title}</span><span class="mi-s">${esc(i.sub())}</span></button>`).join('')}
          </nav>
          <p class="g-safe">Las carreras, en circuito o pista cerrada.</p>
        </div>
        ${
          page
            ? `<section class="panel g-page">
                <header class="g-head">
                  <button class="back" data-back aria-label="Volver al menú">${BACK}<span>VOLVER</span></button>
                  <h3>${item.title}</h3>
                </header>
                <div class="g-body">${PAGES[page]()}</div>
              </section>`
            : ''
        }
      </div>`
    if (page === 'data') fillTele()
  }

  // El resumen de la caja negra se lee de IndexedDB (asíncrono)
  async function fillTele() {
    const L = logger()
    const txt = $(el, '[data-k="tele"]')
    const badge = $(el, '[data-k="teleState"]')
    if (!txt) return
    if (!L) {
      txt.textContent = 'Este navegador no deja guardarla'
      return
    }
    const sum = await L.summary()
    const est = await navigator.storage?.estimate?.().catch(() => null)
    if (!txt.isConnected) return
    const left = est?.quota ? est.quota - est.usage : null
    const free = left == null ? '' : ` · ${fmtBytes(Math.max(0, left))} libres`
    txt.textContent = sum.sessions
      ? `${sum.sessions} ${sum.sessions === 1 ? 'salida' : 'salidas'} · ${toDist(sum.dist).toFixed(1)} ${distUnit()} · ${fmtBytes(sum.bytes)}${free}`
      : 'Aún vacía: empieza a grabar sola al pasar de 9 km/h'
    if (sum.error) txt.textContent += ` · ERROR: ${sum.error}`
    badge.innerHTML = !settings.logTelemetry ? state('APAGADA', 'off') : sum.recording ? state('GRABANDO', 'on') : state('EN ESPERA', '')
    const nube = $(el, '[data-k="cloud"]')
    if (nube) {
      cloud.pending = sum.pending
      nube.textContent = !cloudAvailable()
        ? 'Esta versión no tiene servidor'
        : !settings.cloudSync
          ? 'Apagada: solo se guarda en el móvil'
          : cloud.busy
            ? `Subiendo… quedan ${cloud.pending}`
            : cloud.error
              ? `No se pudo subir (${cloud.error}). Se reintenta sola.`
              : sum.pending
                ? `${sum.pending} ${sum.pending === 1 ? 'salida pendiente' : 'salidas pendientes'}: se suben al cerrar cada salida y al abrir la app`
                : `Todo subido${cloud.last ? ` (${new Date(cloud.last).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })})` : ''}`
    }
  }
  // Mientras se ve la página, el estado de la subida al día
  onCloud(() => sub === 'data' && fillTele())

  const lvBadge = () => {
    const lv = level()
    return `<button class="lv-badge" data-sub="trophies"><span>NV ${lv.n} · ${lv.rank}</span><i><b style="width:${Math.round(lv.frac * 100)}%"></b></i></button>`
  }
  const onOff = (key, label, small = '') =>
    `<div class="set"><span>${label}${small ? `<small>${small}</small>` : ''}</span><button class="chip ${settings[key] ? 'on' : ''}" data-toggle="${key}">${settings[key] ? 'SI' : 'NO'}</button></div>`
  const pick = (key, label, opts, small = '') =>
    `<div class="set"><span>${label}${small ? `<small>${small}</small>` : ''}</span><div class="chips">${opts
      .map(([v, l]) => `<button class="chip ${String(settings[key]) === String(v) ? 'on' : ''}" data-pick="${key}" data-v="${v}">${l}</button>`)
      .join('')}</div></div>`
  const group = (title, body) => `<div class="group"><h4 class="lbl">${title}</h4>${body}</div>`
  const state = (txt, cls) => `<span class="badge ${cls}">${txt}</span>`

  const PAGES = {
    records() {
      const b = bests()
      return `<div class="records">
        ${marksFor(settings.units)
          .map((m) => {
            const r = b[m.id]
            return `<div class="rec"><span class="lbl">${markLabel(m.id)}</span><b>${r ? fmtT(r.t) : '--.--'}</b><span>${r ? (r.v != null ? `@ ${Math.round(toSpeed(r.v))} ${speedUnit()} · ` : '') + fmtDate(r.date) : 'sin marca'}</span></div>`
          })
          .join('')}
        <div class="rec"><span class="lbl">PUNTA</span><b>${Math.round(toSpeed(totals.maxV))}</b><span>${speedUnit()}</span></div>
        <div class="rec"><span class="lbl">INCLINACION</span><b>${Math.round(totals.maxLeanL)}° ${Math.round(totals.maxLeanR)}°</b><span>izq · der</span></div>
        <div class="rec"><span class="lbl">FUERZA G</span><b>${totals.maxG.toFixed(2)}</b><span>máxima</span></div>
        <div class="rec"><span class="lbl">TOTAL</span><b>${Math.round(toDist(totals.odo))}</b><span>${distUnit()} con la app</span></div>
      </div>`
    },
    history() {
      const marks = marksFor(settings.units)
      if (!runs.length) return '<p class="empty-note">Haz tu primera pasada en CRONO.</p>'
      return `<div class="hist">${runs
        .slice(0, 60)
        .map((r) => {
          const head = marks.find((m) => r.marks[m.id] && m.id === headMark()) || marks.find((m) => r.marks[m.id])
          return `<button data-run="${r.id}"><span><span class="lbl">${fmtDate(r.date)}${r.race ? ' · DUELO' : ''}</span><br>${head ? markLabel(head.id) : ''} · punta ${Math.round(toSpeed(r.maxV))}</span><b>${head ? fmtT(r.marks[head.id].t) : '--'}</b></button>`
        })
        .join('')}</div>`
    },
    duels() {
      const w = races.filter((r) => r.win).length
      return `<div class="wl"><span class="w">${w} GANADOS</span><span class="l">${races.length - w} PERDIDOS</span></div>
        <div class="hist">${
          races
            .slice(0, 30)
            .map(
              (r) => `<div class="hist-row"><span><span class="lbl" style="color:${r.win ? 'var(--green)' : 'var(--red)'}">${r.win ? 'VICTORIA' : 'DERROTA'}${RACE_MODES[r.mode] ? ' · ' + r.mode.toUpperCase() : ''}</span><br>vs ${esc(r.opp.name)} · ${fmtDate(r.date)}</span><b>${r.me.dnf ? 'DNF' : fmtT(r.me.rt + r.me.et, 3)}</b></div>`,
            )
            .join('') || '<p class="empty-note">Aún no has corrido ningún duelo. Ve a VS.</p>'
        }</div>`
    },
    settings() {
      return [
        group('SONIDO', onOff('sound', 'Sonido', 'Pitidos del árbol y avisos')),
        group('UNIDADES', pick('units', 'Velocidad y distancia', [['kmh', 'KM/H'], ['mph', 'MPH']])),
        group('CRONO', onOff('rollout', 'Rollout 1 pie', 'Como en pista: el crono empieza a los 30 cm')),
        group(
          'INCLINOMETRO',
          `<div class="set"><span>Poner a 0<small>Con la moto recta y parada. Se guarda: solo hay que repetirlo si cambias el soporte. Atajo: mantén pulsado el inclinómetro en el DASH.</small></span><button class="btn small cyan" data-act="zero">PONER A 0</button></div>`,
        ),
        group(
          'RADAR',
          onOff('visible', 'Visible en el radar', 'Otros pilotos con la app te ven (posición redondeada a ~10 m)') +
            pick('radius', 'Radio de rivales', [[500, '0.5 KM'], [1500, '1.5 KM'], [3000, '3 KM']]) +
            `<div class="set"><span>Servidor<small>${lobby.kind === 'online' ? 'Retos entre móviles' : 'Solo pestañas de este navegador'}</small></span>${state(lobby.kind === 'online' ? 'ONLINE' : 'LOCAL', lobby.kind === 'online' ? 'on' : '')}</div>`,
        ),
        group(
          'TELEMETRIA',
          onOff('logTelemetry', 'Caja negra', 'Guarda sola el GPS y los sensores de cada salida, solo en este móvil, para analizarlos después en el ordenador. No se ve en la app.'),
        ),
        group('VIAJE', `<div class="set"><span>Reiniciar viaje<small>Viaje, punta, inclinación y G de esta sesión</small></span><button class="btn small ghost" data-act="trip">REINICIAR</button></div>`),
        group(
          'GPS',
          pick('source', 'Fuente', [['real', 'REAL'], ['sim', 'SIMULADOR']], 'El simulador sirve para probar sin moverte') +
            (settings.source === 'sim'
              ? pick('simHz', 'GPS simulado', [[1, '1 HZ'], [5, '5 HZ'], [10, '10 HZ']], 'Los móviles suelen dar 1 Hz') +
                pick('simBike', 'Moto simulada', Object.values(BIKES).map((b) => [b.id, b.name.split(' ')[0]]))
              : ''),
        ),
      ].join('')
    },
    trophies() {
      const lv = level()
      const s = stats()
      const got = ACHIEVEMENTS.filter((a) => unlocked[a.id]).length
      const CATS = [
        ['km', 'DISTANCIA'],
        ['time', 'TIEMPO'],
        ['night', 'NOCHE'],
        ['speed', 'VELOCIDAD'],
        ['lean', 'INCLINACION'],
        ['g', 'FUERZA G'],
        ['crono', 'CRONO'],
        ['duel', 'DUELOS'],
        ['box', 'CAJA NEGRA'],
      ]
      const fmt = (a, v) => (v == null ? '—' : a.unit === 's' ? v.toFixed(2) : a.unit === 'g' ? v.toFixed(2) : a.unit === 'h' ? v.toFixed(1) : String(Math.floor(v)))
      const card = (a) => {
        const [v, goal, done] = progress(a, s)
        const frac = done ? 1 : a.less ? (v == null ? 0 : Math.max(0, Math.min(1, goal / v))) : Math.max(0, Math.min(1, (v ?? 0) / goal))
        return `<div class="trophy ${done ? 'got' : ''} t-${a.tier}">
          ${medalSvg(a.cat, a.tier, !done)}
          <div class="tr-txt"><b>${esc(a.title)}</b><small>${esc(a.desc)}</small>
          ${done ? `<span class="tr-when">${TIERS[a.tier].name} · ${fmtDate(unlocked[a.id] || Date.now())}</span>` : `<span class="tr-bar"><i style="width:${Math.round(frac * 100)}%"></i></span><span class="tr-prog">${fmt(a, v)} / ${a.less ? '<' : ''}${goal} ${a.unit}</span>`}</div>
        </div>`
      }
      return `<div class="lv-card">
          ${medalSvg('star', lv.n >= 9 ? 'g' : lv.n >= 5 ? 's' : 'b', false, 'medal big')}
          <div><span class="lbl">NIVEL ${lv.n}</span><b>${lv.rank}</b>
          <span class="tr-bar"><i style="width:${Math.round(lv.frac * 100)}%"></i></span>
          <small>${lv.xp} XP${lv.to ? ` · ${lv.to - lv.xp} para el nivel ${lv.n + 1}` : ' · nivel máximo'} · ${got}/${ACHIEVEMENTS.length} logros</small></div>
        </div>
        <p class="tip">La experiencia sale de los logros (bronce 10, plata 25, oro 50), de cada km, de cada pasada (3) y de cada duelo ganado (8). Los de inclinación, G y crono, en circuito.</p>
        ${CATS.map(([c, name]) => {
          const list = ACHIEVEMENTS.filter((a) => a.cat === c)
          return list.length ? group(name, `<div class="trophies">${list.map(card).join('')}</div>`) : ''
        }).join('')}`
    },
    voice() {
      if (!voiceAvailable()) return '<p class="empty-note">Este navegador no tiene voz.</p>'
      const ev = { ...VOICE_DEFAULTS, ...settings.voiceEvents }
      const voices = spanishVoices()
      const steps = SPEED_STEPS[settings.units === 'mph' ? 'mph' : 'kmh']
      const alerts = settings.speedAlerts || []
      return [
        group(
          'VOZ',
          onOff('voice', 'Que la app hable', 'Suena por donde suene el móvil: el intercomunicador del casco si está conectado') +
            (systemVoiceAvailable()
              ? pick(
                  'voiceEngine',
                  'Voz',
                  [
                    ['app', 'DE LA APP'],
                    ['system', 'DEL MOVIL'],
                  ],
                  voiceEngine() === 'app' ? 'Grabada para la app: deja sonar la música a la vez' : 'La del móvil: más natural, pero en el iPhone para la música mientras habla',
                )
              : '') +
            (voiceEngine() === 'system'
              ? (voices.length > 1
                  ? `<div class="set"><span>Voz del móvil<small>Las voces en español de tu móvil</small></span><select class="vsel" data-k="voiceName">${voices.map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === settings.voiceName ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</select></div>`
                  : '') +
                pick('voiceRate', 'Rapidez', [
                  [0.9, 'LENTA'],
                  [1.05, 'NORMAL'],
                  [1.25, 'RAPIDA'],
                ])
              : audioSessionAvailable()
                ? pick(
                    'voiceMusic',
                    'Con música',
                    Object.entries(MUSIC_MODES).map(([k, [, l]]) => [k, l]),
                    `${(MUSIC_MODES[settings.voiceMusic] || MUSIC_MODES.duck)[2]}. Con el móvil en silencio, iOS puede callarla`,
                  )
                : '') +
            `<div class="set"><span>Probar<small>Si no oyes nada, sube el volumen del móvil o del casco</small></span><button class="btn small cyan" data-act="voiceTest">PROBAR</button></div>`,
        ),
        group('QUE DICE', VOICE_EVENTS.map(([k, label, small]) => `<div class="set"><span>${label}<small>${small}</small></span><button class="chip ${ev[k] ? 'on' : ''}" data-vev="${k}">${ev[k] ? 'SI' : 'NO'}</button></div>`).join('')),
        group(
          'AVISOS DE VELOCIDAD',
          `<p class="tip">Dice la velocidad al pasar de cada una que marques (sube y vuelve a avisar al bajar 5 por debajo).</p><div class="chips">${steps.map((v) => `<button class="chip ${alerts.includes(v) ? 'on' : ''}" data-alert="${v}">${v}</button>`).join('')}</div>`,
        ),
      ].join('')
    },
    about() {
      const i = screenInfo()
      const row = (k, v) => `<div class="set"><span>${k}</span><b class="mono">${esc(v)}</b></div>`
      return [
        group(
          'VERSION',
          `<div class="set"><span>Esta app<small>Commit y fecha de la versión que tienes abierta</small></span><b class="mono">${esc(APP_VERSION)}</b></div>
           <div class="set"><span>Buscar actualización<small>Se actualiza sola al volver a la app con la moto parada; esto lo mira ya</small></span><button class="btn small cyan" data-act="update">BUSCAR</button></div>`,
        ),
        group(
          'PANTALLA',
          `<p class="tip">Si algo no encaja en la pantalla, haz una captura de esto y pásamela.</p>` +
            row('Ventana', i.inner) +
            row('Pantalla', i.screen) +
            row('100lvh / 100dvh', `${i.lvh} / ${i.dvh}`) +
            row('Visible', String(i.vv)) +
            row('Alto usado', i.appH) +
            row('Márgenes', i.safe) +
            row('Modo', `${i.mode}${i.standalone ? ' · instalada' : ''}`),
        ),
      ].join('')
    },
    look() {
      const bar = '<i class="g"></i><i class="g"></i><i class="g"></i><i class="g"></i><i class="g"></i><i class="y"></i><i class="y"></i><i class="r"></i><i></i><i></i>'
      const pages = settings.dashPages || []
      return [
        group(
          'TEMA',
          `<div class="themes">${THEMES.map(
            (t) => `<button class="theme-card ${settings.theme === t.id ? 'on' : ''}" data-theme="${t.id}" style="${themeStyle(t)}">
              <div class="tc-dash"><div class="tc-top"><span class="tc-speed">124</span><span class="tc-unit">KM/H</span></div><div class="tc-bar">${bar}</div><div class="tc-stats"><span>INCL <b>32°</b></span><span>G <b>0.8</b></span></div></div>
              <span class="tc-name">${t.name}</span><span class="tc-desc">${esc(t.desc)}</span>
            </button>`,
          ).join('')}</div>`,
        ),
        group(
          'NUMEROS DEL DASH',
          `<div class="digit-opts">${DIGITS.map((d) => `<button class="digit-opt ${(settings.digits || 'lcd') === d.id ? 'on' : ''}" data-digits="${d.id}"><span class="sample ${d.id}">${d.id === 'pixel' ? '87' : '87'}</span><b>${d.name}</b></button>`).join('')}</div>`,
        ),
        group(
          'DETALLES',
          onOff('accentBike', 'Color de tu moto como acento', 'Los botones y rótulos con el color que elegiste en tu piloto') + onOff('crt', 'Efecto CRT', 'Líneas de tubo de televisor; quítalo si cuesta leer al sol'),
        ),
        group(
          'PANTALLAS DEL DASH',
          `<div class="set look-dash"><span>${pages.length || 3} pantallas<small>Desliza en el DASH para cambiar de una a otra. Elige qué bloques ves, su tamaño y su sitio.</small></span><button class="btn small cyan" data-act="editDash">EDITAR</button></div>`,
        ),
      ].join('')
    },
    perms() {
      const geoTxt =
        geo === 'granted' ? state('CONCEDIDO', 'on') : geo === 'denied' ? state('DENEGADO', 'off') : T.status === 'ok' ? state('FUNCIONA', 'on') : state('PREGUNTA', '')
      const motionTxt = T.motion
        ? state('ACTIVO', 'on')
        : T.motionPerm === 'denied'
          ? state('DENEGADO', 'off')
          : motionNeedsTap() || T.motionPerm === 'granted'
            ? `<button class="btn small cyan" data-act="motion">ACTIVAR</button>`
            : state('SIN SENSOR', 'off')
      const motionHelp =
        T.motionPerm === 'denied'
          ? `<div class="tip">Le dijiste que no al movimiento. iOS no vuelve a preguntar hasta que cierres la app del todo: desliza hacia arriba desde abajo, quítala del selector de apps, ábrela otra vez y toca <b>ACTIVAR</b> aquí; cuando pregunte, elige <b>Permitir</b>.</div>`
          : !T.motion && T.motionPerm === 'granted'
            ? '<div class="tip">Tiene permiso pero no llegan datos del sensor. Cierra la app del todo y vuelve a abrirla.</div>'
            : ''
      const ios = isIOS()
      const steps = ios
        ? `<li>${isStandalone() ? 'Ya la tienes en la pantalla de inicio: bien.' : 'Añádela a la pantalla de inicio: <b>Compartir → Añadir a pantalla de inicio</b>. Instalada recuerda mejor los permisos y va a pantalla completa.'}</li>
           <li>Ubicación: cuando pregunte, elige <b>Permitir al usar la app</b>. «Permitir una vez» hace que vuelva a preguntar.</li>
           <li>En Safari (sin instalar): <b>aA → Configuración del sitio web → Ubicación → Permitir</b>.</li>
           <li>Movimiento: iOS lo pregunta al tocar la pantalla (o con <b>ACTIVAR</b>). Elige <b>Permitir</b>. Si vuelve a preguntar otro día, es cosa de iOS con las webs: basta con aceptar.</li>`
        : `<li>Ubicación: cuando pregunte, elige <b>Permitir</b> (o «Mientras se usa la app»). Chrome lo recuerda.</li>
           <li>Si la bloqueaste: <b>candado de la barra de direcciones → Permisos → Ubicación → Permitir</b>.</li>
           <li>Instálala con <b>⋮ → Añadir a pantalla de inicio</b> para abrirla a pantalla completa.</li>`
      return `
        <div class="set"><span>Ubicación (GPS)<small>Para la velocidad, el crono y el radar</small></span>${geoTxt}</div>
        <div class="set"><span>Movimiento<small>Inclinación, fuerza G y detección de salida</small></span>${motionTxt}</div>
        ${motionHelp}
        <div class="set"><span>Pantalla encendida<small>Que no se apague en marcha</small></span>${'wakeLock' in navigator ? state('SI', 'on') : state('NO', 'off')}</div>
        <div class="set"><span>Instalada<small>Abierta desde la pantalla de inicio</small></span>${isStandalone() ? state('SI', 'on') : state('NO', '')}</div>
        <h4 class="lbl" style="margin-top:14px">PARA QUE NO VUELVA A PREGUNTAR</h4>
        <ol class="steps">${steps}</ol>`
    },
    data() {
      return `
        ${group(
          'TELEMETRIA',
          `<div class="set"><span>Caja negra<small data-k="tele">Mirando lo guardado…</small></span><span data-k="teleState">${settings.logTelemetry ? state('EN ESPERA', '') : state('APAGADA', 'off')}</span></div>
           <div class="set"><span>Exportar todo<small>Archivo .json con la telemetría, las pasadas y los duelos. Pásalo al ordenador (AirDrop, Drive, correo) y suéltalo en <b>${esc(location.host + import.meta.env.BASE_URL)}</b> abierto en el ordenador</small></span><button class="btn small cyan" data-act="export">EXPORTAR</button></div>
           <div class="set"><span>Subir a la nube<small data-k="cloud">…</small></span><button class="chip ${settings.cloudSync ? 'on' : ''}" data-toggle="cloudSync">${settings.cloudSync ? 'SI' : 'NO'}</button></div>
           ${cloudAvailable() ? `<div class="set"><span>Vincular el ordenador<small>Abre ${esc(location.host + import.meta.env.BASE_URL)} en el ordenador y escribe el código que sale aquí: verás tus salidas, tus récords y tu tema. Quien tenga el código o la clave puede ver tus salidas.</small></span><button class="btn small cyan" data-act="bbPair">VINCULAR</button></div>
           <div class="set"><span>Enlace al ordenador<small>Otra forma: mándate el enlace con la clave de este móvil (${esc(syncKey())}) por AirDrop o correo</small></span><button class="btn small ghost" data-act="bbLink">ENLACE</button></div>` : ''}
           <div class="set"><span>Borrar telemetría<small>Del móvil (lo subido sigue en la nube). Para liberar espacio</small></span><button class="btn small ghost" data-act="wipeTele">BORRAR</button></div>`,
        )}
        ${group(
          'PASADAS Y DUELOS',
          `<p class="empty-note">Tienes <b>${runs.length}</b> ${runs.length === 1 ? 'pasada' : 'pasadas'} y <b>${races.length}</b> ${races.length === 1 ? 'duelo' : 'duelos'} guardados en este móvil.</p>
           <div class="set"><span>Enviar para análisis<small>Tiempos, velocidades y precisión del GPS de cada pasada, sin tu posición ni la telemetría. Solo se pueden leer desde el proyecto, no desde la web.</small></span><button class="btn small green" data-act="send" ${lobby.kind === 'online' ? '' : 'disabled'}>ENVIAR</button></div>
           <div class="set"><span>Borrar datos<small>Historial, duelos y récords de este móvil</small></span><button class="btn small ghost" data-act="wipe">BORRAR</button></div>`,
        )}`
    },
  }

  // Las voces del móvil llegan un poco después de abrir la app
  if (systemVoiceAvailable()) speechSynthesis.addEventListener?.('voiceschanged', () => sub === 'voice' && render())

  el.addEventListener('change', (e) => {
    if (e.target.dataset.k === 'voiceName') {
      setSetting('voiceName', e.target.value)
      say('Así suena esta voz', { force: true, urgent: true })
    }
  })

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button')
    if (!b) return
    sfx.click()
    if (b.dataset.sub) {
      sub = b.dataset.sub
      if (sub === 'perms') geo = await geoPermission()
      render()
      el.querySelector('.g-page')?.classList.add('enter')
      el.scrollTop = 0
      return
    }
    if (b.hasAttribute('data-back')) {
      sub = null
      render()
      return
    }
    if (b.dataset.toggle) {
      setSetting(b.dataset.toggle, !settings[b.dataset.toggle])
    } else if (b.dataset.vev) {
      setSetting('voiceEvents', { ...VOICE_DEFAULTS, ...settings.voiceEvents, [b.dataset.vev]: !({ ...VOICE_DEFAULTS, ...settings.voiceEvents }[b.dataset.vev]) })
    } else if (b.dataset.alert) {
      const v = Number(b.dataset.alert)
      const list = settings.speedAlerts || []
      setSetting('speedAlerts', list.includes(v) ? list.filter((x) => x !== v) : [...list, v].sort((x, y) => x - y))
    } else if (b.dataset.act === 'voiceTest') {
      if (!say('Cero a cien en tres coma nueve segundos. ¡Récord!', { force: true, urgent: true })) toast('ESTE NAVEGADOR NO TIENE VOZ')
      return
    } else if (b.dataset.theme) {
      setSetting('theme', b.dataset.theme)
      // Al sol, sin las líneas de tubo (se pueden volver a poner)
      if (themeOf(b.dataset.theme).light && settings.crt) setSetting('crt', false)
    } else if (b.dataset.digits) {
      setSetting('digits', b.dataset.digits)
    } else if (b.dataset.act === 'editDash') {
      editDash()
      return
    } else if (b.dataset.pick) {
      const key = b.dataset.pick
      const raw = b.dataset.v
      setSetting(key, ['radius', 'simHz', 'voiceRate'].includes(key) ? Number(raw) : raw)
      if (['source', 'simHz', 'simBike'].includes(key)) applySource()
    } else if (b.dataset.act === 'motion') {
      // Este clic es un toque de verdad: iOS enseña la pregunta del permiso
      const ok = await requestMotion()
      await new Promise((r) => setTimeout(r, 400)) // que lleguen los primeros datos
      toast(ok ? (T.motion ? 'MOVIMIENTO ACTIVADO' : 'PERMISO DADO: MUEVE EL MOVIL') : T.motionPerm === 'denied' ? 'MOVIMIENTO DENEGADO' : 'NO SE PUDO ACTIVAR', 3500)
    } else if (b.dataset.act === 'zero') {
      toast(zeroLean() ? 'INCLINOMETRO A 0' : T.motionPerm === 'denied' ? 'MOVIMIENTO DENEGADO: MIRA PERMISOS' : 'ACTIVA EL MOVIMIENTO EN PERMISOS')
    } else if (b.dataset.act === 'trip') {
      resetTrip()
      toast('VIAJE REINICIADO')
    } else if (b.dataset.act === 'edit') {
      editRider(() => render())
      return
    } else if (b.dataset.act === 'send') {
      b.disabled = true
      b.textContent = '...'
      const r = await sendForAnalysis()
      toast(r.ok ? 'DATOS ENVIADOS. YA PUEDES PEDIR EL ANALISIS' : `NO SE PUDO ENVIAR: ${r.error}`, 4000)
      if (!r.ok) sfx.error()
    } else if (b.dataset.act === 'export') {
      b.disabled = true
      b.textContent = '...'
      try {
        exportReady(await buildExport())
      } catch (err) {
        sfx.error()
        toast(`NO SE PUDO EXPORTAR: ${err?.message || err}`, 4000)
      }
    } else if (b.dataset.act === 'update') {
      b.disabled = true
      b.textContent = '...'
      const has = await checkUpdate()
      if (has) {
        // Se espera a que la versión nueva acabe de bajar (como mucho 20 s) y se recarga
        toast('BAJANDO LA VERSION NUEVA…', 20000)
        const t0 = Date.now()
        const wait = setInterval(() => {
          if (updatePending() || Date.now() - t0 > 20000) {
            clearInterval(wait)
            location.reload()
          }
        }, 500)
      } else {
        toast('YA TIENES LA ULTIMA VERSION')
        b.disabled = false
        b.textContent = 'BUSCAR'
      }
      return
    } else if (b.dataset.act === 'bbPair') {
      pairDialog()
      return
    } else if (b.dataset.act === 'bbLink') {
      const url = blackboxLink()
      try {
        if (navigator.share) await navigator.share({ title: 'Blackbox · Street Chaos', url })
        else {
          await navigator.clipboard.writeText(url)
          toast('ENLACE COPIADO')
        }
      } catch (err) {
        if (err?.name !== 'AbortError') {
          await navigator.clipboard?.writeText(url).catch(() => {})
          toast('ENLACE COPIADO')
        }
      }
      return
    } else if (b.dataset.act === 'wipeTele') {
      if (confirm('¿Borrar toda la telemetría guardada en este móvil? No se puede deshacer: expórtala antes si la quieres.')) {
        await logger()?.wipe()
        toast('TELEMETRIA BORRADA')
      }
    } else if (b.dataset.act === 'wipe') {
      if (confirm('¿Borrar historial, duelos y récords? No se puede deshacer.')) {
        wipeAll()
        saveTotals(true)
        resetTrip()
        toast('DATOS BORRADOS')
      }
    } else if (b.dataset.run) {
      const r = runs.find((x) => x.id === b.dataset.run)
      if (r) showRun(r, render)
      return
    }
    render()
  })

  return {
    show: render,
    hide() {
      sub = null
    },
    frame() {},
  }
}

/** Código para vincular el ordenador, en grande y con lo que le queda. */
function pairDialog() {
  const el = layer(
    `<div class="panel modal pair">
      <h2 class="title">VINCULAR ORDENADOR</h2>
      <p class="tip" style="text-align:center">En el ordenador abre <b>${esc(location.host + import.meta.env.BASE_URL)}</b> y escribe:</p>
      <div class="pair-code" data-k="code">······</div>
      <p class="tip" style="text-align:center" data-k="left">Pidiendo código…</p>
      <div class="actions"><button class="btn small" data-k="close">LISTO</button></div>
    </div>`,
  )
  let timer = null
  const close = () => (clearInterval(timer), el.remove())
  $(el, '[data-k="close"]').onclick = () => (sfx.click(), close())
  pairCode()
    .then(({ code, expires }) => {
      if (!el.isConnected) return
      $(el, '[data-k="code"]').textContent = `${code.slice(0, 3)} ${code.slice(3)}`
      const end = new Date(expires).getTime()
      const tickLeft = () => {
        const s = Math.max(0, Math.round((end - Date.now()) / 1000))
        $(el, '[data-k="left"]').textContent = s ? `Vale ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} y una sola vez` : 'Caducado: vuelve a pedirlo'
        if (!s) clearInterval(timer)
      }
      tickLeft()
      timer = setInterval(tickLeft, 1000)
    })
    .catch((err) => {
      if (!el.isConnected) return
      sfx.error()
      $(el, '[data-k="left"]').textContent = navigator.onLine ? `No se pudo: ${err?.message || err}` : 'Sin conexión: conéctate y vuelve a probar'
    })
}

function exportReady(file) {
  const el = layer(
    `<div class="panel modal">
      <h2 class="title">ARCHIVO LISTO</h2>
      <p class="tip" style="text-align:center">${esc(file.name)}<br><b>${fmtBytes(file.size)}</b></p>
      <div class="actions">
        <button class="btn ghost small" data-k="close">CERRAR</button>
        <button class="btn cyan" data-k="share">GUARDAR</button>
      </div>
    </div>`,
  )
  $(el, '[data-k="close"]').onclick = () => (sfx.click(), el.remove())
  $(el, '[data-k="share"]').onclick = async () => {
    sfx.click()
    if (await shareFile(file)) el.remove()
  }
}

function showRun(r, onChange) {
  const marks = marksFor(settings.units).filter((m) => r.marks[m.id])
  const el = layer(
    `<div class="modal" style="padding:0">
      <div class="slip" style="font-size:19px">
        <h4>TICKET · ${fmtDate(r.date)}</h4>
        ${marks.map((m) => `<div class="r"><span>${markLabel(m.id)}</span><b>${fmtT(r.marks[m.id].t)}${r.marks[m.id].v != null ? ` @${Math.round(toSpeed(r.marks[m.id].v))}` : ''}</b></div>`).join('')}
        <div class="r"><span>PUNTA</span><b>${Math.round(toSpeed(r.maxV))}</b></div>
        <div class="r"><span>DISTANCIA</span><b>${Math.round(r.dist)} M</b></div>
        <div class="r"><span>ACEL MÁX</span><b>${r.peakG.toFixed(2)} G</b></div>
        <div class="r"><span>GPS</span><b>${r.hz.toFixed(1)} HZ ±${Math.round(r.accMax)}</b></div>
        ${r.slope != null ? `<div class="r"><span>PENDIENTE</span><b>${r.slope.toFixed(1)}%</b></div>` : ''}
        <div class="r"><span>ROLLOUT</span><b>${r.rollout ? 'SÍ' : 'NO'}</b></div>
      </div>
      <div class="actions" style="margin-top:14px">
        <button class="btn ghost small" data-k="del">BORRAR</button>
        <button class="btn small" data-k="ok">CERRAR</button>
      </div>
    </div>`,
  )
  $(el, '[data-k="ok"]').onclick = () => (sfx.click(), el.remove())
  $(el, '[data-k="del"]').onclick = () => {
    sfx.click()
    deleteRun(r.id)
    el.remove()
    onChange()
  }
}
