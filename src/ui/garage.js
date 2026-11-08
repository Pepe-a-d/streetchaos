// GARAJE: menú de videojuego con tu ficha arriba y apartados (récords, historial, duelos,
// ajustes, permisos y datos). En vertical, el apartado ocupa la pantalla con «volver»;
// en horizontal, menú a la izquierda y apartado a la derecha.
import { settings, setSetting, runs, races, bests, deleteRun, totals, wipeAll, saveTotals } from '../core/store.js'
import { marksFor } from '../core/perf.js'
import { T, zeroLean, resetTrip, motionNeedsTap } from '../core/telemetry.js'
import { BIKES } from '../core/physics.js'
import { lobby } from '../core/lobby.js'
import { sfx } from '../core/audio.js'
import { geoPermission, isIOS, isStandalone } from '../core/device.js'
import { sendForAnalysis, buildExport, shareFile } from '../core/share.js'
import { logger } from '../core/logger.js'
import { $, esc, layer, toast, toSpeed, speedUnit, toDist, distUnit, fmtT, fmtDate, fmtBytes, markLabel } from './util.js'
import { bikeSvg, pixelSvg } from './pixel.js'
import { editRider } from './title.js'
import { RACE_MODES } from '../core/race.js'

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
  { id: 'settings', title: 'AJUSTES', sub: () => 'Unidades, sonido, crono, radar' },
  { id: 'perms', title: 'PERMISOS', sub: () => (T.status === 'ok' ? 'GPS OK' : 'GPS sin señal') + (T.motion ? ' · movimiento OK' : '') },
  { id: 'data', title: 'DATOS', sub: () => (settings.logTelemetry ? 'Telemetría guardándose · exportar' : 'Telemetría apagada · exportar') },
]

export function mountGarage(el, { applySource }) {
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
            <div class="me-who"><b>${esc(settings.name || 'PILOTO')}</b><span>${esc(settings.bike || 'Sin moto')}</span><button class="btn small" data-act="edit">EDITAR</button></div>
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
        group('PANTALLA', onOff('crt', 'Efecto CRT', 'Líneas de tubo; quítalo si cuesta leer al sol') + onOff('sound', 'Sonido', 'Pitidos del árbol y avisos')),
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
    perms() {
      const geoTxt =
        geo === 'granted' ? state('CONCEDIDO', 'on') : geo === 'denied' ? state('DENEGADO', 'off') : T.status === 'ok' ? state('FUNCIONA', 'on') : state('PREGUNTA', '')
      const motionTxt = T.motion ? state('ACTIVO', 'on') : motionNeedsTap() ? state('TOCA', '') : state('SIN SENSOR', 'off')
      const ios = isIOS()
      const steps = ios
        ? `<li>${isStandalone() ? 'Ya la tienes en la pantalla de inicio: bien.' : 'Añádela a la pantalla de inicio: <b>Compartir → Añadir a pantalla de inicio</b>. Instalada recuerda mejor los permisos y va a pantalla completa.'}</li>
           <li>Ubicación: cuando pregunte, elige <b>Permitir al usar la app</b>. «Permitir una vez» hace que vuelva a preguntar.</li>
           <li>En Safari (sin instalar): <b>aA → Configuración del sitio web → Ubicación → Permitir</b>.</li>
           <li>Movimiento: iOS lo pide con tu primer toque al abrirla. Si vuelve a preguntar, es cosa de iOS con las webs: basta con aceptar.</li>`
        : `<li>Ubicación: cuando pregunte, elige <b>Permitir</b> (o «Mientras se usa la app»). Chrome lo recuerda.</li>
           <li>Si la bloqueaste: <b>candado de la barra de direcciones → Permisos → Ubicación → Permitir</b>.</li>
           <li>Instálala con <b>⋮ → Añadir a pantalla de inicio</b> para abrirla a pantalla completa.</li>`
      return `
        <div class="set"><span>Ubicación (GPS)<small>Para la velocidad, el crono y el radar</small></span>${geoTxt}</div>
        <div class="set"><span>Movimiento<small>Inclinación, fuerza G y detección de salida</small></span>${motionTxt}</div>
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
           <div class="set"><span>Exportar todo<small>Archivo .json con la telemetría, las pasadas y los duelos. Pásalo al ordenador (AirDrop, Drive, correo) y ábrelo en <b>${esc(location.host + import.meta.env.BASE_URL)}blackbox</b></small></span><button class="btn small cyan" data-act="export">EXPORTAR</button></div>
           <div class="set"><span>Borrar telemetría<small>Después de pasarla al ordenador, para liberar espacio</small></span><button class="btn small ghost" data-act="wipeTele">BORRAR</button></div>`,
        )}
        ${group(
          'PASADAS Y DUELOS',
          `<p class="empty-note">Tienes <b>${runs.length}</b> ${runs.length === 1 ? 'pasada' : 'pasadas'} y <b>${races.length}</b> ${races.length === 1 ? 'duelo' : 'duelos'} guardados en este móvil.</p>
           <div class="set"><span>Enviar para análisis<small>Tiempos, velocidades y precisión del GPS de cada pasada, sin tu posición ni la telemetría. Solo se pueden leer desde el proyecto, no desde la web.</small></span><button class="btn small green" data-act="send" ${lobby.kind === 'online' ? '' : 'disabled'}>ENVIAR</button></div>
           <div class="set"><span>Borrar datos<small>Historial, duelos y récords de este móvil</small></span><button class="btn small ghost" data-act="wipe">BORRAR</button></div>`,
        )}`
    },
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button')
    if (!b) return
    sfx.click()
    if (b.dataset.sub) {
      sub = b.dataset.sub
      if (sub === 'perms') geo = await geoPermission()
      render()
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
      if (b.dataset.toggle === 'crt') document.body.classList.toggle('crt', settings.crt)
    } else if (b.dataset.pick) {
      const key = b.dataset.pick
      const raw = b.dataset.v
      setSetting(key, ['radius', 'simHz'].includes(key) ? Number(raw) : raw)
      if (['source', 'simHz', 'simBike'].includes(key)) applySource()
    } else if (b.dataset.act === 'zero') {
      toast(zeroLean() ? 'INCLINOMETRO A 0' : 'SIN SENSOR DE MOVIMIENTO')
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
