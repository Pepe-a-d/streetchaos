// BLACKBOX: analizador de la telemetría que graba la app (pensado para el ordenador; la dirección de
// la app abre esto en un ordenador). Se vincula con el móvil con un código de 6 letras: baja solo las
// salidas que sube el móvil y su perfil (nombre, moto, nivel, récords y tema de colores, que se usa
// aquí también). También importa los .json que exporta el móvil. Cada salida: mapa, gráficas
// sincronizadas, resumen, G-G, curvas, frenadas, pasadas, potencia y calidad de los datos.
import '@fontsource/press-start-2p'
import './style.css'
import { onDbBlocked, listSessions, addSessions, loadSession, deleteSession, parseExport, deviceSessions, listSegments, saveSegment, deleteSegment, getEfforts, putEfforts, updateMeta, gpsBbox, getAnalysis, putAnalysis, getVideos, putVideos } from './library.js'
import { analyze, rangeStats, DT, ANALYSIS_VERSION } from './process.js'
import { makePath, findPasses, compare, pathPoints, runPass, bboxHit, closeLoop, profileOf, sectors } from './align.js'
import { findPulls, pullCurve, envelope, DYNO, CDA_PRESETS } from './dyno.js'
import { cloudAvailable, getKey, setKey, keyFromUrl, validKey, normKey, listRemote, fetchRemote, deleteRemote, sharedCircuits, sharedCircuit, shareCircuit, ranking, publishEffort, fetchProfile, claimCode, normCode, shareGhost, fetchGhost, normGhostCode, validGhostCode } from './cloud.js'
import { readVideo, fileReader, syncOffset, videoSpan } from './gpmf.js'
import { createVideoPanel, isVideoFile, HOW } from './video.js'
import { packGhost, unpackGhost } from './ghost.js'
import { parseLoggerFile } from './importers.js'
import { savedProfile, saveProfile, applyProfileTheme } from './theme.js'
import { pal } from './palette.js'
import { tip, GG_HELP, helpHtml } from './help.js'
import { whereTime, reasons } from './coach.js'
import { createCompareView, gainColors, fmtLap } from './compare-view.js'
import { esc, toast, modal } from './ui.js'
import uPlot from 'uplot'
import { CHANNELS, MAP_CHANNELS, CHART_CHANNELS, units, toSpeed, speedUnit, toDist, distUnit, fmt, fmtDur, fmtElapsed, fmtDateTime, fmtClock, gradientCss } from './channels.js'
import { createCharts } from './charts.js'
import { drawGG, drawLeanHist } from './gg.js'

const $ = (sel, root = document) => root.querySelector(sel)

// ---------- Preferencias ----------
const PREFS = 'sc-bb-prefs'
const prefs = { units: 'kmh', xMode: 't', mapCh: 'v', charts: ['v', 'lean', 'gLong', 'gLat', 'alt'], showApp: false, tab: 'tramo', sort: 'n', dyno: { ...DYNO }, rider: '' }
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS) || '{}'))
} catch {}
const savePrefs = () => {
  try {
    localStorage.setItem(PREFS, JSON.stringify(prefs))
  } catch {}
  // Las otras ventanas, con lo mismo (unidades, canales, pestaña...)
  send({ type: 'prefs', prefs })
}

// ---------- Varias ventanas ----------
// Cada parte (mapa, gráficas, datos) se puede abrir en su propia ventana, en otra pantalla. Todas van a
// una: abrir una salida, elegir un tramo, mover el cursor o cambiar las unidades en una lo hace en las
// demás (BroadcastChannel, dentro de este navegador o de la app de Windows). La principal («todo») es la
// que tiene la biblioteca y sincroniza con la nube; las otras solo enseñan su parte, a pantalla completa.
const VISTAS = { mapa: 'MAPA', graficas: 'GRAFICAS', datos: 'DATOS', video: 'VIDEO' }
const VISTA = VISTAS[new URLSearchParams(location.search).get('vista')] ? new URLSearchParams(location.search).get('vista') : 'todo'
const SAT = VISTA !== 'todo'
document.body.dataset.vista = VISTA
const WIN = Math.random().toString(36).slice(2, 8)
const SYNC = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sc-bb-sync') : null
let remote = false // aplicando lo que llega de otra ventana: no se vuelve a mandar
function send(msg, force = false) {
  if (!remote || force) SYNC?.postMessage({ ...msg, from: WIN, vista: VISTA })
}
const shows = (part) => VISTA === 'todo' || VISTA === part
units.speed = prefs.units

// range: lo que se ve (zoom); work: el tramo que has elegido arrastrando (las listas de curvas, frenadas
// y tirones son siempre de este); focus: qué estás mirando dentro (una curva, una frenada, una pasada o un
// zoom); hist: para volver atrás; memo: dónde estabas en cada salida
const S = { list: [], segs: [], id: null, A: null, range: [0, 0], work: [0, 0], focus: null, hist: [], memo: new Map(), cur: 0, map: null, charts: null, cmp: null, cmpView: null, profile: savedProfile(), fresh: new Set() }
// Con el tema del móvil desde el primer momento (el perfil guardado de la última vez)
applyProfileTheme(S.profile)
if (S.profile?.units && !localStorage.getItem(PREFS)) prefs.units = units.speed = S.profile.units === 'mph' ? 'mph' : 'kmh'

// ---------- Estructura ----------
// Gráficas preparadas para cada cosa (los canales sueltos siguen ahí al lado)
const VIEWS = {
  basic: ['BASICA', ['v', 'lean']],
  corners: ['CURVAS', ['v', 'lean', 'gLat', 'yaw']],
  brakes: ['FRENADAS', ['v', 'gLong', 'lean']],
  all: ['TODO', null],
}
const TABS = [
  ['tramo', 'RESUMEN', 'Las cifras de la salida o del tramo que elijas en las gráficas'],
  ['gg', 'G-G', 'Fuerzas de frenada, aceleración y curva, y cuánto tiempo vas a cada inclinación'],
  ['curvas', 'CURVAS', 'Cada curva: inclinación, velocidad de entrada, mínima y salida'],
  ['frenadas', 'FRENADAS', 'Cada frenada: de qué velocidad a cuál, cuánto y con qué fuerza'],
  ['pasadas', 'PASADAS', 'Las pasadas del crono de esta salida, para compararlas'],
  ['potencia', 'POTENCIA', 'Banco de potencia virtual con tus aceleraciones'],
  ['calidad', 'CALIDAD', 'De dónde sale cada dato y cómo de fiable es'],
]
const root = document.getElementById('bb')
root.innerHTML = `
  <header class="top">
    <button class="logo" data-act="home" title="Inicio: tu perfil y tus salidas">STREET<span>CHAOS</span></button>
    <b class="tag">BLACKBOX V2</b>
    <div class="title" data-k="title">Analizador de telemetría</div>
    <button class="sync" data-k="sync" data-act="syncPill"></button>
    <div class="seg" data-k="xmode" title="Eje de las gráficas"><button data-x="t">TIEMPO</button><button data-x="d">DISTANCIA</button></div>
    <div class="seg" data-k="units"><button data-u="kmh">KM/H</button><button data-u="mph">MPH</button></div>
    <button class="btn ghost" data-act="csv" disabled title="Canales a 10 Hz para Excel u otras herramientas (del tramo elegido, o de toda la salida)">CSV</button>
    <button class="btn ghost" data-act="gpx" disabled title="El recorrido para Google Earth, Strava u otros mapas (del tramo elegido, o de toda la salida)">GPX</button>
    <button class="btn ghost dl-btn" data-act="download" title="La app de Windows: más fluida y con una ventana en cada pantalla">⬇ WINDOWS</button>
    <button class="btn ghost win-btn" data-act="windows" title="Abrir el mapa, las gráficas o los datos en otra ventana y repartirlas en tus pantallas">VENTANAS</button>
    <button class="btn ghost help-btn" data-act="help" title="Cómo se leen tus datos y atajos">?</button>
    <a class="btn ghost" href="../?app" title="Abrir la app del móvil en este ordenador (para probarla)">APP</a>
  </header>
  <aside class="lib">
    <div class="rider" data-k="rider"></div>
    <div class="cloud" data-k="cloud"></div>
    <h3 class="h">SALIDAS <span class="h-n" data-k="count"></span></h3>
    <div class="list" data-k="list"></div>
    <label class="drop" data-k="drop" title="También puedes soltar el archivo en cualquier parte de la página">
      <b>+ IMPORTAR</b>
      <span>.json del móvil, GPX, CSV de RaceBox o RaceChrono, VBO o vídeo</span>
      <input type="file" accept=".json,application/json,.gpx,.csv,.vbo,.nmea,.nma,.txt,.mp4,.mov,video/mp4,video/quicktime" multiple hidden>
    </label>
    <div class="lib-btns">
      <button class="btn ghost small" data-act="demo" title="Dos salidas inventadas por Oleiros para probarlo todo">VER DEMO</button>
      <button class="btn ghost small" data-act="device" hidden>DE ESTE MOVIL</button>
    </div>
    <h3 class="h">TRAMOS</h3>
    <div class="list" data-k="segs"></div>
    <button class="btn ghost small" data-act="shared" title="Circuitos cerrados con clasificación entre pilotos">CIRCUITOS COMPARTIDOS</button>
    <button class="btn ghost small" data-act="friend" title="Abre la pasada que te ha pasado un amigo (con su código) y compárate con ella">PASADA DE UN AMIGO</button>
  </aside>
  <main class="main">
    <section class="empty" data-k="empty"></section>
    <section class="work" data-k="work" hidden>
      <div class="row1">
        <div class="panel mapbox">
          <div class="map" data-k="map"></div><div class="map-loading" data-k="maploading" hidden>CARGANDO MAPA…</div>
          <div class="vid" data-k="vid" hidden></div>
          <div class="map-bar">
            <div class="chips" data-k="mapch">${MAP_CHANNELS.map((id) => `<button class="chip" data-mapch="${id}" title="Colorear la traza por ${CHANNELS[id].label.toLowerCase()}. ${tip(id)}">${CHANNELS[id].short}</button>`).join('')}</div>
            <div class="legend" data-k="legend"></div>
            <span class="grow"></span>
            <button class="btn ghost small vid-btn" data-act="video" data-k="vidBtn" title="El vídeo de esta salida (GoPro u otra cámara) al lado del mapa, sincronizado con los datos">VIDEO</button>
          </div>
        </div>
        <div class="panel side">
          <div class="readout" data-k="readout"></div>
          <nav class="tabs" data-k="tabs">
            ${TABS.map(([id, l, tip]) => `<button data-tab="${id}" title="${tip}">${l}</button>`).join('')}
          </nav>
          <div class="tab-body" data-k="tabbody"></div>
        </div>
      </div>
      <div class="panel charts-box">
        <div class="cmp-box" data-k="cmp" hidden></div>
        <div data-k="chartsMain">
        <div class="ch-bar">
          <div class="chips views" data-k="views" title="Gráficas preparadas para lo que quieras mirar">${Object.entries(VIEWS).map(([k, [l]]) => `<button class="chip" data-view="${k}">${l}</button>`).join('')}</div>
          <div class="chips" data-k="chartch">${CHART_CHANNELS.map((id) => `<button class="chip" data-chart="${id}" title="${tip(id)}">${CHANNELS[id].short}</button>`).join('')}</div>
          <label class="toggle"><input type="checkbox" data-k="showApp"> comparar con lo que calculó el móvil</label>
          <span class="grow"></span>
          <span class="range" data-k="range"></span>
          <button class="btn ghost small" data-act="back" data-k="back" title="Vuelve a lo que veías antes (Esc)">← ATRAS</button>
          <button class="btn ghost small" data-act="all" title="Toda la salida (doble clic en una gráfica)">VER TODO</button>
          <button class="btn cyan small" data-act="compare" title="Busca otras pasadas por este tramo (en esta salida o en otras) y compara">COMPARAR</button>
          <button class="btn ghost small" data-act="saveSeg" title="Guarda este tramo para cronometrarlo en todas tus salidas">GUARDAR TRAMO</button>
          <button class="btn ghost small" data-act="share" title="Manda este tramo a un amigo: con el código lo compara con sus pasadas por el mismo sitio">COMPARTIR</button>
        </div>
        <div class="charts" data-k="charts"></div>
        <p class="hint">Arrastra sobre una gráfica o la tira de arriba para elegir un tramo · Ctrl/⌘ + rueda (o pellizca) para acercar · Esc vuelve atrás y doble clic lo enseña todo · ← → mueven el cursor · [ ] curva o frenada anterior y siguiente</p>
        </div>
      </div>
    </section>
    <div class="busy" data-k="busy" hidden><span>ANALIZANDO…</span></div>
  </main>`

const K = (k) => root.querySelector(`[data-k="${k}"]`)
const fileInput = $('input[type=file]', K('drop'))

// ---------- Biblioteca ----------
const SRC = { real: ['REAL', 'real'], sim: ['SIM', 'sim'], demo: ['DEMO', 'demo'] }

// Salidas que has borrado en este navegador: la nube no las vuelve a bajar (se quitan si las importas)
const DELETED = 'sc-bb-deleted'
const deleted = new Set(
  (() => {
    try {
      return JSON.parse(localStorage.getItem(DELETED) || '[]')
    } catch {
      return []
    }
  })(),
)
const saveDeleted = () => {
  try {
    localStorage.setItem(DELETED, JSON.stringify([...deleted].slice(-500)))
  } catch {}
}

/** «HOY», «AYER» o la fecha, para agrupar la lista. */
function dayLabel(ms) {
  const d = new Date(ms)
  const today = new Date()
  const k = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (k(d) === k(today)) return 'HOY'
  if (k(d) === k(y)) return 'AYER'
  return d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' }).toUpperCase()
}
// La punta que guardó el móvil antes de 2026-11-09 podía ser falsa (velocidad sacada de posiciones):
// en cuanto se analiza una salida, se apunta la del análisis (vmaxBB) y es la que se enseña
const vmaxOf = (m) => m.vmaxBB ?? m.vmax ?? 0
/** Etiqueta corta de un archivo de otro aparato: «RACEBOX 25 HZ». */
const loggerTag = (m) => `${String(m.logger.name || m.logger.kind).split(/[ ·(]/)[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()} ${Math.round(m.logger.hz)} HZ`
const distOf = (m) => m.distBB ?? m.dist ?? 0

async function refreshList() {
  S.list = await listSessions()
  K('count').textContent = S.list.length ? String(S.list.length) : ''
  let day = null
  K('list').innerHTML = S.list.length
    ? S.list
        .map((m) => {
          const [txt, cls] = SRC[m.source] || ['?', '']
          const d = dayLabel(m.start)
          const head = d !== day ? `<h4 class="day">${d}</h4>` : ''
          day = d
          const tag = m.logger ? `<i class="src logger" title="${esc(m.logger.name)} · ${m.logger.hz} Hz${m.logger.file ? ` · ${esc(m.logger.file)}` : ''}">${loggerTag(m)}</i>` : m.source !== 'real' || m.state === 'rec' ? `<i class="src ${cls}">${txt}${m.state === 'rec' ? ' · A MEDIAS' : ''}</i>` : ''
          return `${head}<div class="sess ${m.id === S.id ? 'on' : ''}" data-id="${esc(m.id)}">
            <button class="sess-open" data-open="${esc(m.id)}" title="${fmtDateTime(m.start)}">
              <b class="${m.notes || m.tags?.length ? 'has-notes' : ''}" title="${esc([...(m.tags || []), m.notes || ''].filter(Boolean).join(' · '))}">${fmtClock(m.start).slice(0, 5)}${S.fresh.has(m.id) ? ' <em class="new">NUEVA</em>' : ''}</b>
              <span>${toDist(distOf(m)).toFixed(1)} ${distUnit()} · ${fmtDur((m.end - m.start) / 1000)} · ${Math.round(toSpeed(vmaxOf(m)))} ${speedUnit()}</span>
            </button>
            ${tag}
            <button class="del" data-del="${esc(m.id)}" title="Borrar de este navegador" aria-label="Borrar">×</button>
          </div>`
        })
        .join('')
    : '<p class="note">Aún no hay salidas en este navegador.</p>'
  if (!S.id) renderHome()
}

async function importText(text, from, { mtime } = {}) {
  // El .json del móvil (o del modo rescate); si no, un archivo de otro aparato (GPX, CSV, VBO, NMEA)
  const parsed = /^\s*\{/.test(text.slice(0, 200)) ? parseExport(text) : { sessions: parseLoggerFile(text, from, { mtime }) }
  const r = await addSessions(parsed.sessions, from)
  // Importadas a mano: ya no cuentan como borradas, y su análisis se rehace si crecieron
  for (const x of parsed.sessions) if (deleted.delete(x.meta?.id)) saveDeleted()
  for (const id of r.changed) refreshAnalysis(id, { reopen: true })
  await refreshList()
  const parts = []
  if (r.added) parts.push(`${r.added} nueva${r.added > 1 ? 's' : ''}`)
  if (r.grown) parts.push(`${r.grown} ampliada${r.grown > 1 ? 's' : ''}`)
  if (r.skipped) parts.push(`${r.skipped} ya estaba${r.skipped > 1 ? 'n' : ''}`)
  toast(`${from}: ${parts.join(' · ') || 'sin salidas'}`)
  return parsed.sessions
}

async function importFiles(files) {
  // Los vídeos van al panel de vídeo; el resto, a la biblioteca
  const videos = files.filter(isVideoFile)
  files = files.filter((f) => !isVideoFile(f))
  if (videos.length && !SAT) attachVideos(videos)
  let last = null
  for (const f of files) {
    try {
      const sessions = await importText(await f.text(), f.name, { mtime: f.lastModified })
      if (sessions.length) last = sessions.sort((a, b) => b.meta.start - a.meta.start)[0].meta.id
    } catch (e) {
      toast(`${f.name}: ${e.message}`, 5000)
    }
  }
  if (last) open(last)
}

fileInput.addEventListener('change', () => {
  importFiles([...fileInput.files])
  fileInput.value = ''
})
addEventListener('dragover', (e) => {
  e.preventDefault()
  document.body.classList.add('dragging')
})
addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('dragging')
})
addEventListener('drop', (e) => {
  e.preventDefault()
  document.body.classList.remove('dragging')
  const files = [...(e.dataTransfer?.files || [])]
  if (files.length) importFiles(files)
})

async function loadDemo() {
  const busy = K('busy')
  busy.querySelector('span').textContent = 'CARGANDO DEMO…'
  busy.hidden = false
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}demo/telemetria-demo.json`)
    if (!res.ok) throw new Error(`no se pudo bajar (HTTP ${res.status})`)
    const sessions = await importText(await res.text(), 'demo')
    busy.hidden = true
    await open(sessions.sort((a, b) => b.meta.start - a.meta.start)[0].meta.id)
  } catch (e) {
    console.error(e)
    toast(`No se pudo cargar la demo: ${e.message}`, 8000)
  } finally {
    busy.hidden = true
    busy.querySelector('span').textContent = 'ANALIZANDO…'
  }
}

// Otra pestaña con el Blackbox viejo abierto bloquea la base de datos: se dice qué hacer
onDbBlocked((on) => {
  let b = document.querySelector('.blocked')
  if (on && !b) {
    b = document.createElement('div')
    b.className = 'blocked'
    b.innerHTML = '<b>HAY OTRA PESTAÑA DEL BLACKBOX ABIERTA</b><span>Tiene la versión anterior y bloquea tus datos. Ciérrala (o recárgala) y esta seguirá sola.</span>'
    document.body.append(b)
  } else if (!on) b?.remove()
})

let deviceCache = null
async function checkDevice() {
  const n = await deviceSessions({ count: true })
  const b = root.querySelector('[data-act="device"]')
  b.hidden = !n
  b.textContent = `DE ESTE MOVIL (${n})`
}

// ---------- Abrir una salida ----------
// Un respiro para que se pinte «ANALIZANDO» (sin requestAnimationFrame: en una pestaña oculta no llega)
const nextFrame = () => new Promise((r) => setTimeout(r, 30))

async function open(id, { range, cur } = {}) {
  if (S.cmp) exitCompare()
  rememberPlace()
  if (S.staleId === id) (S.staleId = null), cache.delete(id)
  K('busy').hidden = false
  await nextFrame()
  try {
    const A = await analysisOf(id)
    if (!A) throw new Error('No está en la biblioteca')
    if (A.empty) throw new Error('Sin GPS suficiente para analizarla')
    S.id = id
    S.A = A
    S.range = [0, A.n - 1]
    S.work = [0, A.n - 1]
    S.focus = null
    S.hist = []
    S.cur = A.valid.indexOf(1)
    history.replaceState(null, '', `#s=${encodeURIComponent(id)}`)
    K('empty').hidden = true
    K('work').hidden = false
    // La punta del análisis (la que guardó el móvil antes podía ser falsa)
    const lm = S.list.find((x) => x.id === id)
    if (lm && Number.isFinite(A.stats.vMax) && (Math.abs((lm.vmaxBB ?? -1) - A.stats.vMax) > 0.05 || Math.abs((lm.distBB ?? -1) - A.stats.dist) > 1)) updateMeta({ ...lm, vmaxBB: A.stats.vMax, distBB: A.stats.dist }).catch(() => {})
    S.fresh.delete(id)
    root.querySelector('[data-act="csv"]').disabled = false
    root.querySelector('[data-act="gpx"]').disabled = false
    ensureViews()
    const m = A.meta
    K('title').innerHTML = `<b>${fmtDateTime(m.start)}</b> · ${toDist(A.stats.dist).toFixed(1)} ${distUnit()} · ${fmtDur(A.stats.dur)}${m.logger ? ` · <i class="src logger">${loggerTag(m)}</i>` : m.source !== 'real' ? ` · <i class="src ${m.source}">${(SRC[m.source] || ['?'])[0]}</i>` : ''}${m.rider?.bike ? ` · ${esc(m.rider.bike)}` : ''}`
    if (S.map) paintMap(true)
    buildCharts()
    renderAll()
    sessionVideos(A)
    try {
      if (!localStorage.getItem('sc-bb-helped')) {
        localStorage.setItem('sc-bb-helped', '1')
        setTimeout(() => toast('¿Primera vez? Pulsa «?» arriba para ver cómo se leen tus datos', 7000), 800)
      }
    } catch {}
    refreshList()
    // Con un tramo pedido (tramos guardados, comparar), ese; si no, donde lo dejaste en esta salida
    const memo = S.memo.get(id)
    if (range) setRange(...range, { kind: 'select', push: false })
    else if (memo) {
      S.hist = memo.hist
      S.work = memo.work
      S.focus = memo.focus
      setRange(...memo.range, { kind: 'restore' })
    }
    if (cur != null) setCursor(cur, 'list')
    else if (!range && memo) setCursor(memo.cur, 'list')
    send({ type: 'open', id, range: S.range, work: S.work, focus: S.focus, cur: S.cur })
  } catch (e) {
    toast(`No se pudo abrir: ${e.message}`, 5000)
    console.error(e)
  } finally {
    K('busy').hidden = true
  }
}

// Las gráficas salen ya; el mapa (librería grande y teselas por la red) llega cuando esté
// Gráficas de mentira para las ventanas que no las enseñan (así el resto del código no cambia)
const NO_CHARTS = { build() {}, setRange() {}, setCursor() {}, resize() {}, xLabel: () => (prefs.xMode === 't' ? 'tiempo (min:s)' : `distancia (${distUnit()})`) }

function ensureViews() {
  if (S.charts) return
  S.charts = shows('graficas')
    ? createCharts(K('charts'), {
        onCursor: (i, from) => setCursor(i, from),
        onRange: (a, b, how) => setRange(a, b, { kind: how === 'wheel' ? 'view' : how === 'all' ? 'all' : 'select', wheel: how === 'wheel' }),
        fill: VISTA === 'graficas' ? () => innerHeight : null,
      })
    : NO_CHARTS
  if (shows('graficas')) new ResizeObserver(() => S.charts.resize()).observe(K('charts'))
  if (!shows('mapa')) return
  K('maploading').hidden = false
  import('./map.js')
    .then(({ createMap }) => createMap(K('map'), { onHover: (i) => setCursor(i, 'map'), onPick: (i) => setCursor(i, 'map'), onMark: (kind, n) => focusFromMap(kind, n) }))
    .then((map) => {
      S.map = map
      new ResizeObserver(() => map.resize()).observe(K('map'))
      if (S.A) paintMap(true)
    })
    .catch((e) => {
      console.error(e)
      K('map').innerHTML = '<p class="note" style="padding:12px">No se pudo cargar el mapa.</p>'
    })
    .finally(() => (K('maploading').hidden = true))
}

function paintMap(fit) {
  const A = S.A
  S.map.setTrack(A, prefs.mapCh, S.range)
  if (fit) S.map.fit(...(S.range[0] === 0 && S.range[1] === A.n - 1 ? [0, A.n - 1] : S.range), false)
  S.map.setMarks(marks(A))
  S.map.setCursor(S.cur)
}

function marks(A) {
  const out = []
  const first = A.valid.indexOf(1)
  const last = A.valid.lastIndexOf(1)
  out.push({ i: first, label: 'SALIDA', color: pal('green'), kind: 'start' }, { i: last, label: 'FIN', color: pal('ink'), kind: 'end' })
  A.runs.forEach((r, k) => {
    const head = r.marks?.['k0-100'] ?? r.marks?.['m0-60']
    out.push({ i: r.i, label: head != null ? `PASADA ${head.toFixed(2)} s` : 'PASADA', color: pal('yellow'), kind: 'run', n: k + 1 })
  })
  for (const c of A.corners) out.push({ i: c.apex, label: `${c.n}`, color: pal('yellow'), kind: 'corner', n: c.n })
  return out
}

function buildCharts() {
  S.charts.build(S.A, { ids: prefs.charts, mode: prefs.xMode, showApp: prefs.showApp })
  S.charts.setRange(...S.range)
  S.charts.setCursor(S.cur)
}

// ---------- Cursor y tramo ----------
let pending = 0
function setCursor(i, from) {
  const A = S.A
  if (!A) return
  i = Math.max(0, Math.min(A.n - 1, i))
  S.cur = i
  if (from !== 'remote') send({ type: 'cursor', id: S.id, i })
  if (from !== 'chart') S.charts.setCursor(i, from)
  else S.charts.setCursor(i, 'chart')
  S.map?.setCursor(i)
  if (from === 'key' || from === 'list') S.map?.follow(i)
  if (vpanel) {
    if (from !== 'video' && vpanel.on && videoShown()) vpanel.follow(i)
    else vpanel.cursor = i
  }
  if (S.cmp && from !== 'cmp') {
    const C = S.cmp.C
    let k = 0
    for (let q = 1; q < C.n; q++) if (Math.abs(C.iA[q] - i) < Math.abs(C.iA[k] - i)) k = q
    S.cmpView.setCursorK(k)
    S.map?.setCompareCursor(S.cmp.B.lon[C.iB[k]], S.cmp.B.lat[C.iB[k]])
  }
  cancelAnimationFrame(pending)
  pending = requestAnimationFrame(() => {
    renderReadout()
    if (prefs.tab === 'gg') drawGG(K('tabbody').querySelector('[data-k="gg"]'), A, ...S.range, S.cur)
    markCurrentRow()
  })
}

/**
 * Cambia lo que se ve. kind:
 * - 'select': has elegido un tramo (arrastrando): pasa a ser el tramo de trabajo
 * - 'view': un zoom dentro del tramo (una curva, una frenada, una pasada, la rueda); focus dice qué es
 * - 'work': volver al tramo de trabajo entero
 * - 'all': toda la salida
 * - 'restore': volver a un estado guardado (atrás, otra salida) sin apuntarlo en el historial
 */
function setRange(a, b, { fit = true, kind = 'select', focus = null, push = true, wheel = false } = {}) {
  const A = S.A
  if (!A) return
  // (se decide ahora si se manda: lo que llega de otra ventana no se devuelve, o rebotaría sin fin)
  if (!remote) queueMicrotask(() => send({ type: 'range', id: S.id, range: S.range, work: S.work, focus: S.focus }, true))
  let i0 = Math.max(0, Math.min(a, b))
  let i1 = Math.min(A.n - 1, Math.max(a, b))
  if (i1 - i0 < 10) i1 = Math.min(A.n - 1, i0 + 10)
  if (push && kind !== 'restore') pushHist(wheel ? 'wheel' : kind)
  if (kind === 'select') (S.work = [i0, i1]), (S.focus = null)
  else if (kind === 'all') (S.work = [0, A.n - 1]), (S.focus = null)
  else if (kind === 'view') S.focus = focus || { kind: 'zoom' }
  else if (kind === 'work') S.focus = null
  S.range = [i0, i1]
  S.charts.setRange(i0, i1)
  if (wheel) {
    // Con la rueda llegan decenas de pasos seguidos: la traza del mapa se rehace al parar
    clearTimeout(trackTimer)
    trackTimer = setTimeout(() => S.map?.setTrack(A, prefs.mapCh, S.range), 180)
  } else S.map?.setTrack(A, prefs.mapCh, S.range)
  if (fit && !wheel) S.map?.fit(i0, i1)
  if (S.cur < i0 || S.cur > i1) setCursor(Math.round((i0 + i1) / 2), 'range')
  renderRange()
  renderTab()
}

let trackTimer = null
// Historial para volver atrás. Los zooms seguidos de la rueda cuentan como uno.
let lastPush = { t: 0, kind: '' }
function pushHist(kind) {
  const now = performance.now()
  if (kind === 'wheel' && lastPush.kind === 'wheel' && now - lastPush.t < 1500) return (lastPush.t = now)
  lastPush = { t: now, kind }
  const top = S.hist[S.hist.length - 1]
  if (top && top.range[0] === S.range[0] && top.range[1] === S.range[1] && top.work[0] === S.work[0] && top.work[1] === S.work[1]) return
  S.hist.push({ range: [...S.range], work: [...S.work], focus: S.focus })
  if (S.hist.length > 40) S.hist.shift()
}

/** Vuelve a lo que veías antes; sin historial, a toda la salida. */
function goBack() {
  const A = S.A
  if (!A) return
  const h = S.hist.pop()
  if (!h) return S.range[0] !== 0 || S.range[1] !== A.n - 1 ? setRange(0, A.n - 1, { kind: 'all', push: false }) : null
  S.work = h.work
  S.focus = h.focus
  setRange(...h.range, { kind: 'restore' })
}

/** Lo que se puede recorrer con [ ] según lo que estás mirando: curvas, frenadas o pasadas del tramo. */
function focusItems(kind) {
  const A = S.A
  const [w0, w1] = S.work
  if (kind === 'corner') {
    const by = { n: (a, b) => a.n - b.n, lean: (a, b) => b.lean - a.lean, v: (a, b) => b.vMin - a.vMin }
    return A.corners.filter((c) => c.i0 >= w0 && c.i1 <= w1).sort(by[prefs.sort] || by.n).map((c) => ({ n: c.n, i0: c.i0, i1: c.i1, at: c.apex }))
  }
  if (kind === 'brake') return A.brakes.filter((c) => c.i0 >= w0 && c.i1 <= w1).map((c) => ({ n: c.n, i0: c.i0, i1: c.i1, at: c.iMax }))
  if (kind === 'run') return A.runs.map((r, k) => ({ n: k + 1, ...runSpan(r) }))
  return []
}
function runSpan(r) {
  const A = S.A
  const end = Math.max(0, ...Object.values(r.marks || {}))
  return { i0: Math.max(0, r.i - 30), i1: Math.min(A.n - 1, r.i + Math.round((end + 4) / DT)), at: r.i }
}
const PAD = Math.round(3 / DT)
/** Acerca a una curva, frenada o pasada (sin cambiar el tramo de trabajo). */
function focusOn(kind, it, { push = true } = {}) {
  setRange(it.i0 - (kind === 'run' ? 0 : PAD), it.i1 + (kind === 'run' ? 0 : PAD), { kind: 'view', focus: { kind, n: it.n }, push })
  setCursor(it.at, 'list')
  K('tabbody').querySelector('.focus')?.scrollIntoView({ block: 'nearest' })
}
/** La curva (o frenada o pasada) anterior o siguiente del tramo. */
function stepFocus(dir) {
  const f = S.focus
  if (!f || f.kind === 'zoom') return
  const items = focusItems(f.kind)
  const k = items.findIndex((x) => x.n === f.n)
  const it = items[k + dir]
  if (it) focusOn(f.kind, it, { push: false })
}

/** Clic en el número de una curva o en una pasada del mapa: se abre su lista y se acerca a ella. */
function focusFromMap(kind, n) {
  const A = S.A
  if (!A) return
  let it = null
  if (kind === 'corner') {
    const c = A.corners.find((x) => x.n === n)
    if (!c) return
    // Si la curva está fuera del tramo, el tramo pasa a ser toda la salida (para poder recorrerlas)
    if (c.i0 < S.work[0] || c.i1 > S.work[1]) S.work = [0, A.n - 1]
    it = { n, i0: c.i0, i1: c.i1, at: c.apex }
    if (prefs.tab !== 'curvas') (prefs.tab = 'curvas'), savePrefs(), renderAll()
  } else if (kind === 'run') {
    const r = A.runs[n - 1]
    if (!r) return
    it = { n, ...runSpan(r) }
    if (prefs.tab !== 'pasadas') (prefs.tab = 'pasadas'), savePrefs(), renderAll()
  }
  if (it) focusOn(kind, it)
}

/** Guarda dónde estabas en la salida abierta (para volver a ella tal cual). */
function rememberPlace() {
  if (S.id && S.A) S.memo.set(S.id, { range: [...S.range], work: [...S.work], focus: S.focus, hist: S.hist.slice(-40), cur: S.cur })
}

// ---------- Pintar ----------
/** Botones de unidades (también sin ninguna salida abierta). */
function renderUnits() {
  for (const b of root.querySelectorAll('[data-u]')) b.classList.toggle('on', b.dataset.u === prefs.units)
}

function renderAll() {
  for (const b of root.querySelectorAll('[data-x]')) b.classList.toggle('on', b.dataset.x === prefs.xMode)
  for (const b of root.querySelectorAll('[data-u]')) b.classList.toggle('on', b.dataset.u === prefs.units)
  for (const b of root.querySelectorAll('[data-mapch]')) b.classList.toggle('on', b.dataset.mapch === prefs.mapCh)
  for (const b of root.querySelectorAll('[data-chart]')) b.classList.toggle('on', prefs.charts.includes(b.dataset.chart))
  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x))
  for (const b of root.querySelectorAll('[data-view]')) b.classList.toggle('on', same(prefs.charts, VIEWS[b.dataset.view][1] || CHART_CHANNELS))
  for (const b of root.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === prefs.tab)
  K('showApp').checked = prefs.showApp
  renderLegend()
  renderReadout()
  renderRange()
  renderTab()
}

function renderLegend() {
  if (!S.A) return
  const ch = CHANNELS[prefs.mapCh]
  const [lo, hi] = ch.range(S.A)
  const f = (v) => (prefs.mapCh === 'v' ? Math.round(v) : v.toFixed(ch.dec))
  K('legend').innerHTML = `<span>${ch.legend ? ch.legend[0] : f(lo)}</span><i style="background:${gradientCss(ch.ramp)}"></i><span>${ch.legend ? ch.legend[1] : `${f(hi)} ${ch.unit()}`}</span>`
}

const tile = (k, l) => `<div class="tile" title="${tip(k)}"><span>${l}</span><b data-r="${k}">—</b></div>`
function renderReadout() {
  const A = S.A
  const el = K('readout')
  if (!el.firstChild) el.innerHTML = [tile('t', 'TIEMPO'), tile('clock', 'HORA'), tile('d', 'DISTANCIA'), tile('v', 'VELOCIDAD'), tile('lean', 'INCLINACION'), tile('gLong', 'G LONG'), tile('gLat', 'G LAT'), tile('alt', 'ALTITUD'), tile('hdg', 'RUMBO'), tile('yaw', 'GIRO'), tile('acc', 'GPS ±'), tile('vib', 'VIBRACION')].join('')
  if (!A) return
  const i = S.cur
  const set = (k, v) => (el.querySelector(`[data-r="${k}"]`).textContent = v)
  set('t', fmtElapsed(A.t[i] - A.t[0]))
  set('clock', fmtClock(A.meta.start + A.t[i] * 1000))
  set('d', `${toDist(A.d[i]).toFixed(2)} ${distUnit()}`)
  for (const k of ['v', 'lean', 'gLong', 'gLat', 'alt', 'yaw', 'acc', 'vib']) set(k, fmt(k, CHANNELS[k].get(A, i)))
  set('hdg', Number.isFinite(A.hdg[i]) ? `${String(Math.round((A.hdg[i] + 360) % 360)).padStart(3, '0')}°` : '—')
}

const FOCUS_NAME = { corner: 'CURVA', brake: 'FRENADA', run: 'PASADA', zoom: 'ZOOM' }
const span = (i0, i1) => `${fmtElapsed(S.A.t[i0] - S.A.t[0])} → ${fmtElapsed(S.A.t[i1] - S.A.t[0])}`
const isFull = ([a, b]) => a === 0 && b === S.A.n - 1

/** Dónde estás: «Toda la salida», «Tramo 2:10 → 5:40», «Tramo … › Curva 7 (2 de 9)». */
function placeLabel() {
  const A = S.A
  const parts = [isFull(S.work) ? 'Toda la salida' : `Tramo ${span(...S.work)} · ${toDist(A.d[S.work[1]] - A.d[S.work[0]]).toFixed(2)} ${distUnit()}`]
  const f = S.focus
  if (f) {
    const items = f.kind === 'zoom' ? [] : focusItems(f.kind)
    const k = items.findIndex((x) => x.n === f.n)
    parts.push(f.kind === 'zoom' ? `zoom ${span(...S.range)}` : `${FOCUS_NAME[f.kind]} ${f.n}${k >= 0 ? ` (${k + 1} de ${items.length})` : ''}`)
  }
  return parts
}

function renderRange() {
  const A = S.A
  if (!A) return
  const parts = placeLabel()
  const f = S.focus
  const items = f && f.kind !== 'zoom' ? focusItems(f.kind) : []
  const k = items.findIndex((x) => x.n === f?.n)
  const nav = f && f.kind !== 'zoom' ? `<button class="btn ghost small" data-act="prev" ${k > 0 ? '' : 'disabled'} title="Anterior ([)">◀</button><button class="btn ghost small" data-act="next" ${k >= 0 && k < items.length - 1 ? '' : 'disabled'} title="Siguiente (])">▶</button>` : ''
  K('range').innerHTML = `${parts.map((p, i) => (i < parts.length - 1 && f ? `<button class="crumb" data-act="toWork" title="Volver al tramo">${esc(p)}</button>` : `<b>${esc(p)}</b>`)).join(' › ')}${nav}${isFull(S.range) ? ` <small>· eje: ${S.charts.xLabel()}</small>` : ''}`
  K('back').disabled = !S.hist.length && isFull(S.range)
}

/**
 * «Lo mejor» de la salida o del tramo, en frases y con enlace a cada momento: lo que un principiante
 * quiere saber antes de mirar gráficas.
 */
function highlights(A, i0, i1) {
  const out = []
  const sp = (v) => `${Math.round(toSpeed(v))} ${speedUnit()}`
  const link = (html, attrs) => `<li><button class="hl-link" ${attrs}>${html}</button></li>`
  const corners = A.corners.filter((c) => c.i0 >= i0 && c.i1 <= i1)
  const brakes = A.brakes.filter((c) => c.i0 >= i0 && c.i1 <= i1)
  const rec = getKey() ? S.profile?.totals : null
  if (corners.length) {
    const top = corners.reduce((a, b) => (b.lean > a.lean ? b : a))
    const best = rec ? Math.max(rec.maxLeanL || 0, rec.maxLeanR || 0) : 0
    const vsRec = best > 0 ? (top.lean >= best - 0.5 ? ' · <b>¡tu récord!</b>' : ` · tu récord es ${Math.round(best)}°`) : ''
    out.push(link(`Tu curva más tumbada: la <b>${top.n}</b>, <b>${Math.round(top.lean)}°</b> a la ${top.dir === 'L' ? 'izquierda' : 'derecha'} a ${sp(top.vMin)}${vsRec}`, `data-zoom="${top.i0},${top.i1},${top.apex}" data-fk="corner" data-fn="${top.n}"`))
    const fast = corners.filter((c) => c.lean >= 20)
    if (fast.length) {
      const f = fast.reduce((a, b) => (b.vMin > a.vMin ? b : a))
      if (f !== top) out.push(link(`La más rápida: la <b>${f.n}</b>, sin bajar de <b>${sp(f.vMin)}</b>`, `data-zoom="${f.i0},${f.i1},${f.apex}" data-fk="corner" data-fn="${f.n}"`))
    }
  }
  if (brakes.length) {
    const b = brakes.reduce((a, x) => (x.g > a.g ? x : a))
    out.push(link(`Frenada más fuerte: <b>${b.g.toFixed(2)} g</b>, de ${sp(b.vIn)} a ${sp(b.vOut)} en ${Math.round(b.len)} m`, `data-zoom="${b.i0},${b.i1},${b.iMax}" data-fk="brake" data-fn="${b.n}"`))
  }
  const st = rangeStats(A, i0, i1)
  if (Number.isFinite(st.vMax) && st.vMax > 0) out.push(link(`Punta: <b>${sp(st.vMax)}</b>${rec?.maxV > 0 ? (st.vMax >= rec.maxV - 0.3 ? ' · <b>¡tu récord!</b>' : ` · tu récord es ${sp(rec.maxV)}`) : ''}`, `data-i="${st.iVMax}"`))
  const HEAD = prefs.units === 'mph' ? ['m0-60', '0-60'] : ['k0-100', '0-100']
  const runs = A.runs.map((r, k) => ({ r, k })).filter(({ r }) => r.i >= i0 && r.i <= i1 && Number.isFinite(r.marks?.[HEAD[0]]))
  if (runs.length) {
    const { r, k } = runs.reduce((a, b) => (b.r.marks[HEAD[0]] < a.r.marks[HEAD[0]] ? b : a))
    const sp2 = runSpan(r)
    out.push(link(`Mejor ${HEAD[1]}: <b>${r.marks[HEAD[0]].toFixed(2)} s</b> (pasada ${k + 1})`, `data-zoom="${sp2.i0},${sp2.i1},${r.i}" data-fk="run" data-fn="${k + 1}"`))
  }
  if (st.leaned30 > 1) out.push(`<li>Fuiste tumbado más de 30° durante <b>${fmtDur(st.leaned30)}</b></li>`)
  if (!out.length) return ''
  return `<div class="hl"><h4 class="h">LO MEJOR ${isFull([i0, i1]) ? 'DE LA SALIDA' : 'DEL TRAMO'}</h4><ul>${out.join('')}</ul></div>`
}

const row = (label, value, i) => `<tr ${i != null && i >= 0 ? `data-i="${i}" class="link"` : ''}><th>${label}</th><td>${value}</td></tr>`

function renderTab() {
  const A = S.A
  const body = K('tabbody')
  if (!A) return (body.innerHTML = '')
  const [i0, i1] = S.range
  const T = {
    tramo() {
      const s = rangeStats(A, i0, i1)
      const full = i0 === 0 && i1 === A.n - 1
      const sp = (v) => `${toSpeed(v).toFixed(0)}<small> ${speedUnit()}</small>`
      // Tarjeta; con i, al pulsarla lleva el cursor a ese momento
      const card = (label, val, i, cls = '') => `<div class="stat ${cls} ${i != null && i >= 0 ? 'link' : ''}" ${i != null && i >= 0 ? `data-i="${i}" title="Ver dónde"` : ''}><span>${label}</span><b>${val}</b></div>`
      const nC = A.corners.filter((c) => c.i0 >= i0 && c.i1 <= i1).length
      const nB = A.brakes.filter((c) => c.i0 >= i0 && c.i1 <= i1).length
      const p = getKey() ? S.profile?.totals : null
      // ¿Récord de tu móvil? (comparado con lo que tenía guardado)
      const pr = (v, best) => (p && Number.isFinite(best) && best > 0 && v >= best - 0.01 ? ' best' : '')
      // Mirando una curva o un zoom: volver al tramo; mirando el tramo: ver toda la salida
      const up = S.focus ? ' <button class="linkish" data-act="toWork">volver al tramo</button>' : full ? '' : ' <button class="linkish" data-act="all">ver toda</button>'
      return `<p class="scope">${esc(placeLabel().at(-1).toUpperCase())}${up}</p>
      ${S.focus ? '' : highlights(A, i0, i1)}
      <div class="stats">
        ${card('DISTANCIA', `${toDist(s.dist).toFixed(2)}<small> ${distUnit()}</small>`)}
        ${card('EN MARCHA', fmtDur(s.moving))}
        ${card('MEDIA', sp(s.vAvg))}
        ${card('PUNTA', sp(s.vMax), s.iVMax, 'cyan' + pr(s.vMax, p?.maxV))}
        ${card('INCL. IZQ', `${s.leanL.toFixed(0)}°`, s.iLeanL, 'yellow' + pr(s.leanL, p?.maxLeanL))}
        ${card('INCL. DER', `${s.leanR.toFixed(0)}°`, s.iLeanR, 'yellow' + pr(s.leanR, p?.maxLeanR))}
        ${card('FRENADA', `${s.brake.toFixed(2)}<small> g</small>`, s.iBrake, 'red')}
        ${card('ACELERON', `${s.accel.toFixed(2)}<small> g</small>`, s.iAccel, 'green')}
        ${card('G COMBINADA', `${s.gTot.toFixed(2)}<small> g</small>`, null, 'pink' + pr(s.gTot, p?.maxG))}
        ${card('CURVAS', `${nC}`, null)}
        ${card('FRENADAS', `${nB}`, null)}
        ${card('TUMBADO +30°', fmtDur(s.leaned30))}
      </div>
      <table class="kv">
        ${row('Tiempo total', fmtDur(s.dur))}
        ${row('G lateral máx.', `${s.gLat.toFixed(2)} g`)}
        ${row('Altitud', Number.isFinite(s.altMin) ? `${Math.round(s.altMin)}–${Math.round(s.altMax)} m` : '—')}
        ${row('Sube / baja', `${Math.round(s.climb)} / ${Math.round(s.descent)} m`)}
        ${row('Vibración media', Number.isFinite(s.vib) ? `${s.vib.toFixed(2)} m/s²` : '—')}
      </table>
      <p class="note">Pulsa una tarjeta con borde para ir a ese momento. Arrastra sobre las gráficas para ver solo un tramo.${p ? ' <b class="rec-dot">★</b> = igual o mejor que tu récord del móvil.' : ''}</p>
      ${notesHtml()}`
    },
    gg() {
      return `<p class="note">${GG_HELP}</p><canvas class="gg" data-k="gg"></canvas><h4 class="h">TIEMPO A CADA INCLINACION</h4><p class="note">Cuánto rato fuiste a cada inclinación: con práctica, la parte de la derecha crece.</p><canvas class="hist" data-k="hist"></canvas>`
    },
    curvas() {
      const [w0, w1] = S.work
      const list = A.corners.filter((c) => c.i0 >= w0 && c.i1 <= w1)
      const by = { n: (a, b) => a.n - b.n, lean: (a, b) => b.lean - a.lean, v: (a, b) => b.vMin - a.vMin }
      list.sort(by[prefs.sort] || by.n)
      if (!list.length) return '<p class="note">Sin curvas en este tramo (se cuentan las de más de 12° durante al menos 1 s).</p>'
      const foc = (k, n) => (S.focus?.kind === k && S.focus.n === n ? ' focus' : '')
      return `<div class="sort">ORDEN ${[['n', 'RECORRIDO'], ['lean', 'INCLINACION'], ['v', 'VEL. MIN']].map(([k, l]) => `<button class="chip ${prefs.sort === k ? 'on' : ''}" data-sort="${k}">${l}</button>`).join('')}</div>
        <table class="grid"><thead><tr><th>#</th><th></th><th>INCL</th><th>ENTRA</th><th>MIN</th><th>SALE</th><th>G LAT</th><th>s</th></tr></thead><tbody>
        ${list
          .map(
            (c) =>
              `<tr class="link${foc('corner', c.n)}" data-zoom="${c.i0},${c.i1},${c.apex}" data-fk="corner" data-fn="${c.n}"><td>${c.n}</td><td class="${c.dir === 'L' ? 'l' : 'r'}">${c.dir === 'L' ? 'IZQ' : 'DER'}</td><td><b>${c.lean.toFixed(1)}°</b></td><td>${toSpeed(c.vIn).toFixed(0)}</td><td>${toSpeed(c.vMin).toFixed(0)}</td><td>${toSpeed(c.vOut).toFixed(0)}</td><td>${c.gLat.toFixed(2)}</td><td>${c.dur.toFixed(1)}</td></tr>`,
          )
          .join('')}</tbody></table><p class="note">${list.length} ${list.length === 1 ? 'curva' : 'curvas'} en ${isFull(S.work) ? 'toda la salida' : 'el tramo'} · velocidades en ${speedUnit()}. Clic en una para verla de cerca; ◀ ▶ (o [ ]) pasan a la anterior y la siguiente sin perder el tramo.</p>`
    },
    frenadas() {
      const [w0, w1] = S.work
      const list = A.brakes.filter((c) => c.i0 >= w0 && c.i1 <= w1)
      const foc = (n) => (S.focus?.kind === 'brake' && S.focus.n === n ? ' focus' : '')
      if (!list.length) return '<p class="note">Sin frenadas en este tramo (se cuentan las de más de 0,25 g durante al menos 0,6 s).</p>'
      return `<table class="grid"><thead><tr><th>#</th><th>G MAX</th><th>DE</th><th>A</th><th>s</th><th>m</th></tr></thead><tbody>
        ${list.map((c) => `<tr class="link${foc(c.n)}" data-zoom="${c.i0},${c.i1},${c.iMax}" data-fk="brake" data-fn="${c.n}"><td>${c.n}</td><td><b>${c.g.toFixed(2)}</b></td><td>${toSpeed(c.vIn).toFixed(0)}</td><td>${toSpeed(c.vOut).toFixed(0)}</td><td>${c.dur.toFixed(1)}</td><td>${Math.round(c.len)}</td></tr>`).join('')}
        </tbody></table><p class="note">${list.length} ${list.length === 1 ? 'frenada' : 'frenadas'} en ${isFull(S.work) ? 'toda la salida' : 'el tramo'} · velocidades en ${speedUnit()}. Clic en una para verla; ◀ ▶ (o [ ]) pasan a la siguiente.</p>`
    },
    pasadas() {
      if (!A.runs.length) return '<p class="note">Las pasadas del crono que hagas mientras graba aparecen aquí, con sus parciales.</p>'
      const NAMES = { 'k0-50': '0-50', 'k0-100': '0-100', 'k0-150': '0-150', 'k0-200': '0-200', 'k100-200': '100-200', 'm0-30': '0-30 mph', 'm0-60': '0-60 mph', 'm0-100': '0-100 mph', 'm60-130': '60-130 mph', '60ft': '60 ft', '330ft': '330 ft', '1/8': '1/8 milla', '1000ft': '1000 ft', '1/4': '1/4 milla' }
      return A.runs
        .map((r, k) => {
          const ms = Object.entries(r.marks || {})
          const sp = runSpan(r)
          return `<div class="run link${S.focus?.kind === 'run' && S.focus.n === k + 1 ? ' focus' : ''}" data-zoom="${sp.i0},${sp.i1},${r.i}" data-fk="run" data-fn="${k + 1}">
            <h4>PASADA ${k + 1} · ${fmtClock(A.meta.start + r.t * 1000)} · punta ${toSpeed(r.maxV || 0).toFixed(0)} ${speedUnit()} <button class="btn cyan small" data-runcmp="${k}">COMPARAR</button></h4>
            <table class="kv">${ms.map(([id, t]) => row(NAMES[id] || id, `${t.toFixed(2)} s`)).join('')}</table></div>`
        })
        .join('')
    },
    potencia() {
      const d = prefs.dyno
      // Los tirones, de todo el tramo de trabajo (aunque estés mirando un trozo)
      const pulls = findPulls(A, ...S.work)
      return `<div class="dyno-cfg">
          <label>Moto <input type="number" data-dyno="bike" value="${d.bike}" min="50" max="600" step="5"> kg</label>
          <label>Piloto <input type="number" data-dyno="rider" value="${d.rider}" min="30" max="200" step="1"> kg</label>
          <div class="chips">${CDA_PRESETS.map(([l, v]) => `<button class="chip ${d.cda === v ? 'on' : ''}" data-cda="${v}" title="CdA ${v} m²">${l}</button>`).join('')}</div>
          ${A.info.longFrom === 'imu' ? '<p class="note">La pendiente ya va incluida: el acelerómetro la nota.</p>' : `<label class="toggle"><input type="checkbox" data-dyno="slope" ${d.slope ? 'checked' : ''}> corregir con la pendiente (altitud del GPS)</label>`}
        </div>
        ${
          pulls.length
            ? `<div class="dyno-peak" data-k="dpeak"></div><div class="dyno-chart" data-k="dchart"></div>
               <table class="grid"><thead><tr><th>#</th><th>HORA</th><th>DE</th><th>A</th><th>PICO</th><th>A ${speedUnit().toUpperCase()}</th></tr></thead><tbody data-k="dpulls"></tbody></table>`
            : '<p class="note">No hay tirones en este tramo: hacen falta al menos 2,5 s acelerando fuerte (una pasada del crono o una aceleración a fondo).</p>'
        }
        <p class="note">Potencia que llega a la rueda, estimada con la masa, la aerodinámica y la aceleración medida. Cambia si cambias la masa o la aerodinámica: sirve para comparar antes y después de tocar la moto, no como un banco de verdad.</p>`
    },
    calidad() {
      const I = A.info
      const m = A.meta
      const gaps = new Set(A.seg).size - (A.seg.includes(-1) ? 1 : 0)
      let dl = 0
      let dc = 0
      let dv = 0
      for (let i = 0; i < A.n; i++) {
        if (!A.valid[i] || A.v[i] < 5) continue
        if (Number.isFinite(A.appLean[i])) (dl += (A.lean[i] - A.appLean[i]) ** 2), dc++
        if (Number.isFinite(A.appV[i])) dv += (A.v[i] - A.appV[i]) ** 2
      }
      const vec = (v) => (v ? `(${v.map((x) => x.toFixed(2)).join(', ')})` : '—')
      const LEAN = { gravity: 'gravedad del propio móvil', 'gyro+roll': 'giroscopio (giro + alabeo)', gyro: 'giroscopio (giro)', gps: 'rumbo del GPS', device: `la que da el aparato (${esc(m.logger?.name || '')})` }
      const c = m.calib || {}
      const calib =
        c.axes || c.leanSign != null || c.gpsLag != null
          ? `ejes ${c.axes || '—'} · sentido ${c.leanSign ?? '—'} · retraso GPS ${c.gpsLag != null ? `${c.gpsLag} s` : '—'}${c.fwd ? ' · delante aprendido' : ''}`
          : `cero ${c.leanZero != null ? `${((c.leanZero * 180) / Math.PI).toFixed(1)}°` : '—'} · signo giro ${c.gyroSign ?? '—'} (versión antigua)`
      return `<table class="kv">
        ${row('Origen', m.logger ? `${esc(m.logger.name)} · ${m.logger.hz} Hz${m.logger.file ? ` · <span class="ua">${esc(m.logger.file)}</span>` : ''}` : `${(SRC[m.source] || [m.source])[0]}${m.sim ? ` · ${m.sim.hz} Hz, ${esc(m.sim.bike)}` : ''}`)}
        ${row('Estado', m.state === 'rec' ? 'a medias (se exportó grabando)' : 'cerrada')}
        ${row('Siguió tras cerrarse', `${m.resumed || 0} ${m.resumed === 1 ? 'vez' : 'veces'}`)}
        ${row('GPS', `${I.fixes} fixes · ${I.gpsHz.toFixed(2)} Hz · ±${I.accMean.toFixed(1)} m`)}
        ${row('Tramos sin GPS (>5 s)', `${Math.max(0, gaps - 1)}`)}
        ${row('Sensores', I.hasImu ? `${(m.rows?.imu ?? 0).toLocaleString('es')} muestras · ${I.imuHz.toFixed(0)} Hz` : m.logger ? (m.logger.lean || m.logger.g ? `los del aparato: ${[m.logger.lean && 'inclinación', m.logger.g && 'G'].filter(Boolean).join(' y ')}` : 'solo GPS') : 'no hay (simulador u ordenador)')}
        ${row('Postura: arriba', vec(I.mount?.up))}
        ${row('Postura: adelante', I.mount?.fwd ? `${vec(I.mount.fwd)} · R² ${I.mount.r2.toFixed(2)}` : 'no se pudo sacar (pocas aceleraciones)')}
        ${row('G longitudinal de', I.longFrom === 'imu' ? 'acelerómetro (calibrado con el GPS)' : I.longFrom === 'device' ? 'el acelerómetro del aparato' : 'velocidad del GPS')}
        ${row('Inclinación de', `${LEAN[I.leanFrom] || I.leanFrom}${I.leanCorr ? ` · cuadra con el GPS ${I.leanCorr.toFixed(2)}` : I.yawCorr ? ` · correlación ${I.yawCorr.toFixed(2)}` : ''}`)}
        ${row('Ejes del giroscopio', I.gyroAxes === 'xyz' ? 'los del iPhone (alpha = x)' : I.gyroAxes === 'w3c' ? 'los del estándar' : '—')}
        ${row('Retraso del GPS', Number.isFinite(I.gpsLag) ? `${I.gpsLag.toFixed(1)} s medido${I.appLag ? ` · el móvil ya descontaba ${I.appLag} s` : ''}` : '—')}
        ${row('Velocidad del GPS', Number.isFinite(I.doppler) ? `en el ${Math.round(I.doppler * 100)} % de los fixes (el resto, rellenada)` : '—')}
        ${row('vs. el móvil: inclinación', dc ? `±${Math.sqrt(dl / dc).toFixed(1)}° de diferencia` : '—')}
        ${row('vs. el móvil: velocidad', dc ? `±${toSpeed(Math.sqrt(dv / dc)).toFixed(1)} ${speedUnit()}` : '—')}
        ${row('Calibración del móvil', calib)}
        ${row('Móvil', `<span class="ua">${esc(m.device?.ua || '—')}</span>`)}
        ${row('Id', `<code>${esc(m.id)}</code>`)}
      </table>`
    },
  }
  body.innerHTML = T[prefs.tab]()
  if (prefs.tab === 'gg') {
    drawGG(body.querySelector('[data-k="gg"]'), A, i0, i1, S.cur)
    drawLeanHist(body.querySelector('[data-k="hist"]'), A, i0, i1)
  }
  if (prefs.tab === 'potencia') drawDyno(body)
  markCurrentRow()
}

function markCurrentRow() {
  for (const tr of K('tabbody').querySelectorAll('[data-zoom]')) {
    const [a, b] = tr.dataset.zoom.split(',').map(Number)
    tr.classList.toggle('cur', S.cur >= a && S.cur <= b)
  }
}

// ---------- Interacción ----------
root.addEventListener('click', async (e) => {
  const b = e.target.closest('button, tr.link, div.link')
  if (!b) return
  const d = b.dataset
  if (d.open) return open(d.open)
  if (d.seg) return openSegment(d.seg)
  if (d.act === 'shared') return sharedDialog()
  if (d.act === 'friend') return friendDialog()
  if (d.act === 'link') return linkDialog()
  if (d.act === 'home') return goHome()
  if (d.act === 'analyzeAll') return analyzeAll()
  if (d.act === 'help') return modal(helpHtml(), { wide: true })
  if (d.act === 'windows') return windowsMenu()
  if (d.act === 'download') return downloadDialog()
  if (d.act === 'syncPill') return getKey() ? cloudSync() : linkDialog()
  if (d.act === 'claim') return claim(root.querySelector(`[data-k="${d.from}"]`)?.value)
  if (d.act === 'cloudSync') return cloudSync()
  if (d.act === 'unlink') {
    if (confirm('¿Desvincular este navegador de tu móvil? Las salidas ya bajadas se quedan.')) {
      setKey('')
      S.profile = null
      saveProfile(null)
      applyProfileTheme(null)
      renderCloud()
      if (!S.id) renderHome()
    }
    return
  }
  if (d.del) {
    const m = S.list.find((x) => x.id === d.del)
    const fromCloud = m?.from === 'nube' && getKey()
    if (!confirm(fromCloud ? '¿Borrar esta salida de este navegador y de la nube? (Si sigue en el móvil, allí no se toca)' : '¿Borrar esta salida de este navegador? (En el móvil sigue estando)')) return
    // Si viene de la nube, se borra también allí: si no, volvería a bajarse
    if (fromCloud) await deleteRemote(d.del).catch((e) => toast(`No se pudo borrar de la nube: ${e.message}`, 5000))
    await deleteSession(d.del)
    deleted.add(d.del)
    saveDeleted()
    if (d.del === S.id) location.hash = ''
    await refreshList()
    if (d.del === S.id) goHome()
    return
  }
  if (d.act === 'demo') return loadDemo()
  if (d.act === 'device') {
    deviceCache = await deviceSessions()
    const r = await addSessions(deviceCache, 'este móvil')
    toast(`De este móvil: ${r.added} nuevas, ${r.grown} ampliadas`)
    await refreshList()
    if (S.list[0] && !S.id) open(S.list[0].id)
    return
  }
  if (d.act === 'csv') return exportCsv()
  if (d.act === 'gpx') return exportGpx()
  if (d.tag) return toggleTag(d.tag)
  if (d.u) {
    prefs.units = units.speed = d.u
    savePrefs()
    renderUnits()
    refreshList()
    if (!S.A) return
    buildCharts()
    S.map?.setTrack(S.A, prefs.mapCh, S.range)
    // La comparación abierta también, con la unidad nueva
    if (S.cmp) (S.cmpView.show(S.cmp.C, S.A, S.cmp.B, S.cmp.labels), renderCoach(S.cmp.C, S.A, S.cmp.B))
    return renderAll()
  }
  if (!S.A) return
  if (d.act === 'all') return setRange(0, S.A.n - 1, { kind: 'all' })
  if (d.act === 'back') return goBack()
  if (d.act === 'prev') return stepFocus(-1)
  if (d.act === 'next') return stepFocus(1)
  if (d.act === 'toWork') return setRange(...S.work, { kind: 'work' })
  if (d.act === 'compare') return compareDialog()
  if (d.act === 'saveSeg') return saveSegDialog()
  if (d.act === 'share') return shareDialog()
  if (d.act === 'video') return videoButton()
  if (d.runcmp != null) return compareRunDialog(Number(d.runcmp))
  if (d.cda) {
    prefs.dyno.cda = Number(d.cda)
    savePrefs()
    return renderTab()
  }
  if (d.x) {
    prefs.xMode = d.x
    savePrefs()
    buildCharts()
    return renderAll()
  }
  if (d.mapch) {
    prefs.mapCh = d.mapch
    savePrefs()
    S.map?.setTrack(S.A, prefs.mapCh, S.range)
    return renderAll()
  }
  if (d.view) {
    prefs.charts = VIEWS[d.view][1] || [...CHART_CHANNELS]
    savePrefs()
    buildCharts()
    return renderAll()
  }
  if (d.chart) {
    const on = prefs.charts.includes(d.chart)
    prefs.charts = on ? prefs.charts.filter((x) => x !== d.chart) : CHART_CHANNELS.filter((x) => x === d.chart || prefs.charts.includes(x))
    if (!prefs.charts.length) prefs.charts = ['v']
    savePrefs()
    buildCharts()
    return renderAll()
  }
  if (d.tab) {
    prefs.tab = d.tab
    savePrefs()
    return renderAll()
  }
  if (d.sort) {
    prefs.sort = d.sort
    savePrefs()
    return renderTab()
  }
  if (d.zoom) {
    const [a, z, c] = d.zoom.split(',').map(Number)
    if (d.fk) return focusOn(d.fk, { n: Number(d.fn), i0: a, i1: z, at: c })
    setRange(a - PAD, z + PAD, { kind: 'view' })
    return setCursor(c, 'list')
  }
  if (d.i) return setCursor(Number(d.i), 'list')
})

root.addEventListener('change', (e) => {
  const k = e.target.dataset?.dyno
  if (!k) return
  prefs.dyno[k] = e.target.type === 'checkbox' ? e.target.checked : Math.max(1, Number(e.target.value) || DYNO[k])
  savePrefs()
  renderTab()
})

root.addEventListener('keydown', (e) => {
  const k = e.target.dataset?.k
  if (e.key === 'Enter' && (k === 'codeHome' || k === 'codeSide')) claim(e.target.value)
})
root.addEventListener('change', (e) => {
  if (e.target.dataset?.k !== 'homeFile') return
  importFiles([...e.target.files])
  e.target.value = ''
})

K('showApp').addEventListener('change', (e) => {
  prefs.showApp = e.target.checked
  savePrefs()
  if (S.A) buildCharts()
})

addEventListener('keydown', (e) => {
  if (!S.A || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || document.querySelector('.modal-bg')) return
  const step = e.shiftKey ? 10 : 1
  if (e.key === 'ArrowRight') setCursor(Math.min(S.range[1], S.cur + step), 'key')
  else if (e.key === 'ArrowLeft') setCursor(Math.max(S.range[0], S.cur - step), 'key')
  else if (e.key === 'Escape' || e.key === 'Backspace') goBack()
  else if (e.key === ' ' && vpanel?.on && videoShown()) vpanel.toggle()
  else if (e.key === '[') stepFocus(-1)
  else if (e.key === ']') stepFocus(1)
  else return
  e.preventDefault()
})


// ---------- Análisis en segundo plano ----------
// En un worker, para que la página no se quede parada mientras calcula; si no se puede, aquí mismo
let worker = null
let jobs = 0
const jobsWaiting = new Map()
function analyzeOff(session) {
  try {
    worker ??= (() => {
      const w = new Worker(new URL('./analyze.worker.js', import.meta.url), { type: 'module' })
      w.onmessage = (e) => {
        const p = jobsWaiting.get(e.data.job)
        jobsWaiting.delete(e.data.job)
        if (!p) return
        e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.A)
      }
      w.onerror = () => {
        // Sin worker (navegador raro): lo pendiente se hace aquí
        for (const [, p] of jobsWaiting) p.fallback()
        jobsWaiting.clear()
        worker = false
      }
      return w
    })()
  } catch {
    worker = false
  }
  if (!worker) return Promise.resolve(analyze(session))
  return new Promise((resolve, reject) => {
    const job = ++jobs
    jobsWaiting.set(job, { resolve, reject, fallback: () => resolve(analyze(session)) })
    worker.postMessage({ job, session })
  })
}

// ---------- Análisis en caché (comparar y tramos miran varias salidas) ----------
const cache = new Map()
/**
 * Una salida ha cambiado (más larga): fuera su análisis. Si es la que tienes abierta, solo se vuelve a
 * abrir si lo has pedido tú (al importarla); si llega sola de la nube, se avisa y se abre al volver a
 * pulsarla. Antes se reabría sola y, con un fallo de tamaños, cada minuto: la página parecía recargarse.
 */
function refreshAnalysis(id, { reopen = false } = {}) {
  if (!id) return
  cache.delete(id)
  if (id !== S.id || !S.A) return
  if (reopen) {
    rememberPlace()
    S.A = null
    open(id)
  } else if (S.staleId !== id) {
    S.staleId = id
    toast('Ha llegado más de esta salida: púlsala en la lista para verla entera', 6000)
  }
}
async function analysisOf(id) {
  if (S.A && S.id === id && S.staleId !== id) return S.A
  if (cache.has(id)) return cache.get(id)
  // Ya hecho otra vez (y la salida no ha cambiado): se lee y listo
  const meta = S.list.find((m) => m.id === id)
  const saved = await getAnalysis(id)
  let A = saved && saved.v === ANALYSIS_VERSION && saved.size === meta?.size ? saved.A : null
  if (!A) {
    const data = await loadSession(id)
    if (!data) return null
    A = await analyzeOff(data)
    if (!A.empty) putAnalysis({ id, size: meta?.size ?? data.meta?.size, v: ANALYSIS_VERSION, A })
  }
  cache.set(id, A)
  saveSummary(id, A)
  // Comparar y los tramos miran varias salidas: 12 análisis en memoria (~5 MB por hora de moto)
  if (cache.size > 12) cache.delete(cache.keys().next().value)
  return A
}

/** Las cifras de cada salida, guardadas en su ficha: con ellas se dibuja tu evolución sin reanalizar. */
function saveSummary(id, A) {
  const m = S.list.find((x) => x.id === id)
  if (!m || A.empty || m.sum?.v === ANALYSIS_VERSION) return
  const st = A.stats
  m.sum = { v: ANALYSIS_VERSION, vMax: st.vMax, leanL: st.leanL, leanR: st.leanR, gTot: st.gTot, brake: st.brake, accel: st.accel, dist: st.dist, moving: st.moving, corners: A.corners.length }
  m.vmaxBB = st.vMax
  m.distBB = st.dist
  updateMeta(m).catch(() => {})
}

/** Caja de la salida (las importadas antes de guardarla se calculan una vez). */
async function bboxOf(m) {
  if (m.bbox) return m.bbox
  const data = await loadSession(m.id)
  m.bbox = data ? gpsBbox(data.gps) : null
  await updateMeta(m)
  return m.bbox
}

const fmtLen = (m) => (prefs.units === 'mph' ? (m >= 1609.344 ? `${toDist(m).toFixed(2)} ${distUnit()}` : `${Math.round(m / 0.3048)} ft`) : m >= 1000 ? `${toDist(m).toFixed(2)} ${distUnit()}` : `${Math.round(m)} m`)
const when = (m, t) => fmtDateTime(m.start + t * 1000)

// ---------- Comparar ----------
/** Busca pasadas por el trazado P en todas las salidas (las de la zona) y devuelve [{id, meta, pass}]. */
async function passesEverywhere(P, onProgress, skip) {
  const out = []
  for (const m of S.list) {
    if (!bboxHit(await bboxOf(m), P.bbox)) continue
    onProgress?.(m)
    const B = await analysisOf(m.id)
    if (!B || B.empty) continue
    for (const p of findPasses(P, B)) if (!skip?.(m.id, p)) out.push({ id: m.id, meta: m, pass: p })
  }
  return out
}

async function compareDialog() {
  const A = S.A
  if (isFull(S.range)) return toast('Primero elige qué comparar: arrastra sobre las gráficas para coger un tramo, o pulsa una curva', 6000)
  const [i0, i1] = S.range
  if (A.d[i1] - A.d[i0] < 100) return toast('Elige un tramo de al menos 100 m: arrastra sobre una gráfica')
  const P = makePath(pathPoints(A, i0, i1))
  const own = findPasses(P, A, { from: i0 - 150, to: i1 + 150 })
  const ref = own.find((p) => p.i0 <= i0 + 60 && p.i1 >= i1 - 60) || own[0]
  if (!ref) return toast('No se pudo usar este tramo como referencia')
  const el = modal(`<h2>COMPARAR: ${esc(placeLabel().at(-1).toUpperCase())}</h2>
    <p class="note">${fmtLen(P.length)} · referencia: ${when(A.meta, ref.t0)} · <b>${fmtLap(ref.time)}</b></p>
    <div data-k="found"><p class="note">Buscando pasadas por aquí…</p></div>`, { wide: true })
  const box = el.querySelector('[data-k="found"]')
  const found = await passesEverywhere(P, (m) => (box.innerHTML = `<p class="note">Buscando en ${fmtDateTime(m.start)}…</p>`), (id, p) => id === S.id && Math.abs(p.t0 - ref.t0) < 1)
  if (!el.isConnected) return
  if (!found.length) return (box.innerHTML = '<p class="note">No hay otras pasadas por este tramo en tu biblioteca (ni vueltas en esta salida). Se buscan en el mismo sentido y siguiendo el trazado de principio a fin.</p>')
  found.sort((a, b) => a.pass.time - b.pass.time)
  box.innerHTML = `<table class="grid"><thead><tr><th>#</th><th>SALIDA</th><th>TIEMPO</th><th>DIF.</th><th></th></tr></thead><tbody>
    ${found.map((f, k) => `<tr class="link" data-pick="${k}"><td>${k + 1}</td><td>${when(f.meta, f.pass.t0)}${f.id === S.id ? ' · esta salida' : ''}</td><td><b>${fmtLap(f.pass.time)}</b></td><td class="${f.pass.time < ref.time ? 'gain' : 'loss'}">${f.pass.time < ref.time ? '−' : '+'}${Math.abs(f.pass.time - ref.time).toFixed(2)} s</td><td>VER</td></tr>`).join('')}
    </tbody></table>`
  box.onclick = (e) => {
    const tr = e.target.closest('[data-pick]')
    if (!tr) return
    el.close()
    const f = found[Number(tr.dataset.pick)]
    startCompare(ref, f, P.length, { refLabel: `${when(A.meta, ref.t0)}`, cmpLabel: `${when(f.meta, f.pass.t0)}`, kind: 'route' })
  }
}

async function compareRunDialog(k) {
  const A = S.A
  const run = A.runs[k]
  const ref = runPass(A, run)
  if (ref.length < 30) return toast('Pasada demasiado corta para comparar')
  const el = modal(`<h2>COMPARAR PASADA</h2><p class="note">Desde la salida, ${Math.round(ref.length)} m · ${when(A.meta, ref.t0)}</p><div data-k="found"><p class="note">Buscando tus pasadas…</p></div>`, { wide: true })
  const box = el.querySelector('[data-k="found"]')
  const found = []
  for (const m of S.list) {
    if (m.id !== S.id && m.nRuns === 0) continue
    const B = await analysisOf(m.id)
    if (!B || B.empty) continue
    B.runs.forEach((r, j) => {
      if (m.id === S.id && j === k) return
      const p = runPass(B, r)
      if (p.length >= 30) found.push({ id: m.id, meta: m, pass: p, run: r })
    })
  }
  if (!el.isConnected) return
  if (!found.length) return (box.innerHTML = '<p class="note">No hay más pasadas del crono en tu biblioteca.</p>')
  // El parcial de cabecera, en la unidad elegida (antes mezclaba 0-100 km/h y 0-60 mph)
  const HEAD = prefs.units === 'mph' ? ['m0-60', '0-60'] : ['k0-100', '0-100']
  const head = (r) => r.marks?.[HEAD[0]]
  found.sort((a, b) => (head(a.run) ?? 99) - (head(b.run) ?? 99))
  box.innerHTML = `<table class="grid"><thead><tr><th>#</th><th>PASADA</th><th>${HEAD[1]}</th><th>1/8</th><th>PUNTA</th></tr></thead><tbody>
    ${found.map((f, j) => `<tr class="link" data-pick="${j}"><td>${j + 1}</td><td>${when(f.meta, f.pass.t0)}</td><td><b>${head(f.run)?.toFixed(2) ?? '—'}</b></td><td>${f.run.marks?.['1/8']?.toFixed(2) ?? '—'}</td><td>${toSpeed(f.run.maxV || 0).toFixed(0)}</td></tr>`).join('')}
    </tbody></table>`
  box.onclick = (e) => {
    const tr = e.target.closest('[data-pick]')
    if (!tr) return
    el.close()
    const f = found[Number(tr.dataset.pick)]
    startCompare(ref, f, Math.min(ref.length, f.pass.length), { refLabel: `Pasada ${when(A.meta, ref.t0)}`, cmpLabel: `${when(f.meta, f.pass.t0)}`, kind: 'run' })
  }
}

/**
 * DÓNDE GANAS Y PIERDES: las curvas y rectas donde más tiempo cambia entre las dos pasadas, con el
 * porqué (frenada, velocidad mínima, inclinación, salida). Un clic lleva el cursor allí.
 */
function renderCoach(C, A, B) {
  K('cmp').querySelector('.coach')?.remove()
  const zones = whereTime(C, A, B).filter((z) => Math.abs(z.dt) >= 0.05)
  const total = C.delta[C.n - 1]
  if (!zones.length) return
  const opts = { speed: (v) => toSpeed(v), unit: speedUnit() }
  const name = (z) => (z.kind === 'corner' ? `Curva ${z.n} <small>(${z.dir === 'L' ? 'izq' : 'der'})</small>` : `Recta <small>(${Math.round(z.len)} m)</small>`)
  const who = S.cmp?.labels?.who ? plain(S.cmp.labels.who).toUpperCase() : 'LA ROSA'
  const html = `<div class="coach"><h4 class="h">DONDE GANA Y PIERDE ${esc(who)} <small>(total ${total >= 0 ? '+' : '−'}${Math.abs(total).toFixed(2)} s)</small></h4>
    <ul>${zones
      .slice(0, 8)
      .map((z) => {
        const why = reasons(z, opts)
        return `<li><button class="coach-row ${z.dt > 0 ? 'loss' : 'gain'}" data-coach="${z.at}"><b>${z.dt > 0 ? '+' : '−'}${Math.abs(z.dt).toFixed(2)} s</b><span>${name(z)}</span><em>${why.length ? why.join(' · ') : z.dt > 0 ? 'pierde sin una causa clara: mira la línea en el mapa' : 'gana sin una causa clara'}</em></button></li>`
      })
      .join('')}</ul>
    <p class="note">+ es tiempo que pierde ${S.cmp?.labels?.who ? `la pasada de ${esc(S.cmp.labels.who)} (rosa) respecto a la tuya (azul)` : 'la pasada rosa respecto a la azul'}; − lo que gana. Cada curva cuenta desde su frenada (${70} m antes) hasta la salida.</p></div>`
  const head = K('cmp').querySelector('.hint') || K('cmp').firstElementChild
  head.insertAdjacentHTML('afterend', html)
  K('cmp').querySelector('.coach').onclick = (e) => {
    const b = e.target.closest('[data-coach]')
    if (b) setCursor(Number(b.dataset.coach), 'list')
  }
}

let cmpResize = null
/** Compara la pasada `ref` de la salida abierta con `f` (otra pasada, de esta salida u otra). */
async function startCompare(ref, f, L, labels) {
  const B = f.B || (f.id === S.id ? S.A : await analysisOf(f.id))
  const C = compare(ref, S.A, f.pass, B, L, undefined, { own: labels?.kind === 'run' })
  S.cmp = { C, B, ref, f, labels }
  if (!cmpResize) (cmpResize = new ResizeObserver(() => S.cmp && S.cmpView?.resize?.())).observe(K('cmp'))
  K('chartsMain').hidden = true
  K('cmp').hidden = false
  S.cmpView ??= createCompareView(K('cmp'), {
    onCursor: (k) => {
      const C = S.cmp?.C
      if (!C) return
      setCursor(C.iA[k], 'cmp')
      S.map?.setCompareCursor(S.cmp.B.lon[C.iB[k]], S.cmp.B.lat[C.iB[k]])
    },
    onExit: () => exitCompare(),
  })
  S.cmpView.show(C, S.A, B, labels)
  renderCoach(C, S.A, B)
  setRange(Math.max(0, ref.i0 - 20), Math.min(S.A.n - 1, ref.i1 + 20))
  const coords = Array.from(C.iB, (i) => [B.lon[i], B.lat[i]])
  S.map?.setCompare(coords, gainColors(C))
  K('cmp').scrollIntoView({ block: 'nearest' })
}

function exitCompare() {
  S.cmp = null
  S.cmpView?.destroy()
  K('cmp').hidden = true
  K('chartsMain').hidden = false
  S.map?.setCompare(null)
  if (S.A) (buildCharts(), setRange(...S.range, { kind: 'restore' }))
}

// ---------- Tramos ----------
async function refreshSegs() {
  S.segs = await listSegments()
  K('segs').innerHTML = S.segs.length
    ? S.segs
        .map(
          (g) => `<div class="sess"><button class="sess-open" data-seg="${esc(g.id)}"><b>${esc(g.name)}</b><span>${fmtLen(g.length)}${g.best ? ` · mejor ${fmtLap(g.best)}` : ''}</span></button>${g.remoteId ? '<i class="src real">COMPARTIDO</i>' : g.circuit ? '<i class="src sim">CIRCUITO</i>' : ''}</div>`,
        )
        .join('')
    : '<p class="note">Elige un tramo en las gráficas y pulsa GUARDAR TRAMO: se cronometrará en todas tus salidas.</p>'
}

function saveSegDialog() {
  const A = S.A
  if (isFull(S.range)) return toast('Primero elige el tramo: arrastra sobre las gráficas desde donde empieza hasta donde acaba', 6000)
  const [i0, i1] = S.range
  const raw = pathPoints(A, i0, i1)
  if (raw.length < 2) return toast('En lo que ves no hay GPS (un hueco de la señal): elige otro tramo')
  const pts = closeLoop(raw)
  const P = makePath(pts)
  if (P.length < 100) return toast('Elige un tramo de al menos 100 m: arrastra sobre una gráfica')
  if (P.length > 60000) return toast('Tramo demasiado largo (máximo 60 km)')
  const el = modal(`<h2>GUARDAR TRAMO</h2>
    <p class="note">${fmtLen(P.length)}${P.closed ? ' · empieza y acaba en el mismo sitio: cuenta vueltas' : ''}</p>
    <label class="field">Nombre <input data-k="name" maxlength="60" placeholder="${P.closed ? 'Circuito de…' : 'Subida al faro'}"></label>
    <label class="toggle"><input type="checkbox" data-k="circuit"> Es un circuito cerrado al tráfico (podrás compartir su clasificación)</label>
    <p class="note">Los tramos de carretera abierta se quedan en este navegador, solo con tus tiempos.</p>
    <div class="actions"><button class="btn ghost small" data-close>CANCELAR</button><button class="btn small" data-k="ok">GUARDAR</button></div>`)
  const name = el.querySelector('[data-k="name"]')
  name.focus()
  el.querySelector('[data-k="ok"]').onclick = async () => {
    const seg = {
      id: `seg-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name.value.trim() || `Tramo ${S.segs.length + 1}`,
      points: pts,
      length: P.length,
      closed: P.closed,
      circuit: el.querySelector('[data-k="circuit"]').checked,
      bbox: P.bbox,
      createdAt: Date.now(),
      from: { session: S.id, i0, i1 },
    }
    await saveSegment(seg)
    el.close()
    await refreshSegs()
    openSegment(seg.id)
  }
}

// Sube este número si cambia cómo se buscan las pasadas: los tiempos guardados se rehacen
const EFFORTS_VERSION = `5.${ANALYSIS_VERSION}`

/** Tiempos de un tramo en toda la biblioteca (lo ya buscado se guarda). */
async function segmentEfforts(seg, onProgress) {
  const P = makePath(seg.points)
  const out = []
  for (const m of S.list) {
    if (!bboxHit(await bboxOf(m), P.bbox)) continue
    let rec = await getEfforts(seg.id, m.id)
    if (!rec || rec.size !== m.size || rec.v !== EFFORTS_VERSION) {
      onProgress?.(m)
      const A = await analysisOf(m.id)
      const list = !A || A.empty ? [] : findPasses(P, A).map((p) => {
        let vmax = 0
        let lean = 0
        for (let i = p.i0; i <= p.i1; i++) if (A.valid[i]) (vmax = Math.max(vmax, A.v[i])), (lean = Math.max(lean, Math.abs(A.lean[i])))
        return { t0: p.t0, t1: p.t1, time: p.time, i0: p.i0, i1: p.i1, vmax, lean, prof: profileOf(p, P.length) }
      })
      rec = { seg: seg.id, session: m.id, size: m.size, v: EFFORTS_VERSION, list }
      await putEfforts(rec)
    }
    for (const e of rec.list) out.push({ ...e, session: m.id, meta: m })
  }
  return out.sort((a, b) => a.time - b.time)
}

/** Pasada completa (con s, t, idx) de un tiempo guardado, para comparar. */
async function passOf(seg, e) {
  const A = await analysisOf(e.session)
  const p = findPasses(makePath(seg.points), A).find((q) => Math.abs(q.t0 - e.t0) < 1.5)
  return p && { A, p }
}

const bbDevice = () => {
  try {
    let id = localStorage.getItem('sc-bb-device')
    if (!id) localStorage.setItem('sc-bb-device', (id = crypto.getRandomValues(new Uint32Array(3)).join('').slice(0, 20)))
    return id
  } catch {
    return 'sin-almacen-' + Math.random().toString(36).slice(2, 10)
  }
}

async function openSegment(id) {
  const seg = S.segs.find((g) => g.id === id)
  if (!seg) return
  const el = modal(`<h2>${esc(seg.name)}</h2>
    <p class="note">${fmtLen(seg.length)}${seg.closed ? ' · vuelta' : ''}${seg.circuit ? ' · circuito cerrado' : ' · carretera: solo tus tiempos'}</p>
    <h4 class="h">TUS TIEMPOS</h4><div data-k="mine"><p class="note">Buscando en tus salidas…</p></div>
    <div data-k="sectors"></div>
    ${seg.circuit ? '<h4 class="h">CLASIFICACION COMPARTIDA</h4><div data-k="shared"><p class="note">Cargando…</p></div>' : ''}
    <div class="actions"><button class="btn ghost small" data-k="del">BORRAR TRAMO</button><button class="btn small" data-close>CERRAR</button></div>`, { wide: true })
  const mine = el.querySelector('[data-k="mine"]')
  const efforts = await segmentEfforts(seg, (m) => (mine.innerHTML = `<p class="note">Buscando en ${fmtDateTime(m.start)}…</p>`))
  if (seg.best !== efforts[0]?.time) {
    seg.best = efforts[0]?.time
    await saveSegment(seg)
    refreshSegs()
  }
  if (!el.isConnected) return
  mine.innerHTML = efforts.length
    ? `<table class="grid"><thead><tr><th>#</th><th>FECHA</th><th>TIEMPO</th><th>DIF.</th><th>PUNTA</th><th>INCL</th><th></th></tr></thead><tbody>
        ${efforts.map((e, k) => `<tr><td>${k + 1}</td><td>${when(e.meta, e.t0)}</td><td><b>${fmtLap(e.time)}</b></td><td>${k ? `+${(e.time - efforts[0].time).toFixed(2)}` : '—'}</td><td>${toSpeed(e.vmax).toFixed(0)}</td><td>${e.lean.toFixed(0)}°</td><td class="acts"><button class="btn ghost small" data-see="${k}">VER</button>${efforts.length > 1 ? `<button class="btn cyan small" data-vs="${k}">COMPARAR</button>` : ''}</td></tr>`).join('')}
      </tbody></table><p class="note">COMPARAR la enfrenta con tu mejor tiempo (o la mejor con la segunda).</p>`
    : '<p class="note">Todavía no hay ninguna pasada completa por este tramo en tu biblioteca.</p>'
  mine.onclick = async (e) => {
    const b = e.target.closest('button')
    if (!b) return
    if (b.dataset.see) {
      const f = efforts[Number(b.dataset.see)]
      el.close()
      return open(f.session, { range: [f.i0 - 30, f.i1 + 30], cur: f.i0 })
    }
    if (b.dataset.vs) {
      const k = Number(b.dataset.vs)
      const best = efforts[k === 0 ? 1 : 0]
      const other = efforts[k]
      // Referencia: la mejor (o la que pides, si es la mejor, contra la segunda)
      const [refE, cmpE] = k === 0 ? [other, best] : [best, other]
      el.close()
      await open(refE.session)
      const r = await passOf(seg, refE)
      const c = await passOf(seg, cmpE)
      if (!r || !c) return toast('No se pudieron alinear las dos pasadas')
      startCompare(r.p, { id: cmpE.session, meta: cmpE.meta, pass: c.p }, seg.length, { refLabel: `${when(refE.meta, refE.t0)}`, cmpLabel: `${when(cmpE.meta, cmpE.t0)}`, kind: 'route' })
    }
  }
  el.querySelector('[data-k="del"]').onclick = async () => {
    if (!confirm(`¿Borrar el tramo «${seg.name}»? Tus salidas no se tocan.`)) return
    await deleteSegment(seg.id)
    el.close()
    refreshSegs()
  }
  renderSectors(seg, efforts, el.querySelector('[data-k="sectors"]'))
  // Tu evolución en este tramo: el mejor tiempo de cada día (más baja la barra, mejor)
  if (efforts.length >= 2) {
    const byDay = new Map()
    for (const e of efforts) {
      const k = new Date(e.meta.start).toDateString()
      if (!byDay.has(k) || e.time < byDay.get(k).time) byDay.set(k, e)
    }
    const days = [...byDay.values()].sort((a, b) => a.meta.start - b.meta.start)
    if (days.length >= 2) {
      const worst = Math.max(...days.map((e) => e.time))
      // Barras: lo que mejoras respecto a tu peor día (más alta, mejor)
      const items = days.map((e) => ({ label: new Date(e.meta.start).toLocaleDateString('es', { day: 'numeric', month: 'short' }), y: worst - e.time + 0.2, title: `${fmtDateTime(e.meta.start)}: ${fmtLap(e.time)}` }))
      el.querySelector('[data-k="sectors"]').insertAdjacentHTML('beforebegin', `<h4 class="h">TU EVOLUCION AQUI</h4><div class="evo-card">${bars(items, { color: 'green', fmt: () => `mejor ${fmtLap(Math.min(...days.map((e) => e.time)))}` })}<p class="note">Tu mejor tiempo de cada día: cuanto más alta la barra, más rápido.</p></div>`)
    }
  }
  if (seg.circuit) renderShared(seg, efforts, el.querySelector('[data-k="shared"]'))
}

/**
 * Sectores del tramo: el tiempo de cada pasada en cada trozo, el mejor de cada uno (en morado, como en
 * la F1) y la vuelta óptima: lo que harías si juntaras tus mejores sectores. Dice también en qué sector
 * se te va más tiempo respecto a ese ideal.
 */
function renderSectors(seg, efforts, box) {
  const list = efforts.filter((e) => Array.isArray(e.prof) && e.prof.length === 101)
  if (list.length < 2) return (box.innerHTML = '')
  const n = seg.sectors || 3
  const { rows, best, optimal } = sectors(list.map((e) => e.prof), n)
  const top = list[0]
  const gain = top.time - optimal
  // Dónde se te va más tiempo en tu mejor pasada (respecto al mejor de cada sector)
  const loss = rows[0].map((v, k) => v - best[k])
  const worst = loss.indexOf(Math.max(...loss))
  const sp = (v) => fmtLap(v)
  box.innerHTML = `<h4 class="h">SECTORES</h4>
    <div class="sort">TROZOS ${[2, 3, 4, 5, 6].map((k) => `<button class="chip ${k === n ? 'on' : ''}" data-nsec="${k}">${k}</button>`).join('')}</div>
    <p class="note">${seg.closed ? 'Vuelta' : 'Tramo'} óptima: <b>${sp(optimal)}</b>${gain > 0.005 ? ` · juntando tus mejores sectores irías <b>${gain.toFixed(2)} s</b> más rápido que tu mejor ${seg.closed ? 'vuelta' : 'pasada'}` : ' · tu mejor pasada ya es la óptima'}.${gain > 0.005 && loss[worst] > 0.005 ? ` En tu mejor, donde más se te va es el <b>sector ${worst + 1}</b> (+${loss[worst].toFixed(2)} s).` : ''}</p>
    <table class="grid sectors"><thead><tr><th>#</th><th>FECHA</th>${best.map((_, k) => `<th>S${k + 1}</th>`).join('')}<th>TOTAL</th></tr></thead><tbody>
      ${list
        .slice(0, 30)
        .map((e, j) => `<tr><td>${j + 1}</td><td>${when(e.meta, e.t0)}</td>${rows[j].map((v, k) => `<td class="${v <= best[k] + 0.0005 ? 'sbest' : ''}">${v.toFixed(2)}</td>`).join('')}<td><b>${sp(e.time)}</b></td></tr>`)
        .join('')}
      <tr class="optimal"><td>★</td><td>ÓPTIMA</td>${best.map((v) => `<td>${v.toFixed(2)}</td>`).join('')}<td><b>${sp(optimal)}</b></td></tr>
    </tbody></table>
    <p class="note">En morado, el mejor tiempo de cada sector. Los sectores son trozos iguales del ${seg.closed ? 'circuito' : 'tramo'}.</p>`
  box.onclick = async (e) => {
    const b = e.target.closest('[data-nsec]')
    if (!b) return
    seg.sectors = Number(b.dataset.nsec)
    await saveSegment(seg)
    renderSectors(seg, efforts, box)
  }
}

async function renderShared(seg, efforts, box) {
  if (!cloudAvailable()) return (box.innerHTML = '<p class="note">Esta versión no tiene servidor.</p>')
  if (!seg.remoteId) {
    box.innerHTML = `<p class="note">Este circuito aún no está compartido. Al compartirlo, cualquiera con el Blackbox podrá añadirlo y publicar sus tiempos.</p><button class="btn small" data-k="share">COMPARTIR CIRCUITO</button>`
    box.querySelector('[data-k="share"]').onclick = async () => {
      const author = askRider()
      if (author == null) return
      try {
        const r = await shareCircuit(seg, author)
        seg.remoteId = r.id
        await saveSegment(seg)
        refreshSegs()
        renderShared(seg, efforts, box)
      } catch (e) {
        toast(`No se pudo compartir: ${e.message}`, 5000)
      }
    }
    return
  }
  try {
    const rows = await ranking(seg.remoteId)
    const me = bbDevice()
    box.innerHTML = `${
      rows.length
        ? `<table class="grid"><thead><tr><th>#</th><th>PILOTO</th><th>MOTO</th><th>TIEMPO</th><th>FECHA</th><th></th></tr></thead><tbody>${rows
            .map((r, k) => `<tr class="${r.device === me ? 'cur' : ''}"><td>${k + 1}</td><td>${esc(r.rider)}</td><td>${esc(r.bike)}</td><td><b>${fmtLap(r.time_s)}</b></td><td>${fmtDateTime(Date.parse(r.ridden_at))}</td><td class="acts">${r.ghost && r.device !== me ? `<button class="btn cyan small" data-vsg="${esc(r.ghost)}" title="Tu mejor vuelta contra la suya, metro a metro">VS</button>` : ''}</td></tr>`)
            .join('')}</tbody></table>`
        : '<p class="note">Nadie ha publicado todavía.</p>'
    }${efforts.length ? `<button class="btn small" data-k="pub">PUBLICAR MI MEJOR (${fmtLap(efforts[0].time)})</button>` : ''}<p class="note">Los tiempos se publican tal cual, sin comprobar: es una clasificación entre amigos.</p>`
    box.onclick = async (ev) => {
      const b = ev.target.closest('[data-vsg]')
      if (!b) return
      const mine = efforts.find((x) => (x.meta.source || 'real') === 'real') || efforts[0]
      if (!mine) return toast('Aún no tienes ninguna vuelta en este circuito para compararte', 5000)
      try {
        const G = unpackGhost(await fetchGhost(b.dataset.vsg))
        if (!G.pass) throw new Error('su pasada no encaja con el circuito')
        box.closest('.modal-bg')?.close()
        await open(mine.session)
        const r = await passOf(seg, mine)
        if (!r) throw new Error('no se encontró tu vuelta')
        await compareWithFriend({ id: mine.session, meta: mine.meta, pass: r.p }, G)
      } catch (err) {
        toast(`No se pudo comparar: ${err.message}`, 5000)
      }
    }
    const pub = box.querySelector('[data-k="pub"]')
    if (pub)
      pub.onclick = async () => {
        const rider = askRider()
        if (rider == null) return
        // Solo salidas de verdad: ni la demo ni el simulador van a la clasificación
        const e = efforts.find((x) => (x.meta.source || 'real') === 'real')
        if (!e) return toast('Solo se publican tiempos de salidas reales (no de la demo ni del simulador)', 5000)
        try {
          // Con la pasada, para que los demás puedan compararse con ella (si no se puede, solo el tiempo)
          let ghost = null
          try {
            const r = await passOf(seg, e)
            if (r) ghost = await shareGhost(packGhost(r.A, r.p, seg.points, { name: seg.name, rider, bike: e.meta.rider?.bike || '' }))
          } catch (err) {
            console.warn('Sin pasada para compartir', err)
          }
          await publishEffort({ segment_id: seg.remoteId, rider, bike: String(e.meta.rider?.bike || '').slice(0, 30), time_s: e.time, v_max: Math.min(150, e.vmax), lean_max: Math.min(80, e.lean), ridden_at: new Date(e.meta.start + e.t0 * 1000).toISOString(), device: me, ghost })
          toast('TIEMPO PUBLICADO')
        } catch (err) {
          toast(/duplicate|unique/i.test(err.message) ? 'Ese tiempo ya estaba publicado' : `No se pudo publicar: ${err.message}`, 5000)
        }
        renderShared(seg, efforts, box)
      }
  } catch (e) {
    box.innerHTML = `<p class="note">No se pudo cargar la clasificación: ${esc(e.message)}</p>`
  }
}

function askRider() {
  const name = prompt('Tu nombre (lo verán los demás):', prefs.rider || S.profile?.name || '')
  if (name == null) return null
  const clean = name.trim().slice(0, 30)
  if (!clean) return null
  prefs.rider = clean
  savePrefs()
  return clean
}

async function sharedDialog() {
  if (!cloudAvailable()) return toast('Esta versión no tiene servidor')
  const el = modal(`<h2>CIRCUITOS COMPARTIDOS</h2><div data-k="list"><p class="note">Cargando…</p></div><div class="actions"><button class="btn small" data-close>CERRAR</button></div>`, { wide: true })
  const box = el.querySelector('[data-k="list"]')
  try {
    const list = await sharedCircuits()
    const have = new Set(S.segs.map((g) => g.remoteId).filter(Boolean))
    box.innerHTML = list.length
      ? `<table class="grid"><thead><tr><th>CIRCUITO</th><th>LONG.</th><th>DE</th><th></th></tr></thead><tbody>${list
          .map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${fmtLen(c.length_m)}</td><td>${esc(c.author)}</td><td>${have.has(c.id) ? 'AÑADIDO' : `<button class="btn small" data-add="${c.id}">AÑADIR</button>`}</td></tr>`)
          .join('')}</tbody></table>`
      : '<p class="note">Aún no hay ninguno. Guarda un tramo marcándolo como circuito y compártelo desde su ficha.</p>'
    box.onclick = async (e) => {
      const b = e.target.closest('[data-add]')
      if (!b) return
      try {
        const c = await sharedCircuit(b.dataset.add)
        const P = makePath(c.points)
        await saveSegment({ id: `seg-r-${c.id}`, name: c.name, points: c.points, length: P.length, closed: c.closed, circuit: true, remoteId: c.id, bbox: P.bbox, createdAt: Date.now() })
        b.outerHTML = 'AÑADIDO'
        refreshSegs()
      } catch (err) {
        toast(`No se pudo añadir: ${err.message}`, 5000)
      }
    }
  } catch (e) {
    box.innerHTML = `<p class="note">No se pudo cargar: ${esc(e.message)}</p>`
  }
}

// ---------- Potencia ----------
let dynoPlot = null
function drawDyno(body) {
  dynoPlot?.destroy()
  dynoPlot = null
  const A = S.A
  const host = body.querySelector('[data-k="dchart"]')
  if (!host) return
  // Del tramo de trabajo, como la lista (antes miraba lo que se ve y con una curva en pantalla fallaba)
  const pulls = findPulls(A, ...S.work)
  const curves = pulls.map((p) => ({ p, c: pullCurve(A, p, prefs.dyno) }))
  const env = envelope(curves.map((x) => x.c))
  if (!env.cv?.length) return
  const peakJ = env.cv.reduce((b, v, j) => (v > env.cv[b] ? j : b), 0)
  const sp = (kmh) => (units.speed === 'mph' ? kmh / 1.609344 : kmh)
  body.querySelector('[data-k="dpeak"]').innerHTML = `<b>${env.cv[peakJ].toFixed(0)} CV</b> en rueda <small>(${(env.cv[peakJ] * 0.7355).toFixed(0)} kW)</small> a ${sp(env.kmh[peakJ]).toFixed(0)} ${speedUnit()}`
  body.querySelector('[data-k="dpulls"]').innerHTML = curves
    .map(({ p, c }, k) => `<tr class="link" data-zoom="${p.i0},${p.i1},${p.i0}"><td>${k + 1}</td><td>${fmtClock(A.meta.start + A.t[p.i0] * 1000)}</td><td>${toSpeed(p.v0).toFixed(0)}</td><td>${toSpeed(p.v1).toFixed(0)}</td><td><b>${c.peak.cv.toFixed(0)} CV</b></td><td>${sp(c.peak.kmh).toFixed(0)}</td></tr>`)
    .join('')
  // Todas las curvas sobre el mismo eje de velocidad
  const xs = env.kmh
  const COLORS = ['cyan', 'pink', 'green', 'orange', 'violet'].map(pal)
  const series = [{}, { stroke: pal('yellow'), width: 2.5, label: 'Máx' }]
  const data = [xs.map(sp), env.cv]
  curves.slice(0, 5).forEach(({ c }, k) => {
    const map = new Map(c.kmh.map((v, j) => [v, c.cv[j]]))
    series.push({ stroke: COLORS[k], width: 1, dash: [3, 3] })
    data.push(xs.map((v) => map.get(v) ?? null))
  })
  dynoPlot = new uPlot(
    {
      width: Math.max(200, host.clientWidth),
      height: 200,
      legend: { show: false },
      cursor: { points: { show: false } },
      scales: { x: { time: false }, y: { range: (u, mn, mx) => [0, Math.max(10, mx * 1.1)] } },
      axes: [
        { stroke: pal('dim'), font: '11px ui-monospace, Menlo, monospace', grid: { stroke: pal('grid') }, ticks: { stroke: pal('grid') }, label: speedUnit(), labelFont: '11px ui-monospace, Menlo, monospace', labelSize: 18 },
        { stroke: pal('dim'), font: '11px ui-monospace, Menlo, monospace', grid: { stroke: pal('grid') }, ticks: { stroke: pal('grid') }, label: 'CV', labelFont: '11px ui-monospace, Menlo, monospace', labelSize: 18, size: 44 },
      ],
      series: series.map((x, k) => (k ? { ...x, points: { show: false }, spanGaps: true } : x)),
    },
    data,
    host,
  )
}

// ---------- Móvil vinculado, perfil e inicio ----------
const codeInput = (k = 'code') => `<div class="code-in"><input data-k="${k}" maxlength="7" placeholder="ABC 123" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Código de 6 letras"><button class="btn small" data-act="claim" data-from="${k}">VINCULAR</button></div>`
const recName = (p) => (p?.name ? esc(p.name) : 'Tu móvil')

/** Píldora de arriba: vinculado y al día, bajando, o sin vincular. */
function renderSync(status = '', state = '') {
  const k = getKey()
  const el = K('sync')
  if (!cloudAvailable()) return (el.hidden = true)
  el.className = `sync ${!k ? 'off' : state}`
  el.textContent = !k ? 'VINCULAR MOVIL' : state === 'busy' ? 'BAJANDO…' : state === 'err' ? 'SIN CONEXION' : 'AL DIA'
  el.title = !k ? 'Vincula este ordenador con tu móvil para que lleguen solas tus salidas' : status || 'Vinculado: las salidas que sube tu móvil llegan solas'
}

function renderCloud(status = '', state = '') {
  renderSync(status, state)
  const k = getKey()
  K('cloud').innerHTML = !cloudAvailable()
    ? ''
    : k
      ? `<div class="linked"><span><b>${recName(S.profile)}</b> · vinculado</span><small>${esc(status || 'Las salidas que sube tu móvil llegan solas')}</small><div class="lib-btns"><button class="btn ghost small" data-act="cloudSync" title="Mirar ya si hay salidas nuevas">ACTUALIZAR</button><button class="btn ghost small" data-act="unlink">DESVINCULAR</button></div></div>`
      : `<div class="linked off"><b>Vincula tu móvil</b><small>En la app: Garaje → Datos → Vincular el ordenador, y escribe aquí el código</small>${codeInput('codeSide')}<button class="linkish" data-act="link">tengo la clave larga</button></div>`
  renderRider()
}

/** Ficha corta del piloto en la barra de la izquierda. */
function renderRider() {
  const p = S.profile
  const el = K('rider')
  if (!p || !getKey()) return (el.innerHTML = '')
  const lv = p.level || {}
  el.innerHTML = `<button class="rider-card" data-act="home" title="Ver tu perfil">
    <span class="av">${esc((p.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>
    <span class="who"><b>${esc(p.name || 'PILOTO')}</b><small>${esc(p.bike || 'Sin moto')} · NIVEL ${lv.n ?? 1}</small></span>
    <i class="xp"><i style="width:${Math.round((lv.frac ?? 0) * 100)}%"></i></i>
  </button>`
}

const MARK_LABEL = { 'k0-50': '0-50', 'k0-100': '0-100', 'k100-200': '100-200', 'm0-30': '0-30', 'm0-60': '0-60', 'm60-130': '60-130', '60ft': '60 FT', '330ft': '330 FT', '1/8': '1/8', '1000ft': '1000 FT', '1/4': '1/4' }
const HOME_MARKS = { kmh: ['k0-50', 'k0-100', '60ft', '1/8', '1/4'], mph: ['m0-30', 'm0-60', '60ft', '1/8', '1/4'] }

/** Inicio: sin vincular, cómo empezar; vinculado, tu perfil, tus récords y tus últimas salidas. */
function renderHome() {
  if (S.id) return
  const el = K('empty')
  el.hidden = false
  K('work').hidden = true
  K('title').innerHTML = S.profile?.name && getKey() ? `Hola, <b>${esc(S.profile.name)}</b>` : 'Analizador de telemetría'
  const linked = !!getKey()
  const p = linked ? S.profile : null
  const recent = S.list.slice(0, 6)
  const rideCards = recent.length
    ? `<div class="ride-cards">${recent
        .map(
          (m) => `<button class="ride-card" data-open="${esc(m.id)}">
            <span class="rc-day">${dayLabel(m.start)} · ${fmtClock(m.start).slice(0, 5)}${S.fresh.has(m.id) ? ' <em class="new">NUEVA</em>' : ''}</span>
            <b>${toDist(distOf(m)).toFixed(1)} <small>${distUnit()}</small></b>
            <span>${fmtDur((m.end - m.start) / 1000)} · punta ${Math.round(toSpeed(vmaxOf(m)))} ${speedUnit()}</span>
          </button>`,
        )
        .join('')}</div>`
    : ''
  const onboarding = `<section class="onboard">
      <h2>TU CAJA NEGRA</h2>
      <p>Cada salida que graba tu móvil aparece aquí sola: el recorrido en el mapa, gráficas, curvas, frenadas, pasadas y potencia.</p>
      <ol class="steps">
        <li><b>1</b><span>En el móvil, abre Street Chaos: <i>Garaje → Datos → Vincular el ordenador</i>.</span></li>
        <li><b>2</b><span>Escribe aquí el código de 6 letras que te sale:</span>${codeInput('codeHome')}</li>
        <li><b>3</b><span>Listo: tus salidas, tus récords y tu tema de colores llegan solos.</span></li>
      </ol>
      <p class="alt"><button class="linkish" data-act="help">¿Cómo se leen los datos?</button> · Otras formas: <button class="linkish" data-act="link">pegar la clave larga</button> · <label class="linkish" title="El .json del móvil, o de otro aparato: RaceBox, RaceChrono, VBOX, GPX o NMEA">importar un archivo<input type="file" accept=".json,application/json,.gpx,.csv,.vbo,.nmea,.nma,.txt" multiple hidden data-k="homeFile"></label> · <button class="linkish" data-act="demo">ver la demo</button></p>
    </section>`
  if (!p) {
    el.innerHTML = `${linked ? `<section class="onboard"><h2>VINCULADO</h2><p>${S.list.length ? 'Tus salidas llegan solas. Elige una a la izquierda o aquí abajo.' : 'Aún no ha llegado nada: el móvil sube cada salida al terminarla (con conexión). Si acabas de vincularlo, abre la app en el móvil un momento.'}</p></section>` : onboarding}${rideCards ? `<h3 class="h">ULTIMAS SALIDAS</h3>${rideCards}` : ''}${evolutionHtml()}`
    return
  }
  const t = p.totals || {}
  const lv = p.level || {}
  const sp = (v) => (Number.isFinite(v) && v > 0 ? `${Math.round(toSpeed(v))} <small>${speedUnit()}</small>` : '—')
  const marks = (HOME_MARKS[prefs.units] || HOME_MARKS.kmh).filter((id) => p.bests?.[id]?.t)
  const rec = (label, val, sub = '') => `<div class="rec"><span>${label}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`
  el.innerHTML = `<section class="profile">
      <div class="pf-head">
        <span class="av big">${esc((p.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>
        <div><h2>${esc(p.name || 'PILOTO')}</h2><p>${esc(p.bike || 'Sin moto')} · <b>NIVEL ${lv.n ?? 1}</b> ${esc(lv.rank || '')} · ${p.achievements?.got ?? 0}/${p.achievements?.total ?? 0} logros</p><i class="xp big"><i style="width:${Math.round((lv.frac ?? 0) * 100)}%"></i></i></div>
      </div>
      <div class="recs">
        ${rec('PUNTA', sp(t.maxV))}
        ${rec('INCLINACION', Number.isFinite(t.maxLeanL) ? `${Math.round(t.maxLeanL)}° · ${Math.round(t.maxLeanR)}°` : '—', 'izq · der')}
        ${rec('G MAXIMA', Number.isFinite(t.maxG) && t.maxG > 0 ? `${t.maxG.toFixed(2)} <small>g</small>` : '—')}
        ${rec('RECORRIDO', `${toDist(t.odo || 0).toFixed(0)} <small>${distUnit()}</small>`, `${t.sessions || 0} salidas`)}
        ${marks.map((id) => rec(MARK_LABEL[id] || id, `${p.bests[id].t.toFixed(2)} <small>s</small>`, new Date(p.bests[id].date).toLocaleDateString('es', { day: 'numeric', month: 'short' }))).join('')}
      </div>
      <p class="note">Datos de tu móvil${p.updatedAt ? ` · ${new Date(p.updatedAt).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}. Pulsa una salida para analizarla.</p>
    </section>
    ${rideCards ? `<h3 class="h">ULTIMAS SALIDAS</h3>${rideCards}` : '<p class="note">Aún no ha llegado ninguna salida: el móvil sube cada una al terminarla.</p>'}
    ${evolutionHtml()}`
}

// ---------- Tu evolución ----------
/** Barras pequeñas (SVG, colores del tema): [{ label, y, title }] */
function bars(items, { h = 84, color = 'cyan', fmt = (v) => v.toFixed(0), w = 280 } = {}) {
  if (!items.length) return ''
  const max = Math.max(...items.map((x) => x.y), 1e-9)
  const bw = Math.max(3, Math.min(22, (w - 10) / items.length - 2))
  const best = items.reduce((a, b) => (b.y > a.y ? b : a))
  return `<svg class="evo" viewBox="0 0 ${w} ${h + 14}" width="100%" preserveAspectRatio="none">
    ${items.map((x, k) => {
      const bh = Math.max(1, (x.y / max) * h)
      return `<rect x="${5 + k * (bw + 2)}" y="${h - bh}" width="${bw}" height="${bh}" fill="var(--${x === best ? 'yellow' : color})"><title>${esc(x.title)}</title></rect>`
    }).join('')}
    <text x="${w - 4}" y="10" text-anchor="end" fill="var(--dim)" font-size="10">máx ${fmt(max)}</text>
    <text x="4" y="${h + 12}" fill="var(--dim)" font-size="9">${esc(items[0].label)}</text>
    <text x="${w - 4}" y="${h + 12}" text-anchor="end" fill="var(--dim)" font-size="9">${esc(items.at(-1).label)}</text>
  </svg>`
}

/** Tus salidas reales con su resumen, de la más antigua a la más nueva. */
const realRides = () => S.list.filter((m) => (m.source || 'real') === 'real').slice().reverse()
function evolutionHtml() {
  const rides = realRides()
  if (rides.length < 2) return ''
  const done = rides.filter((m) => m.sum?.v === ANALYSIS_VERSION)
  const missing = rides.length - done.length
  const d = (m) => new Date(m.start).toLocaleDateString('es', { day: 'numeric', month: 'short' })
  // Kilómetros por semana (las últimas 12)
  const weeks = new Map()
  for (const m of rides) {
    const t = new Date(m.start)
    const monday = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7))
    const k = monday.getTime()
    weeks.set(k, (weeks.get(k) || 0) + (m.sum?.dist ?? m.distBB ?? m.dist ?? 0))
  }
  const wk = [...weeks.entries()].sort((a, b) => a[0] - b[0]).slice(-12).map(([k, v]) => ({ label: new Date(k).toLocaleDateString('es', { day: 'numeric', month: 'short' }), y: toDist(v), title: `Semana del ${new Date(k).toLocaleDateString('es', { day: 'numeric', month: 'long' })}: ${toDist(v).toFixed(1)} ${distUnit()}` }))
  const last = done.slice(-30)
  const lean = last.map((m) => ({ label: d(m), y: Math.max(m.sum.leanL, m.sum.leanR), title: `${fmtDateTime(m.start)}: ${Math.round(m.sum.leanL)}° izq · ${Math.round(m.sum.leanR)}° der` }))
  const vmax = last.map((m) => ({ label: d(m), y: toSpeed(m.sum.vMax), title: `${fmtDateTime(m.start)}: ${Math.round(toSpeed(m.sum.vMax))} ${speedUnit()}` }))
  return `<h3 class="h">TU EVOLUCION</h3>
    <div class="evo-grid">
      ${lean.length ? `<div class="evo-card"><span>INCLINACION MAXIMA POR SALIDA</span>${bars(lean, { color: 'cyan', fmt: (v) => `${Math.round(v)}°` })}</div>` : ''}
      ${vmax.length ? `<div class="evo-card"><span>PUNTA POR SALIDA</span>${bars(vmax, { color: 'pink', fmt: (v) => `${Math.round(v)} ${speedUnit()}` })}</div>` : ''}
      <div class="evo-card"><span>${distUnit().toUpperCase()} POR SEMANA</span>${bars(wk, { color: 'green', fmt: (v) => v.toFixed(0) })}</div>
    </div>
    ${missing ? `<p class="note">${missing} ${missing === 1 ? 'salida aún no está analizada' : 'salidas aún no están analizadas'} y no salen en las gráficas. <button class="linkish" data-act="analyzeAll">Analizarlas ahora</button></p>` : '<p class="note">En amarillo, tu mejor marca. Pasa el ratón por una barra para ver la salida.</p>'}`
}

/** Analiza las salidas que falten (en segundo plano) para completar tu evolución. */
let analyzingAll = false
async function analyzeAll() {
  if (analyzingAll) return
  analyzingAll = true
  const todo = realRides().filter((m) => m.sum?.v !== ANALYSIS_VERSION)
  let n = 0
  for (const m of todo) {
    toast(`Analizando ${++n} de ${todo.length}…`, 4000)
    try {
      await analysisOf(m.id)
    } catch {}
  }
  analyzingAll = false
  toast('Listo: tu evolución está completa')
  if (!S.id) renderHome()
}

/** Vuelve al inicio (perfil y salidas). */
function goHome() {
  if (S.cmp) exitCompare()
  rememberPlace()
  send({ type: 'home' })
  S.id = null
  S.A = null
  history.replaceState(null, '', location.pathname + location.search)
  root.querySelector('[data-act="csv"]').disabled = true
  root.querySelector('[data-act="gpx"]').disabled = true
  refreshList()
}

async function claim(raw) {
  const code = normCode(raw)
  if (code.length !== 6) return toast('El código tiene 6 letras y números (míralo en el móvil)')
  try {
    await claimCode(code)
    toast('¡Vinculado! Bajando tus salidas…')
    await cloudSync()
  } catch (e) {
    toast(e.message, 6000)
  }
}

function linkDialog() {
  const el = modal(`<h2>VINCULAR CON TU MOVIL</h2>
    <p class="note">Lo más fácil: en la app, <b>Garaje → Datos → Vincular el ordenador</b>, y escribe el código de 6 letras.</p>
    ${codeInput('codeModal')}
    <details><summary class="note">Tengo la clave larga</summary><p class="note">Está en Garaje → Datos → Enlace al ordenador.</p><label class="field">Clave <input data-k="key" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autocapitalize="characters" spellcheck="false"></label><div class="actions"><button class="btn small ghost" data-k="ok">USAR LA CLAVE</button></div></details>
    <div class="actions"><button class="btn ghost small" data-close>CANCELAR</button></div>`)
  el.querySelector('[data-k="codeModal"]').focus()
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act="claim"]')
    if (b) {
      await claim(el.querySelector('[data-k="codeModal"]').value)
      if (getKey()) el.close()
    }
  })
  el.querySelector('[data-k="codeModal"]').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return
    await claim(e.target.value)
    if (getKey()) el.close()
  })
  el.querySelector('[data-k="ok"]').onclick = () => {
    const k = normKey(el.querySelector('[data-k="key"]').value)
    if (!validKey(k)) return toast('Esa clave no tiene el formato bueno')
    setKey(k)
    el.close()
    cloudSync()
  }
}

/** Perfil del móvil: se guarda, se pinta con su tema y se refresca lo que dependa de los colores. */
async function syncProfile() {
  const p = await fetchProfile().catch(() => undefined)
  if (p === undefined) return
  const changed = JSON.stringify(p) !== JSON.stringify(S.profile)
  S.profile = p
  saveProfile(p)
  if (applyProfileTheme(p)) {
    // Lo dibujado lleva los colores dentro: se vuelve a dibujar con el tema nuevo, sin recargar la página
    // (antes se recargaba y se perdía el zoom, la comparación o lo que estuvieras escribiendo)
    S.map?.restyle().then(() => S.A && (S.map.setTrack(S.A, prefs.mapCh, S.range), S.map.setMarks(marks(S.A)), S.map.setCursor(S.cur)))
    if (S.A && !S.cmp) (buildCharts(), renderAll())
  }
  if (changed) renderCloud()
}

let syncing = null
function cloudSync({ quiet = false } = {}) {
  syncing ??= (async () => {
    if (!getKey() || !cloudAvailable()) return renderCloud()
    // La de cada minuto va callada: no se toca la pantalla salvo que llegue algo
    if (!quiet) renderCloud('Mirando si hay salidas nuevas…', 'busy')
    try {
      await syncProfile()
      const remote = await listRemote()
      const have = new Map(S.list.map((m) => [m.id, m]))
      // Lo que la nube tiene de cada salida (remoteBytes) se apunta al bajarla: así no se vuelve a bajar
      // la misma cada minuto aunque el tamaño guardado aquí no coincida con el de la ficha de la nube
      const todo = remote.filter((r) => {
        if (deleted.has(r.id)) return false
        const h = have.get(r.id)
        return !h || (h.remoteBytes ?? h.bytes ?? 0) < (r.meta?.bytes ?? 0)
      })
      let n = 0
      let failed = 0
      let fetched = 0
      for (const r of todo) {
        renderCloud(`Bajando ${++n} de ${todo.length}…`, 'busy')
        // Una salida rota no para las demás (antes atascaba la sincronización para siempre)
        try {
          const sess = await fetchRemote(r.id)
          const res = await addSessions([sess], 'nube')
          const meta = (await listSessions()).find((m) => m.id === r.id)
          if (meta) await updateMeta({ ...meta, remoteBytes: r.meta?.bytes ?? 0 })
          // Solo cuenta (y se repinta) si es nueva o ha crecido de verdad
          if (!have.has(r.id)) (S.fresh.add(r.id), fetched++)
          else if (res.grown) (refreshAnalysis(r.id), fetched++)
        } catch (e) {
          failed++
          console.warn('No se pudo bajar', r.id, e)
        }
      }
      // La lista solo se repinta si ha llegado algo (repintarla cada minuto parecía una recarga)
      if (fetched || failed) await refreshList()
      lastSync = Date.now()
      const ok = fetched
      const status = failed ? `${failed} no se ${failed === 1 ? 'pudo' : 'pudieron'} bajar: se reintenta en un minuto` : ok ? `${ok} ${ok === 1 ? 'salida nueva' : 'salidas nuevas'}` : `Al día · ${remote.length} en la nube · ${fmtClock(lastSync).slice(0, 5)}`
      // Sin novedades, solo cambia el texto del estado (nada se repinta)
      const small = K('cloud').querySelector('.linked small')
      if (quiet && !ok && !failed && small) (small.textContent = status), renderSync(status)
      else renderCloud(status)
      if (ok > 0) toast(`${ok === 1 ? 'Ha llegado una salida nueva' : `Han llegado ${ok} salidas nuevas`} de tu móvil`)
    } catch (e) {
      renderCloud(`No se pudo: ${e.message}`, 'err')
    }
  })().finally(() => (syncing = null))
  return syncing
}

// Sola: cada minuto mientras se ve la página, y al volver a ella
let lastSync = 0
setInterval(() => !SAT && document.visibilityState === 'visible' && getKey() && cloudSync({ quiet: true }), 60000)
document.addEventListener('visibilitychange', () => !SAT && document.visibilityState === 'visible' && getKey() && Date.now() - lastSync > 15000 && cloudSync({ quiet: true }))

// ---------- Notas de cada salida ----------
// Para acordarte de qué cambió (presiones, reglajes, lluvia...): se guardan en este navegador con la salida
const TAGS = ['Neumáticos nuevos', 'Lluvia o mojado', 'Con pasajero', 'Circuito', 'Cambié reglajes', 'Moto nueva']
const metaOf = (id) => S.list.find((m) => m.id === id)
function notesHtml() {
  const m = metaOf(S.id) || {}
  const tags = m.tags || []
  return `<div class="notes"><h4 class="h">NOTAS DE LA SALIDA</h4>
    <div class="chips">${TAGS.map((t) => `<button class="chip ${tags.includes(t) ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <textarea data-k="notes" maxlength="2000" rows="3" placeholder="Presiones, reglajes, cómo te encontraste… (se guarda solo)">${esc(m.notes || '')}</textarea></div>`
}
async function saveNotes(patch) {
  const m = metaOf(S.id)
  if (!m) return
  Object.assign(m, patch)
  await updateMeta(m)
  // La marca de «tiene notas» en la lista
  K('list').querySelector(`[data-id="${CSS.escape(S.id)}"] .sess-open b`)?.classList.toggle('has-notes', !!(m.notes || m.tags?.length))
}
function toggleTag(t) {
  const m = metaOf(S.id)
  if (!m) return
  const tags = new Set(m.tags || [])
  tags.has(t) ? tags.delete(t) : tags.add(t)
  saveNotes({ tags: [...tags] })
  for (const b of root.querySelectorAll('[data-tag]')) b.classList.toggle('on', tags.has(b.dataset.tag))
}
let notesTimer = null
root.addEventListener('input', (e) => {
  if (e.target.dataset?.k !== 'notes') return
  clearTimeout(notesTimer)
  const v = e.target.value
  notesTimer = setTimeout(() => saveNotes({ notes: v }), 600)
})

// ---------- GPX ----------
/** El recorrido (del tramo elegido o de toda la salida) en GPX 1.1, con velocidad e inclinación. */
function exportGpx() {
  const A = S.A
  if (!A) return
  const [w0, w1] = S.work
  const t0 = A.meta.start
  const name = `Street Chaos ${fmtDateTime(t0)}${isFull(S.work) ? '' : ` (tramo ${span(w0, w1)})`}`
  const x = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : null)
  const out = [`<?xml version="1.0" encoding="UTF-8"?>`, `<gpx version="1.1" creator="Street Chaos Blackbox" xmlns="http://www.topografix.com/GPX/1/1" xmlns:sc="https://pepe-a-d.github.io/streetchaos/gpx/1">`, `<metadata><name>${esc(name)}</name><time>${new Date(t0).toISOString()}</time></metadata>`, `<trk><name>${esc(name)}</name><type>motorcycling</type>`]
  let open = false
  let lastSeg = null
  for (let i = w0; i <= w1; i++) {
    if (!A.valid[i]) {
      if (open) (out.push('</trkseg>'), (open = false))
      continue
    }
    if (!open || A.seg[i] !== lastSeg) {
      if (open) out.push('</trkseg>')
      out.push('<trkseg>')
      open = true
      lastSeg = A.seg[i]
    }
    const ele = x(A.alt[i], 1)
    out.push(`<trkpt lat="${A.lat[i].toFixed(7)}" lon="${A.lon[i].toFixed(7)}">${ele ? `<ele>${ele}</ele>` : ''}<time>${new Date(t0 + A.t[i] * 1000).toISOString()}</time><extensions><sc:speed>${x(A.v[i], 2)}</sc:speed><sc:lean>${x(A.lean[i], 1)}</sc:lean><sc:glong>${x(A.gLong[i], 3)}</sc:glong></extensions></trkpt>`)
  }
  if (open) out.push('</trkseg>')
  out.push('</trk>', '</gpx>')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([out.join('\n')], { type: 'application/gpx+xml' }))
  a.download = `streetchaos-${new Date(t0).toISOString().slice(0, 16).replace(/[:T]/g, '-')}${isFull(S.work) ? '' : '-tramo'}.gpx`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}

// ---------- CSV ----------
function exportCsv() {
  const A = S.A
  if (!A) return
  // Si has elegido un tramo, solo ese
  const [w0, w1] = S.work
  const cols = ['t_s', 'hora', 'lat', 'lon', `dist_${distUnit()}`, `vel_${speedUnit().replace('/', '')}`, 'incl_grados', 'g_long', 'g_lat', 'alt_m', 'rumbo', 'giro_grados_s', 'vib_ms2', 'gps_precision_m']
  const lines = [cols.join(',')]
  const f = (x, d) => (Number.isFinite(x) ? x.toFixed(d) : '')
  for (let i = w0; i <= w1; i++) {
    if (!A.valid[i]) continue
    lines.push([f(A.t[i] - A.t[0], 1), new Date(A.meta.start + A.t[i] * 1000).toISOString(), f(A.lat[i], 7), f(A.lon[i], 7), f(toDist(A.d[i]), 4), f(toSpeed(A.v[i]), 2), f(A.lean[i], 2), f(A.gLong[i], 3), f(A.gLat[i], 3), f(A.alt[i], 1), f(A.hdg[i], 1), f(A.yaw[i], 2), f(A.vib[i], 3), f(A.acc[i], 1)].join(','))
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
  const d = new Date(A.meta.start)
  a.download = `streetchaos-${d.toISOString().slice(0, 16).replace(/[:T]/g, '-')}${isFull(S.work) ? '' : `-tramo-${Math.round(A.t[w0] - A.t[0])}s-${Math.round(A.t[w1] - A.t[0])}s`}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}

// ---------- Vídeo ----------
// El vídeo de la salida al lado del mapa (o en su propia ventana, en otra pantalla). Se guarda por salida
// su nombre, tamaño y desfase; el archivo se vuelve a elegir al abrirla (en Chrome, Edge y la app de
// Windows basta un clic: se recuerda el archivo).
let vpanel = null
const videoShown = () => VISTA === 'video' || (VISTA === 'todo' && !document.body.classList.contains('det-video'))
const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')

function ensureVideo() {
  vpanel ??= createVideoPanel(K('vid'), {
    onCursor: (i) => setCursor(i, 'video'),
    onClose: () => closeVideo(),
    onSync: (c) => {
      saveVideoEntry(S.id, c)
      send({ type: 'videoSync', id: S.id, name: c.name, size: c.size, off: c.off, how: c.how })
    },
  })
  vpanel.setSession(S.A)
  return vpanel
}

function showVideo(on) {
  const box = root.querySelector('.mapbox')
  K('vid').hidden = !on
  box.classList.toggle('with-video', on)
  if (!on) box.classList.remove('video-only')
  root.querySelector('[data-k="vidBtn"]')?.classList.toggle('on', on)
  setTimeout(() => S.map?.resize(), 30)
}

function closeVideo() {
  vpanel?.clear()
  showVideo(VISTA === 'video')
  if (!SAT) send({ type: 'videos', id: S.id, clips: [] })
}

/** Al abrir una salida: los vídeos de otra se quitan y el botón dice si esta tiene alguno guardado. */
async function sessionVideos(A) {
  if (vpanel) {
    vpanel.setSession(A)
    if (!vpanel.on && VISTA !== 'video') showVideo(false)
  }
  const list = await getVideos(A.meta.id)
  const b = root.querySelector('[data-k="vidBtn"]')
  if (b && S.A === A) b.textContent = list.length ? `VIDEO (${list.length})` : 'VIDEO'
}

async function saveVideoEntry(id, c, handle) {
  if (!id) return
  const list = await getVideos(id)
  const k = list.findIndex((x) => x.name === c.name && x.size === c.size)
  const e = { ...(k >= 0 ? list[k] : {}), name: c.name, size: c.size, lastModified: c.lastModified, off: c.off, how: c.how, err: c.err ?? null, dur: c.dur }
  if (handle) e.handle = handle
  if (k >= 0) list[k] = e
  else list.push(e)
  await putVideos(id, list)
  if (S.A && S.id === id) sessionVideos(S.A)
}

/** Lee, sincroniza y enseña uno o varios vídeos. Si son de otra salida (por la hora del GPS), la abre. */
async function attachVideos(files, handles = []) {
  const busy = K('busy')
  const label = busy.querySelector('span')
  for (const [k, f] of files.entries()) {
    busy.hidden = false
    label.textContent = `LEYENDO ${plain(f.name).toUpperCase()}…`
    try {
      const info = await readVideo(fileReader(f), (p) => (label.textContent = `LEYENDO EL GPS DEL VIDEO… ${Math.round(p * 100)} %`))
      const span = videoSpan(info)
      const covers = (m) => span && span[0] < m.end + 60000 && span[1] > m.start - 60000
      // ¿Es de otra salida? Por la hora del GPS de la cámara (o la de grabación)
      if (span && (!S.A || !covers(S.A.meta))) {
        const m = S.list.find(covers)
        if (m) {
          busy.hidden = true
          await open(m.id)
          toast(`${f.name}: es de esta salida`, 4000)
        }
      }
      if (!S.A) {
        toast(`${f.name}: abre primero la salida de este vídeo (no se ha encontrado por la hora)`, 6000)
        continue
      }
      const saved = (await getVideos(S.id)).find((x) => x.name === f.name && x.size === f.size)
      const sync = saved ? { off: saved.off, how: saved.how, err: saved.err } : syncOffset(S.A, info)
      ensureVideo()
      showVideo(true)
      const c = vpanel.add(f, { ...sync, dur: info.dur })
      await saveVideoEntry(S.id, c, handles[k])
      if (!saved) toast(sync.how === 'gps' ? `${f.name}: sincronizado solo con su GPS` : sync.how === 'none' ? `${f.name}: no trae GPS ni hora; sincronízalo a mano con AQUÍ` : `${f.name}: ${HOW[sync.how]}`, 6000)
      send({ type: 'videos', id: S.id, clips: vpanel.clips.map(clipMsg) })
    } catch (e) {
      console.error(e)
      toast(`${f.name}: ${e.message}`, 6000)
    } finally {
      busy.hidden = true
      label.textContent = 'ANALIZANDO…'
    }
  }
}
const clipMsg = (c) => ({ file: c.file, off: c.off, how: c.how, err: c.err, dur: c.dur })

/** Elegir vídeos: con el selector del sistema que recuerda el archivo si lo hay; si no, el de siempre. */
async function pickVideos() {
  if (window.showOpenFilePicker) {
    try {
      const hs = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'Vídeo', accept: { 'video/mp4': ['.mp4', '.MP4', '.m4v', '.lrv'], 'video/quicktime': ['.mov', '.MOV'] } }] })
      return attachVideos(await Promise.all(hs.map((h) => h.getFile())), hs)
    } catch (e) {
      if (e?.name === 'AbortError') return
    }
  }
  const inp = document.createElement('input')
  inp.type = 'file'
  inp.accept = 'video/mp4,video/quicktime,.mp4,.mov,.m4v,.lrv'
  inp.multiple = true
  inp.onchange = () => attachVideos([...inp.files])
  inp.click()
}

async function fileFromHandle(h) {
  if (!h?.getFile) return null
  try {
    if ((await h.queryPermission?.({ mode: 'read' })) !== 'granted' && (await h.requestPermission?.({ mode: 'read' })) !== 'granted') return null
    return await h.getFile()
  } catch {
    return null
  }
}

async function videoButton() {
  if (!S.A) return
  // Ya abierto: enseñar u ocultar
  if (vpanel?.on) return showVideo(K('vid').hidden)
  const list = await getVideos(S.id)
  if (!list.length) return pickVideos()
  const fmtD = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
  const el = modal(`<h2>VIDEOS DE ESTA SALIDA</h2>
    <p class="note">El vídeo no se guarda aquí (se queda en tu disco): elígelo otra vez y saldrá ya sincronizado.</p>
    <table class="grid"><tbody>${list.map((v, k) => `<tr><td><b>${esc(v.name)}</b></td><td>${fmtD(v.dur || 0)}</td><td>${esc(HOW[v.how] || '')}</td><td class="acts"><button class="btn small" data-vopen="${k}">ABRIR</button><button class="btn ghost small" data-vdel="${k}" title="Olvidar este vídeo">×</button></td></tr>`).join('')}</tbody></table>
    <div class="actions"><button class="btn ghost small" data-close>CERRAR</button><button class="btn small" data-k="add">${list.length > 1 ? 'ELEGIR LOS ARCHIVOS' : 'ELEGIR OTRO VIDEO'}</button></div>`, { wide: true })
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button')
    if (!b) return
    if (b.dataset.k === 'add') return el.close(), pickVideos()
    if (b.dataset.vdel != null) {
      list.splice(Number(b.dataset.vdel), 1)
      await putVideos(S.id, list)
      el.close()
      return sessionVideos(S.A)
    }
    if (b.dataset.vopen != null) {
      const v = list[Number(b.dataset.vopen)]
      const f = await fileFromHandle(v.handle)
      el.close()
      if (f && f.size === v.size) return attachVideos([f], [v.handle])
      toast(`Elige ${v.name}`, 4000)
      return pickVideos()
    }
  })
}

// ---------- Pasadas de amigos ----------
const FRIENDS = 'sc-bb-friends' // las últimas que has abierto: código, de quién y qué
const friendList = () => {
  try {
    return JSON.parse(localStorage.getItem(FRIENDS) || '[]')
  } catch {
    return []
  }
}
function rememberFriend(code, g) {
  const list = [{ code, rider: g.rider, name: g.name, time: g.time, length: g.length, riddenAt: g.riddenAt }, ...friendList().filter((x) => x.code !== code)]
  try {
    localStorage.setItem(FRIENDS, JSON.stringify(list.slice(0, 20)))
  } catch {}
}
const WEB = 'https://pepe-a-d.github.io/streetchaos/'
const ghostLink = (code) => `${desktop || !/^https?:/.test(location.protocol) ? WEB : location.origin + import.meta.env.BASE_URL}blackbox/#g=${code}`
const fmtCode = (c) => `${c.slice(0, 4)} ${c.slice(4)}`

/** COMPARTIR: el tramo que estás viendo, empaquetado con un código para un amigo. */
async function shareDialog() {
  const A = S.A
  if (!cloudAvailable()) return toast('Esta versión no tiene servidor')
  if (isFull(S.range)) return toast('Primero elige qué compartir: arrastra sobre las gráficas para coger un tramo, o pulsa una curva', 6000)
  const [i0, i1] = S.range
  if (A.d[i1] - A.d[i0] < 100) return toast('Elige un tramo de al menos 100 m: arrastra sobre una gráfica')
  const pts = pathPoints(A, i0, i1)
  if (pts.length < 2) return toast('En lo que ves no hay GPS (un hueco de la señal): elige otro tramo')
  const P = makePath(pts)
  const own = findPasses(P, A, { from: i0 - 150, to: i1 + 150 })
  const ref = own.find((p) => p.i0 <= i0 + 60 && p.i1 >= i1 - 60) || own[0]
  if (!ref) return toast('No se pudo usar este tramo')
  const rider = askRider()
  if (rider == null) return
  // Un nombre que le diga algo a tu amigo (los minutos de tu salida no le sirven)
  const f = S.focus
  const name = f && f.kind !== 'zoom' ? `${FOCUS_NAME[f.kind].charAt(0)}${FOCUS_NAME[f.kind].slice(1).toLowerCase()} ${f.n}` : `Tramo de ${fmtLen(P.length)}`
  const el = modal(`<h2>COMPARTIR CON UN AMIGO</h2>
    <p class="note">${esc(name)} · <b>${fmtLap(ref.time)}</b> · ${when(A.meta, ref.t0)}</p>
    <div data-k="out"><p class="note">Subiendo…</p></div>
    <div class="actions"><button class="btn small" data-close>HECHO</button></div>`)
  const out = el.querySelector('[data-k="out"]')
  try {
    const g = packGhost(A, ref, pts, { name, rider, bike: A.meta.rider?.bike || S.profile?.bike || '' })
    const code = await shareGhost(g)
    const link = ghostLink(code)
    out.innerHTML = `<p class="note">Pásale este código. En su Blackbox: <b>PASADA DE UN AMIGO</b> y el código (o que abra el enlace). Verá metro a metro dónde le ganas y dónde te gana.</p>
      <div class="ghost-code" data-k="code">${fmtCode(code)}</div>
      <div class="win-btns"><button class="btn small" data-copy="${code}">COPIAR CODIGO</button><button class="btn ghost small" data-copy="${esc(link)}">COPIAR ENLACE</button></div>
      <p class="note">Solo lleva este trozo (el trazado y tu velocidad, inclinación y G en él), tu nombre y tu moto: ni el resto de la salida ni de dónde vienes.</p>`
    out.onclick = async (e) => {
      const b = e.target.closest('[data-copy]')
      if (!b) return
      try {
        await navigator.clipboard.writeText(b.dataset.copy)
        toast('Copiado')
      } catch {
        toast(b.dataset.copy, 8000)
      }
    }
  } catch (e) {
    out.innerHTML = `<p class="note">No se pudo compartir: ${esc(e.message)}</p>`
  }
}

/** PASADA DE UN AMIGO: con su código, busca tus pasadas por el mismo sitio y te compara con él. */
function friendDialog(preset = '') {
  if (!cloudAvailable()) return toast('Esta versión no tiene servidor')
  const recent = friendList()
  const el = modal(`<h2>PASADA DE UN AMIGO</h2>
    <p class="note">Escribe el código de 8 letras que te ha pasado (él lo saca con COMPARTIR, encima de las gráficas).</p>
    <div class="code-in"><input data-k="gcode" maxlength="9" placeholder="ABCD 2345" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Código de 8 letras" value="${esc(preset)}"><button class="btn small" data-k="go">ABRIR</button></div>
    <div data-k="res"></div>
    ${recent.length ? `<h4 class="h">LAS ULTIMAS QUE HAS ABIERTO</h4><table class="grid"><tbody>${recent.map((r) => `<tr class="link" data-gc="${esc(r.code)}"><td><b>${esc(r.rider || 'Sin nombre')}</b></td><td>${esc(r.name || '')}</td><td>${fmtLen(r.length || 0)}</td><td><b>${fmtLap(r.time)}</b></td><td>${fmtCode(r.code)}</td></tr>`).join('')}</tbody></table>` : ''}
    <div class="actions"><button class="btn ghost small" data-close>CERRAR</button></div>`, { wide: true })
  const input = el.querySelector('[data-k="gcode"]')
  const res = el.querySelector('[data-k="res"]')
  const go = (code) => loadFriend(normGhostCode(code), res, el)
  el.querySelector('[data-k="go"]').onclick = () => go(input.value)
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go(input.value))
  el.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-gc]')
    if (tr) (input.value = fmtCode(tr.dataset.gc)), go(tr.dataset.gc)
  })
  if (preset) go(preset)
  else input.focus()
}

async function loadFriend(code, res, el) {
  if (!validGhostCode(code)) return (res.innerHTML = '<p class="note">El código son 8 letras y números (sin I, L, O, 0 ni 1).</p>')
  res.innerHTML = '<p class="note">Bajando su pasada…</p>'
  let G
  try {
    const g = await fetchGhost(code)
    G = unpackGhost(g)
    if (!G.pass) throw new Error('La pasada no encaja con su propio trazado')
    rememberFriend(code, g)
  } catch (e) {
    return (res.innerHTML = `<p class="note">No se pudo abrir: ${esc(e.message)}</p>`)
  }
  const { B, P, pass } = G
  const who = B.ghost.rider || 'tu amigo'
  const head = `<div class="friend-card"><b>${esc(who)}</b>${B.ghost.bike ? ` · ${esc(B.ghost.bike)}` : ''} · ${esc(B.ghost.name || 'tramo')} · ${fmtLen(P.length)} · <b>${fmtLap(pass.time)}</b> · ${fmtDateTime(Date.parse(B.ghost.riddenAt))}</div>`
  res.innerHTML = `${head}<p class="note">Buscando tus pasadas por el mismo sitio…</p>`
  const found = await passesEverywhere(P, (m) => el.isConnected && (res.innerHTML = `${head}<p class="note">Buscando en ${fmtDateTime(m.start)}…</p>`))
  if (!el.isConnected) return
  const save = `<button class="btn ghost small" data-k="saveSeg" title="Se cronometrará en todas tus salidas, y verás tus tiempos ahí">GUARDAR COMO TRAMO</button>`
  if (!found.length) {
    res.innerHTML = `${head}<p class="note">Aún no tienes ninguna pasada completa por aquí (en el mismo sentido). Guárdalo como tramo y, cuando pases, compárate desde aquí con el mismo código.</p><div class="actions">${save}</div>`
  } else {
    found.sort((a, b) => a.pass.time - b.pass.time)
    res.innerHTML = `${head}<h4 class="h">TUS PASADAS POR AQUI</h4><table class="grid"><thead><tr><th>#</th><th>SALIDA</th><th>TU TIEMPO</th><th>CONTRA EL SUYO</th><th></th></tr></thead><tbody>
      ${found.map((f, k) => `<tr class="link" data-pick="${k}"><td>${k + 1}</td><td>${when(f.meta, f.pass.t0)}</td><td><b>${fmtLap(f.pass.time)}</b></td><td class="${f.pass.time < pass.time ? 'gain' : 'loss'}">${f.pass.time < pass.time ? '−' : '+'}${Math.abs(f.pass.time - pass.time).toFixed(2)} s</td><td>COMPARAR</td></tr>`).join('')}
      </tbody></table><div class="actions">${save}</div>`
  }
  res.onclick = async (e) => {
    if (e.target.closest('[data-k="saveSeg"]')) {
      const seg = { id: `seg-g-${code}`, name: `${B.ghost.name || 'Tramo'} (de ${who})`.slice(0, 60), points: G.points, length: P.length, closed: P.closed, circuit: false, bbox: P.bbox, createdAt: Date.now(), friend: code }
      await saveSegment(seg)
      await refreshSegs()
      toast('TRAMO GUARDADO')
      return
    }
    const tr = e.target.closest('[data-pick]')
    if (!tr) return
    const f = found[Number(tr.dataset.pick)]
    el.close()
    await compareWithFriend(f, G)
  }
}

/** Abre tu pasada y la compara con la del amigo (la tuya es la azul; la suya, la rosa). */
async function compareWithFriend(f, { B, P, pass }) {
  if (S.id !== f.id) await open(f.id)
  if (S.id !== f.id) return
  const who = B.ghost.rider || 'tu amigo'
  startCompare(f.pass, { id: B.meta.id, meta: B.meta, pass, B }, P.length, { refLabel: `Tú · ${when(f.meta, f.pass.t0)}`, cmpLabel: `${who} · ${fmtDateTime(Date.parse(B.ghost.riddenAt))}`, kind: 'route', who })
}

// ---------- Ventanas: abrir, repartir en pantallas y sincronizar ----------
const desktop = window.bbDesktop || null // la app de Windows (preload de desktop/)
// Dentro de la app de escritorio no hay «app del móvil» que abrir
if (desktop) document.querySelector('.top a[href="../?app"]')?.remove()
if (desktop) document.querySelector('.top [data-act="download"]')?.remove()
document.body.classList.toggle('in-app', !!desktop)
const satUrl = (v) => `${location.pathname}?vista=${v}${S.id ? `#s=${encodeURIComponent(S.id)}` : ''}`
function openWindow(v, box = null) {
  const feat = box ? `popup,left=${box.left},top=${box.top},width=${box.width},height=${box.height}` : 'popup,width=1280,height=800'
  return window.open(satUrl(v), `sc-bb-${v}`, feat)
}

/** Reparte las ventanas: esta con los datos y la biblioteca, el mapa y las gráficas en las otras pantallas. */
async function spread() {
  if (desktop?.spread) return desktop.spread()
  // En Chrome/Edge se puede saber qué pantallas hay (te pedirá permiso); si no, ventanas normales
  try {
    if ('getScreenDetails' in window) {
      const sd = await window.getScreenDetails()
      const others = sd.screens.filter((x) => x !== sd.currentScreen)
      const place = (scr) => scr && { left: scr.availLeft, top: scr.availTop, width: scr.availWidth, height: scr.availHeight }
      if (others.length >= 2) return (openWindow('mapa', place(others[0])), openWindow('graficas', place(others[1])))
      if (others.length === 1) {
        const o = place(others[0])
        return (openWindow('mapa', { ...o, width: Math.round(o.width / 2) }), openWindow('graficas', { ...o, left: o.left + Math.round(o.width / 2), width: Math.round(o.width / 2) }))
      }
    }
  } catch {}
  openWindow('mapa')
  openWindow('graficas')
  toast('Lleva cada ventana a la pantalla que quieras: se quedan sincronizadas', 6000)
}

// La app de Windows, de las Releases del repositorio (con nombres fijos: siempre la última)
const RELEASES = 'https://github.com/Pepe-a-d/streetchaos/releases'
const DL = { setup: `${RELEASES}/latest/download/Blackbox-StreetChaos-Setup.exe`, portable: `${RELEASES}/latest/download/Blackbox-StreetChaos-portable.exe` }
function downloadDialog() {
  modal(`<h2>BLACKBOX PARA WINDOWS</h2>
    <p class="note">El mismo Blackbox como programa: va más suelto, funciona sin conexión (salvo el mapa y la nube) y pone el mapa, las gráficas y los datos cada uno en una pantalla, acordándose de dónde los dejas.</p>
    <div class="win-btns">
      <a class="btn" href="${DL.setup}" rel="noopener">⬇ DESCARGAR EL INSTALADOR <small>(~105 MB · se actualiza solo)</small></a>
      <a class="btn ghost small" href="${DL.portable}" rel="noopener">VERSION PORTABLE <small>(sin instalar, ~95 MB)</small></a>
    </div>
    <p class="note">Al abrirlo la primera vez, Windows puede avisar de que no lo conoce (no está firmado): pulsa <b>Más información → Ejecutar de todas formas</b>.</p>
    <p class="note">Tu móvil se vincula igual que aquí, con el código de 6 letras. Las salidas que tengas en este navegador no pasan solas: o las bajas de la nube o las importas.</p>
    <p class="note"><a class="linkish" href="${RELEASES}" target="_blank" rel="noopener">Todas las versiones</a></p>
    <div class="actions"><button class="btn ghost small" data-close>CERRAR</button></div>`)
}

function windowsMenu() {
  const el = modal(`<h2>VENTANAS Y PANTALLAS</h2>
    <p class="note">Cada parte puede ir en su propia ventana, en otra pantalla. Van todas a una: el cursor, el tramo y la salida se mueven a la vez en todas.</p>
    <div class="win-btns">
      <button class="btn" data-spread>REPARTIR EN MIS PANTALLAS</button>
      ${Object.entries(VISTAS).map(([v, l]) => `<button class="btn ghost small" data-win="${v}">${l} EN OTRA VENTANA</button>`).join('')}
    </div>
    <p class="note">${desktop ? 'La app recuerda dónde dejas cada ventana.' : 'En Chrome o Edge, «Repartir» pide permiso para ver tus pantallas y coloca cada ventana en una. En Safari ábrelas y llévalas tú. La <button class="linkish" data-act="download">app de Windows</button> lo hace sola y recuerda dónde las dejas.'}</p>
    <div class="actions"><button class="btn ghost small" data-close>CERRAR</button></div>`)
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="download"]')) return el.close(), downloadDialog()
    const b = e.target.closest('[data-win], [data-spread]')
    if (!b) return
    el.close()
    if (b.dataset.win) openWindow(b.dataset.win)
    else spread()
  })
}

// Qué partes están en otra ventana (para no repetirlas aquí): cada ventana avisa cada 3 s
const detached = new Map()
function markDetached() {
  const now = Date.now()
  for (const v of Object.keys(VISTAS)) document.body.classList.toggle(`det-${v}`, now - (detached.get(v) || 0) < 8000)
  S.charts?.resize?.()
  // El vídeo, si está en su ventana, solo allí
  if (vpanel?.on && !videoShown()) vpanel.pause()
}
if (SAT) {
  setInterval(() => send({ type: 'alive' }), 3000)
  addEventListener('pagehide', () => send({ type: 'bye' }))
} else setInterval(markDetached, 4000)

SYNC?.addEventListener('message', async ({ data: m }) => {
  if (!m || m.from === WIN) return
  if (m.type === 'alive' || m.type === 'hello') detached.set(m.vista, Date.now())
  if (m.type === 'bye') detached.delete(m.vista)
  if (!SAT && ['alive', 'hello', 'bye'].includes(m.type)) markDetached()
  // Una ventana nueva pregunta qué hay abierto: contesta la principal
  if (m.type === 'hello' && !SAT && S.id) {
    send({ type: 'open', id: S.id, range: S.range, work: S.work, focus: S.focus, cur: S.cur, prefs })
    // A la ventana del vídeo, los vídeos abiertos (los archivos viajan por el canal, sin copiarse al disco)
    if (m.vista === 'video' && vpanel?.on) send({ type: 'videos', id: S.id, clips: vpanel.clips.map(clipMsg) })
  }
  remote = true
  try {
    if (m.type === 'prefs' || m.prefs) {
      const before = JSON.stringify([prefs.units, prefs.charts, prefs.xMode, prefs.mapCh, prefs.showApp])
      Object.assign(prefs, m.prefs)
      units.speed = prefs.units
      if (S.A && before !== JSON.stringify([prefs.units, prefs.charts, prefs.xMode, prefs.mapCh, prefs.showApp])) (buildCharts(), S.map?.setTrack(S.A, prefs.mapCh, S.range))
      if (S.A) renderAll()
      renderUnits()
    }
    if (m.type === 'open') {
      if (S.id !== m.id) await open(m.id, { cur: m.cur })
      if (S.A && S.id === m.id) {
        S.work = m.work
        S.focus = m.focus
        setRange(...m.range, { kind: 'restore' })
        if (m.cur != null) setCursor(m.cur, 'remote')
      }
    } else if (m.type === 'range' && S.A && S.id === m.id) {
      S.work = m.work
      S.focus = m.focus
      setRange(...m.range, { kind: 'restore' })
    } else if (m.type === 'cursor' && S.A && S.id === m.id) setCursor(m.i, 'remote')
    else if (m.type === 'videos' && VISTA === 'video' && S.A && S.id === m.id) {
      ensureVideo().clear()
      for (const c of m.clips) vpanel.add(c.file, c)
      vpanel.follow(S.cur)
    } else if (m.type === 'videoSync' && vpanel && S.id === m.id) {
      const c = vpanel.clips.find((x) => x.name === m.name && x.size === m.size)
      if (c) (c.off = m.off), (c.how = m.how), vpanel.follow(S.cur)
    }
    else if (m.type === 'home' && SAT) goHome()
  } finally {
    remote = false
  }
})

// ---------- Arranque ----------
keyFromUrl()
renderUnits()
renderReadout()
renderCloud()
await refreshList()
const want = decodeURIComponent((location.hash.match(/s=([^&]+)/) || [])[1] || '')
if (SAT) {
  // Ventana secundaria: su título, y lo que tenga abierto la principal
  document.title = `${VISTAS[VISTA]} · Blackbox`
  if (VISTA === 'video') K('vid').hidden = false
  // Se abre sin avisar a las demás (si no, la principal perdería su tramo) y luego se pregunta dónde están
  remote = true
  if (want && S.list.some((m) => m.id === want)) await open(want)
  remote = false
  if (VISTA === 'video') ensureVideo().hint('Abre el vídeo en la ventana principal (botón VIDEO, debajo del mapa) y saldrá aquí')
  send({ type: 'hello' })
} else {
  refreshSegs()
  checkDevice()
  cloudSync()
  // Con un enlace a una salida (#s=…) se abre; si no, el inicio (perfil y últimas salidas)
  if (want && S.list.some((m) => m.id === want)) open(want)
  else renderHome()
  // Enlace de una pasada de un amigo (#g=CÓDIGO)
  const g = normGhostCode((location.hash.match(/g=([A-Za-z0-9 -]+)/) || [])[1])
  if (g) {
    history.replaceState(null, '', location.pathname + location.search)
    friendDialog(g)
  }
}
window.__bb = { S, prefs, open, setRange, setCursor }
