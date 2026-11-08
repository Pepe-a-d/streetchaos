// BLACKBOX: analizador de la telemetría que graba la app (pensado para el ordenador).
// Carga los .json que exporta el móvil, los guarda en este navegador y enseña cada salida con
// mapa, gráficas sincronizadas, G-G, curvas, frenadas, pasadas y calidad de los datos.
import '@fontsource/press-start-2p'
import './style.css'
import { listSessions, addSessions, loadSession, deleteSession, parseExport, deviceSessions } from './library.js'
import { analyze, rangeStats, DT } from './process.js'
import { CHANNELS, MAP_CHANNELS, CHART_CHANNELS, units, toSpeed, speedUnit, toDist, distUnit, fmt, fmtDur, fmtElapsed, fmtDateTime, fmtClock, gradientCss } from './channels.js'
import { createCharts } from './charts.js'
import { drawGG, drawLeanHist } from './gg.js'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const $ = (sel, root = document) => root.querySelector(sel)

// ---------- Preferencias ----------
const PREFS = 'sc-bb-prefs'
const prefs = { units: 'kmh', xMode: 't', mapCh: 'v', charts: ['v', 'lean', 'gLong', 'gLat', 'alt'], showApp: false, tab: 'tramo', sort: 'n' }
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS) || '{}'))
} catch {}
const savePrefs = () => {
  try {
    localStorage.setItem(PREFS, JSON.stringify(prefs))
  } catch {}
}
units.speed = prefs.units

const S = { list: [], id: null, A: null, range: [0, 0], cur: 0, map: null, charts: null }

// ---------- Estructura ----------
const root = document.getElementById('bb')
root.innerHTML = `
  <header class="top">
    <a class="logo" href="../" title="Volver a la app">STREET<span>CHAOS</span></a>
    <b class="tag">BLACKBOX</b>
    <div class="title" data-k="title">Analizador de telemetría</div>
    <div class="seg" data-k="xmode"><button data-x="t">TIEMPO</button><button data-x="d">DISTANCIA</button></div>
    <div class="seg" data-k="units"><button data-u="kmh">KM/H</button><button data-u="mph">MPH</button></div>
    <button class="btn ghost" data-act="csv" disabled title="Canales a 10 Hz para Excel u otras herramientas">CSV</button>
  </header>
  <aside class="lib">
    <label class="drop" data-k="drop">
      <b>IMPORTAR</b>
      <span>Suelta aquí el .json de <i>Garaje → Datos → Exportar</i> o haz clic</span>
      <input type="file" accept=".json,application/json" multiple hidden>
    </label>
    <div class="lib-btns">
      <button class="btn ghost small" data-act="demo">VER DEMO</button>
      <button class="btn ghost small" data-act="device" hidden>DE ESTE MOVIL</button>
    </div>
    <h3 class="h">SALIDAS</h3>
    <div class="list" data-k="list"></div>
  </aside>
  <main class="main">
    <section class="empty" data-k="empty">
      <h2>CAJA NEGRA</h2>
      <p>Aquí se analiza lo que graba la app en cada salida: el GPS y los sensores en bruto.</p>
      <ol>
        <li>En el móvil: <b>Garaje → Datos → Exportar</b> y pásate el archivo (AirDrop, Drive, correo).</li>
        <li>Suéltalo en esta página. Se queda guardado en este navegador.</li>
      </ol>
      <p>¿Aún sin datos? <button class="btn small" data-act="demo">VER DEMO</button> <small>(una salida inventada por Oleiros)</small></p>
    </section>
    <section class="work" data-k="work" hidden>
      <div class="row1">
        <div class="panel mapbox">
          <div class="map" data-k="map"></div><div class="map-loading" data-k="maploading" hidden>CARGANDO MAPA…</div>
          <div class="map-bar">
            <div class="chips" data-k="mapch">${MAP_CHANNELS.map((id) => `<button class="chip" data-mapch="${id}">${CHANNELS[id].short}</button>`).join('')}</div>
            <div class="legend" data-k="legend"></div>
          </div>
        </div>
        <div class="panel side">
          <div class="readout" data-k="readout"></div>
          <nav class="tabs" data-k="tabs">
            ${[['tramo', 'TRAMO'], ['gg', 'G-G'], ['curvas', 'CURVAS'], ['frenadas', 'FRENADAS'], ['pasadas', 'PASADAS'], ['calidad', 'CALIDAD']].map(([id, l]) => `<button data-tab="${id}">${l}</button>`).join('')}
          </nav>
          <div class="tab-body" data-k="tabbody"></div>
        </div>
      </div>
      <div class="panel charts-box">
        <div class="ch-bar">
          <div class="chips" data-k="chartch">${CHART_CHANNELS.map((id) => `<button class="chip" data-chart="${id}">${CHANNELS[id].short}</button>`).join('')}</div>
          <label class="toggle"><input type="checkbox" data-k="showApp"> comparar con lo que calculó el móvil</label>
          <span class="grow"></span>
          <span class="range" data-k="range"></span>
          <button class="btn ghost small" data-act="all">VER TODO</button>
        </div>
        <div class="charts" data-k="charts"></div>
        <p class="hint">Arrastra sobre una gráfica o la tira de arriba para elegir un tramo · Ctrl/⌘ + rueda (o pellizca) para acercar · doble clic o Esc para verlo todo · ← → mueven el cursor</p>
      </div>
    </section>
    <div class="busy" data-k="busy" hidden><span>ANALIZANDO…</span></div>
  </main>`

const K = (k) => root.querySelector(`[data-k="${k}"]`)
const fileInput = $('input[type=file]', K('drop'))

function toast(msg, ms = 3200) {
  document.querySelector('.toast')?.remove()
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  document.body.append(t)
  setTimeout(() => t.remove(), ms)
}

// ---------- Biblioteca ----------
const SRC = { real: ['REAL', 'real'], sim: ['SIM', 'sim'], demo: ['DEMO', 'demo'] }

async function refreshList() {
  S.list = await listSessions()
  K('list').innerHTML = S.list.length
    ? S.list
        .map((m) => {
          const [txt, cls] = SRC[m.source] || ['?', '']
          return `<div class="sess ${m.id === S.id ? 'on' : ''}" data-id="${esc(m.id)}">
            <button class="sess-open" data-open="${esc(m.id)}">
              <b>${fmtDateTime(m.start)}</b>
              <span>${toDist(m.dist || 0).toFixed(1)} ${distUnit()} · ${fmtDur((m.end - m.start) / 1000)} · ${Math.round(toSpeed(m.vmax || 0))} ${speedUnit()}</span>
            </button>
            <i class="src ${cls}">${txt}${m.state === 'rec' ? ' · A MEDIAS' : ''}</i>
            <button class="del" data-del="${esc(m.id)}" title="Borrar de este navegador" aria-label="Borrar">×</button>
          </div>`
        })
        .join('')
    : '<p class="note">Todavía no hay ninguna salida en este navegador.</p>'
}

async function importText(text, from) {
  const parsed = parseExport(text)
  const r = await addSessions(parsed.sessions, from)
  await refreshList()
  const parts = []
  if (r.added) parts.push(`${r.added} nueva${r.added > 1 ? 's' : ''}`)
  if (r.grown) parts.push(`${r.grown} ampliada${r.grown > 1 ? 's' : ''}`)
  if (r.skipped) parts.push(`${r.skipped} ya estaba${r.skipped > 1 ? 'n' : ''}`)
  toast(`${from}: ${parts.join(' · ') || 'sin salidas'}`)
  return parsed.sessions
}

async function importFiles(files) {
  let last = null
  for (const f of files) {
    try {
      const sessions = await importText(await f.text(), f.name)
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
  const files = [...(e.dataTransfer?.files || [])].filter((f) => /json/i.test(f.type) || f.name.endsWith('.json'))
  if (files.length) importFiles(files)
})

async function loadDemo() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}demo/telemetria-demo.json`)
    const sessions = await importText(await res.text(), 'demo')
    open(sessions[0].meta.id)
  } catch (e) {
    toast(`No se pudo cargar la demo: ${e.message}`, 5000)
  }
}

let deviceCache = null
async function checkDevice() {
  deviceCache = await deviceSessions()
  const b = root.querySelector('[data-act="device"]')
  b.hidden = !deviceCache.length
  b.textContent = `DE ESTE MOVIL (${deviceCache.length})`
}

// ---------- Abrir una salida ----------
// Un respiro para que se pinte «ANALIZANDO» (sin requestAnimationFrame: en una pestaña oculta no llega)
const nextFrame = () => new Promise((r) => setTimeout(r, 30))

async function open(id) {
  K('busy').hidden = false
  await nextFrame()
  try {
    const data = await loadSession(id)
    if (!data) throw new Error('No está en la biblioteca')
    const A = analyze(data)
    if (A.empty) throw new Error('Sin GPS suficiente para analizarla')
    S.id = id
    S.A = A
    S.range = [0, A.n - 1]
    S.cur = A.valid.indexOf(1)
    history.replaceState(null, '', `#s=${encodeURIComponent(id)}`)
    K('empty').hidden = true
    K('work').hidden = false
    root.querySelector('[data-act="csv"]').disabled = false
    ensureViews()
    const m = A.meta
    K('title').innerHTML = `<b>${fmtDateTime(m.start)}</b> · ${toDist(A.stats.dist).toFixed(1)} ${distUnit()} · ${fmtDur(A.stats.dur)}${m.source !== 'real' ? ` · <i class="src ${m.source}">${(SRC[m.source] || ['?'])[0]}</i>` : ''}${m.rider?.bike ? ` · ${esc(m.rider.bike)}` : ''}`
    if (S.map) paintMap(true)
    buildCharts()
    renderAll()
    refreshList()
  } catch (e) {
    toast(`No se pudo abrir: ${e.message}`, 5000)
    console.error(e)
  } finally {
    K('busy').hidden = true
  }
}

// Las gráficas salen ya; el mapa (librería grande y teselas por la red) llega cuando esté
function ensureViews() {
  if (S.charts) return
  S.charts = createCharts(K('charts'), { onCursor: (i, from) => setCursor(i, from), onRange: (a, b) => setRange(a, b) })
  new ResizeObserver(() => S.charts.resize()).observe(K('charts'))
  K('maploading').hidden = false
  import('./map.js')
    .then(({ createMap }) => createMap(K('map'), { onHover: (i) => setCursor(i, 'map'), onPick: (i) => setCursor(i, 'map') }))
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
  out.push({ i: first, label: 'SALIDA', color: '#3dff7a', kind: 'start' }, { i: last, label: 'FIN', color: '#f4f1ff', kind: 'end' })
  for (const r of A.runs) {
    const head = r.marks?.['k0-100'] ?? r.marks?.['m0-60']
    out.push({ i: r.i, label: head != null ? `PASADA ${head.toFixed(2)} s` : 'PASADA', color: '#ffd23f', kind: 'run' })
  }
  for (const c of A.corners) out.push({ i: c.apex, label: `${c.n}`, color: '#ffd23f', kind: 'corner' })
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
  if (from !== 'chart') S.charts.setCursor(i, from)
  else S.charts.setCursor(i, 'chart')
  S.map?.setCursor(i)
  if (from === 'key' || from === 'list') S.map?.follow(i)
  cancelAnimationFrame(pending)
  pending = requestAnimationFrame(() => {
    renderReadout()
    if (prefs.tab === 'gg') drawGG(K('tabbody').querySelector('[data-k="gg"]'), A, ...S.range, S.cur)
    markCurrentRow()
  })
}

function setRange(a, b, { fit = true } = {}) {
  const A = S.A
  if (!A) return
  let i0 = Math.max(0, Math.min(a, b))
  let i1 = Math.min(A.n - 1, Math.max(a, b))
  if (i1 - i0 < 10) i1 = Math.min(A.n - 1, i0 + 10)
  S.range = [i0, i1]
  S.charts.setRange(i0, i1)
  S.map?.setTrack(A, prefs.mapCh, S.range)
  if (fit) S.map?.fit(i0, i1)
  if (S.cur < i0 || S.cur > i1) setCursor(Math.round((i0 + i1) / 2), 'range')
  renderRange()
  renderTab()
}

// ---------- Pintar ----------
function renderAll() {
  for (const b of root.querySelectorAll('[data-x]')) b.classList.toggle('on', b.dataset.x === prefs.xMode)
  for (const b of root.querySelectorAll('[data-u]')) b.classList.toggle('on', b.dataset.u === prefs.units)
  for (const b of root.querySelectorAll('[data-mapch]')) b.classList.toggle('on', b.dataset.mapch === prefs.mapCh)
  for (const b of root.querySelectorAll('[data-chart]')) b.classList.toggle('on', prefs.charts.includes(b.dataset.chart))
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

const tile = (k, l) => `<div class="tile"><span>${l}</span><b data-r="${k}">—</b></div>`
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

function renderRange() {
  const A = S.A
  if (!A) return
  const [i0, i1] = S.range
  const full = i0 === 0 && i1 === A.n - 1
  K('range').textContent = full ? `toda la salida · eje: ${S.charts.xLabel()}` : `${fmtElapsed(A.t[i0] - A.t[0])} → ${fmtElapsed(A.t[i1] - A.t[0])} · ${toDist(A.d[i1] - A.d[i0]).toFixed(2)} ${distUnit()}`
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
      const sp = (v) => `${toSpeed(v).toFixed(0)} ${speedUnit()}`
      return `<table class="kv">
        ${row('Distancia', `${toDist(s.dist).toFixed(2)} ${distUnit()}`)}
        ${row('Tiempo', fmtDur(s.dur))}
        ${row('En marcha', fmtDur(s.moving))}
        ${row('Media en marcha', sp(s.vAvg))}
        ${row('Punta', sp(s.vMax), s.iVMax)}
        ${row('Inclinación máx. IZQ', `${s.leanL.toFixed(1)}°`, s.iLeanL)}
        ${row('Inclinación máx. DER', `${s.leanR.toFixed(1)}°`, s.iLeanR)}
        ${row('Tumbado más de 30°', fmtDur(s.leaned30))}
        ${row('Frenada máx.', `${s.brake.toFixed(2)} g`, s.iBrake)}
        ${row('Aceleración máx.', `${s.accel.toFixed(2)} g`, s.iAccel)}
        ${row('G lateral máx.', `${s.gLat.toFixed(2)} g`)}
        ${row('G combinada máx.', `${s.gTot.toFixed(2)} g`)}
        ${row('Altitud', Number.isFinite(s.altMin) ? `${Math.round(s.altMin)}–${Math.round(s.altMax)} m` : '—')}
        ${row('Sube / baja', `${Math.round(s.climb)} / ${Math.round(s.descent)} m`)}
        ${row('Vibración media', Number.isFinite(s.vib) ? `${s.vib.toFixed(2)} m/s²` : '—')}
        ${row('Curvas · frenadas', `${A.corners.filter((c) => c.i0 >= i0 && c.i1 <= i1).length} · ${A.brakes.filter((c) => c.i0 >= i0 && c.i1 <= i1).length}`)}
      </table>`
    },
    gg() {
      return `<canvas class="gg" data-k="gg"></canvas><h4 class="h">TIEMPO A CADA INCLINACION</h4><canvas class="hist" data-k="hist"></canvas>`
    },
    curvas() {
      const list = A.corners.filter((c) => c.i0 >= i0 && c.i1 <= i1)
      const by = { n: (a, b) => a.n - b.n, lean: (a, b) => b.lean - a.lean, v: (a, b) => b.vMin - a.vMin }
      list.sort(by[prefs.sort] || by.n)
      if (!list.length) return '<p class="note">Sin curvas en este tramo (se cuentan las de más de 12° durante al menos 1 s).</p>'
      return `<div class="sort">ORDEN ${[['n', 'RECORRIDO'], ['lean', 'INCLINACION'], ['v', 'VEL. MIN']].map(([k, l]) => `<button class="chip ${prefs.sort === k ? 'on' : ''}" data-sort="${k}">${l}</button>`).join('')}</div>
        <table class="grid"><thead><tr><th>#</th><th></th><th>INCL</th><th>ENTRA</th><th>MIN</th><th>SALE</th><th>G LAT</th><th>s</th></tr></thead><tbody>
        ${list
          .map(
            (c) =>
              `<tr class="link" data-zoom="${c.i0},${c.i1},${c.apex}"><td>${c.n}</td><td class="${c.dir === 'L' ? 'l' : 'r'}">${c.dir === 'L' ? 'IZQ' : 'DER'}</td><td><b>${c.lean.toFixed(1)}°</b></td><td>${toSpeed(c.vIn).toFixed(0)}</td><td>${toSpeed(c.vMin).toFixed(0)}</td><td>${toSpeed(c.vOut).toFixed(0)}</td><td>${c.gLat.toFixed(2)}</td><td>${c.dur.toFixed(1)}</td></tr>`,
          )
          .join('')}</tbody></table><p class="note">Velocidades en ${speedUnit()}. Clic en una curva para verla.</p>`
    },
    frenadas() {
      const list = A.brakes.filter((c) => c.i0 >= i0 && c.i1 <= i1)
      if (!list.length) return '<p class="note">Sin frenadas en este tramo (se cuentan las de más de 0,25 g durante al menos 0,6 s).</p>'
      return `<table class="grid"><thead><tr><th>#</th><th>G MAX</th><th>DE</th><th>A</th><th>s</th><th>m</th></tr></thead><tbody>
        ${list.map((c) => `<tr class="link" data-zoom="${c.i0},${c.i1},${c.iMax}"><td>${c.n}</td><td><b>${c.g.toFixed(2)}</b></td><td>${toSpeed(c.vIn).toFixed(0)}</td><td>${toSpeed(c.vOut).toFixed(0)}</td><td>${c.dur.toFixed(1)}</td><td>${Math.round(c.len)}</td></tr>`).join('')}
        </tbody></table><p class="note">Velocidades en ${speedUnit()}.</p>`
    },
    pasadas() {
      if (!A.runs.length) return '<p class="note">Las pasadas del crono que hagas mientras graba aparecen aquí, con sus parciales.</p>'
      const NAMES = { 'k0-50': '0-50', 'k0-100': '0-100', 'k0-150': '0-150', 'k0-200': '0-200', 'k100-200': '100-200', 'm0-30': '0-30 mph', 'm0-60': '0-60 mph', 'm0-100': '0-100 mph', 'm60-130': '60-130 mph', '60ft': '60 ft', '330ft': '330 ft', '1/8': '1/8 milla', '1000ft': '1000 ft', '1/4': '1/4 milla' }
      return A.runs
        .map((r, k) => {
          const ms = Object.entries(r.marks || {})
          const end = Math.max(0, ...ms.map(([, t]) => t))
          return `<div class="run link" data-zoom="${Math.max(0, r.i - 30)},${Math.min(A.n - 1, r.i + Math.round((end + 4) / DT))},${r.i}">
            <h4>PASADA ${k + 1} · ${fmtClock(A.meta.start + r.t * 1000)} · punta ${toSpeed(r.maxV || 0).toFixed(0)} ${speedUnit()}</h4>
            <table class="kv">${ms.map(([id, t]) => row(NAMES[id] || id, `${t.toFixed(2)} s`)).join('')}</table></div>`
        })
        .join('')
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
      const LEAN = { 'gyro+roll': 'giroscopio (giro + alabeo)', gyro: 'giroscopio (giro)', gps: 'rumbo del GPS' }
      return `<table class="kv">
        ${row('Origen', `${(SRC[m.source] || [m.source])[0]}${m.sim ? ` · ${m.sim.hz} Hz, ${esc(m.sim.bike)}` : ''}`)}
        ${row('Estado', m.state === 'rec' ? 'a medias (se exportó grabando)' : 'cerrada')}
        ${row('Siguió tras cerrarse', `${m.resumed || 0} ${m.resumed === 1 ? 'vez' : 'veces'}`)}
        ${row('GPS', `${I.fixes} fixes · ${I.gpsHz.toFixed(2)} Hz · ±${I.accMean.toFixed(1)} m`)}
        ${row('Tramos sin GPS (>5 s)', `${Math.max(0, gaps - 1)}`)}
        ${row('Sensores', I.hasImu ? `${(m.rows?.imu ?? 0).toLocaleString('es')} muestras · ${I.imuHz.toFixed(0)} Hz` : 'no hay (simulador u ordenador)')}
        ${row('Postura: arriba', vec(I.mount?.up))}
        ${row('Postura: adelante', I.mount?.fwd ? `${vec(I.mount.fwd)} · R² ${I.mount.r2.toFixed(2)}` : 'no se pudo sacar (pocas aceleraciones)')}
        ${row('G longitudinal de', I.longFrom === 'imu' ? 'acelerómetro (calibrado con el GPS)' : 'velocidad del GPS')}
        ${row('Inclinación de', `${LEAN[I.leanFrom]}${I.yawCorr ? ` · correlación ${I.yawCorr.toFixed(2)}` : ''}`)}
        ${row('vs. el móvil: inclinación', dc ? `±${Math.sqrt(dl / dc).toFixed(1)}° de diferencia` : '—')}
        ${row('vs. el móvil: velocidad', dc ? `±${toSpeed(Math.sqrt(dv / dc)).toFixed(1)} ${speedUnit()}` : '—')}
        ${row('Calibración guardada', `cero ${m.calib?.leanZero != null ? `${((m.calib.leanZero * 180) / Math.PI).toFixed(1)}°` : '—'} · signo giro ${m.calib?.gyroSign ?? '—'}`)}
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
  if (d.del) {
    if (!confirm('¿Borrar esta salida de este navegador? (En el móvil sigue estando)')) return
    await deleteSession(d.del)
    if (d.del === S.id) location.hash = ''
    await refreshList()
    if (d.del === S.id) location.reload()
    return
  }
  if (d.act === 'demo') return loadDemo()
  if (d.act === 'device') {
    const r = await addSessions(deviceCache, 'este móvil')
    toast(`De este móvil: ${r.added} nuevas, ${r.grown} ampliadas`)
    await refreshList()
    if (S.list[0] && !S.id) open(S.list[0].id)
    return
  }
  if (d.act === 'csv') return exportCsv()
  if (!S.A) return
  if (d.act === 'all') return setRange(0, S.A.n - 1)
  if (d.x) {
    prefs.xMode = d.x
    savePrefs()
    buildCharts()
    return renderAll()
  }
  if (d.u) {
    prefs.units = units.speed = d.u
    savePrefs()
    buildCharts()
    S.map?.setTrack(S.A, prefs.mapCh, S.range)
    refreshList()
    return renderAll()
  }
  if (d.mapch) {
    prefs.mapCh = d.mapch
    savePrefs()
    S.map?.setTrack(S.A, prefs.mapCh, S.range)
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
    const pad = Math.round(3 / DT)
    setRange(a - pad, z + pad)
    return setCursor(c, 'list')
  }
  if (d.i) return setCursor(Number(d.i), 'list')
})

K('showApp').addEventListener('change', (e) => {
  prefs.showApp = e.target.checked
  savePrefs()
  if (S.A) buildCharts()
})

addEventListener('keydown', (e) => {
  if (!S.A || e.target.tagName === 'INPUT') return
  const step = e.shiftKey ? 10 : 1
  if (e.key === 'ArrowRight') setCursor(Math.min(S.range[1], S.cur + step), 'key')
  else if (e.key === 'ArrowLeft') setCursor(Math.max(S.range[0], S.cur - step), 'key')
  else if (e.key === 'Escape') setRange(0, S.A.n - 1)
  else return
  e.preventDefault()
})

// ---------- CSV ----------
function exportCsv() {
  const A = S.A
  if (!A) return
  const cols = ['t_s', 'hora', 'lat', 'lon', `dist_${distUnit()}`, `vel_${speedUnit().replace('/', '')}`, 'incl_grados', 'g_long', 'g_lat', 'alt_m', 'rumbo', 'giro_grados_s', 'vib_ms2', 'gps_precision_m']
  const lines = [cols.join(',')]
  const f = (x, d) => (Number.isFinite(x) ? x.toFixed(d) : '')
  for (let i = 0; i < A.n; i++) {
    if (!A.valid[i]) continue
    lines.push([f(A.t[i] - A.t[0], 1), new Date(A.meta.start + A.t[i] * 1000).toISOString(), f(A.lat[i], 7), f(A.lon[i], 7), f(toDist(A.d[i]), 4), f(toSpeed(A.v[i]), 2), f(A.lean[i], 2), f(A.gLong[i], 3), f(A.gLat[i], 3), f(A.alt[i], 1), f(A.hdg[i], 1), f(A.yaw[i], 2), f(A.vib[i], 3), f(A.acc[i], 1)].join(','))
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
  const d = new Date(A.meta.start)
  a.download = `streetchaos-${d.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}

// ---------- Arranque ----------
renderReadout()
await refreshList()
checkDevice()
const want = decodeURIComponent((location.hash.match(/s=([^&]+)/) || [])[1] || '')
if (want && S.list.some((m) => m.id === want)) open(want)
else if (S.list.length) open(S.list[0].id)
window.__bb = { S, prefs, open, setRange, setCursor }
