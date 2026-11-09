// BLACKBOX: analizador de la telemetría que graba la app (pensado para el ordenador; la dirección de
// la app abre esto en un ordenador). Se vincula con el móvil con un código de 6 letras: baja solo las
// salidas que sube el móvil y su perfil (nombre, moto, nivel, récords y tema de colores, que se usa
// aquí también). También importa los .json que exporta el móvil. Cada salida: mapa, gráficas
// sincronizadas, resumen, G-G, curvas, frenadas, pasadas, potencia y calidad de los datos.
import '@fontsource/press-start-2p'
import './style.css'
import { onDbBlocked, listSessions, addSessions, loadSession, deleteSession, parseExport, deviceSessions, listSegments, saveSegment, deleteSegment, getEfforts, putEfforts, updateMeta, gpsBbox } from './library.js'
import { analyze, rangeStats, DT } from './process.js'
import { makePath, findPasses, compare, pathPoints, runPass, bboxHit } from './align.js'
import { findPulls, pullCurve, envelope, DYNO, CDA_PRESETS } from './dyno.js'
import { cloudAvailable, getKey, setKey, keyFromUrl, validKey, normKey, listRemote, fetchRemote, deleteRemote, sharedCircuits, sharedCircuit, shareCircuit, ranking, publishEffort, fetchProfile, claimCode, normCode } from './cloud.js'
import { savedProfile, saveProfile, applyProfileTheme } from './theme.js'
import { pal } from './palette.js'
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
}
units.speed = prefs.units

const S = { list: [], segs: [], id: null, A: null, range: [0, 0], cur: 0, map: null, charts: null, cmp: null, cmpView: null, profile: savedProfile(), fresh: new Set() }
// Con el tema del móvil desde el primer momento (el perfil guardado de la última vez)
applyProfileTheme(S.profile)
if (S.profile?.units && !localStorage.getItem(PREFS)) prefs.units = units.speed = S.profile.units === 'mph' ? 'mph' : 'kmh'

// ---------- Estructura ----------
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
    <b class="tag">BLACKBOX</b>
    <div class="title" data-k="title">Analizador de telemetría</div>
    <button class="sync" data-k="sync" data-act="syncPill"></button>
    <div class="seg" data-k="xmode" title="Eje de las gráficas"><button data-x="t">TIEMPO</button><button data-x="d">DISTANCIA</button></div>
    <div class="seg" data-k="units"><button data-u="kmh">KM/H</button><button data-u="mph">MPH</button></div>
    <button class="btn ghost" data-act="csv" disabled title="Canales a 10 Hz para Excel u otras herramientas">CSV</button>
    <a class="btn ghost" href="../?app" title="Abrir la app del móvil en este ordenador (para probarla)">APP</a>
  </header>
  <aside class="lib">
    <div class="rider" data-k="rider"></div>
    <div class="cloud" data-k="cloud"></div>
    <h3 class="h">SALIDAS <span class="h-n" data-k="count"></span></h3>
    <div class="list" data-k="list"></div>
    <label class="drop" data-k="drop" title="También puedes soltar el archivo en cualquier parte de la página">
      <b>+ IMPORTAR</b>
      <span>.json de <i>Garaje → Datos → Exportar</i></span>
      <input type="file" accept=".json,application/json" multiple hidden>
    </label>
    <div class="lib-btns">
      <button class="btn ghost small" data-act="demo" title="Dos salidas inventadas por Oleiros para probarlo todo">VER DEMO</button>
      <button class="btn ghost small" data-act="device" hidden>DE ESTE MOVIL</button>
    </div>
    <h3 class="h">TRAMOS</h3>
    <div class="list" data-k="segs"></div>
    <button class="btn ghost small" data-act="shared" title="Circuitos cerrados con clasificación entre pilotos">CIRCUITOS COMPARTIDOS</button>
  </aside>
  <main class="main">
    <section class="empty" data-k="empty"></section>
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
            ${TABS.map(([id, l, tip]) => `<button data-tab="${id}" title="${tip}">${l}</button>`).join('')}
          </nav>
          <div class="tab-body" data-k="tabbody"></div>
        </div>
      </div>
      <div class="panel charts-box">
        <div class="cmp-box" data-k="cmp" hidden></div>
        <div data-k="chartsMain">
        <div class="ch-bar">
          <div class="chips" data-k="chartch">${CHART_CHANNELS.map((id) => `<button class="chip" data-chart="${id}">${CHANNELS[id].short}</button>`).join('')}</div>
          <label class="toggle"><input type="checkbox" data-k="showApp"> comparar con lo que calculó el móvil</label>
          <span class="grow"></span>
          <span class="range" data-k="range"></span>
          <button class="btn ghost small" data-act="all">VER TODO</button>
          <button class="btn cyan small" data-act="compare" title="Busca otras pasadas por este tramo (en esta salida o en otras) y compara">COMPARAR</button>
          <button class="btn ghost small" data-act="saveSeg" title="Guarda este tramo para cronometrarlo en todas tus salidas">GUARDAR TRAMO</button>
        </div>
        <div class="charts" data-k="charts"></div>
        <p class="hint">Arrastra sobre una gráfica o la tira de arriba para elegir un tramo · Ctrl/⌘ + rueda (o pellizca) para acercar · doble clic o Esc para verlo todo · ← → mueven el cursor</p>
        </div>
      </div>
    </section>
    <div class="busy" data-k="busy" hidden><span>ANALIZANDO…</span></div>
  </main>`

const K = (k) => root.querySelector(`[data-k="${k}"]`)
const fileInput = $('input[type=file]', K('drop'))

// ---------- Biblioteca ----------
const SRC = { real: ['REAL', 'real'], sim: ['SIM', 'sim'], demo: ['DEMO', 'demo'] }

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
          const tag = m.source !== 'real' || m.state === 'rec' ? `<i class="src ${cls}">${txt}${m.state === 'rec' ? ' · A MEDIAS' : ''}</i>` : ''
          return `${head}<div class="sess ${m.id === S.id ? 'on' : ''}" data-id="${esc(m.id)}">
            <button class="sess-open" data-open="${esc(m.id)}" title="${fmtDateTime(m.start)}">
              <b>${fmtClock(m.start).slice(0, 5)}${S.fresh.has(m.id) ? ' <em class="new">NUEVA</em>' : ''}</b>
              <span>${toDist(m.dist || 0).toFixed(1)} ${distUnit()} · ${fmtDur((m.end - m.start) / 1000)} · ${Math.round(toSpeed(vmaxOf(m)))} ${speedUnit()}</span>
            </button>
            ${tag}
            <button class="del" data-del="${esc(m.id)}" title="Borrar de este navegador" aria-label="Borrar">×</button>
          </div>`
        })
        .join('')
    : '<p class="note">Aún no hay salidas en este navegador.</p>'
  if (!S.id) renderHome()
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
  deviceCache = await deviceSessions()
  const b = root.querySelector('[data-act="device"]')
  b.hidden = !deviceCache.length
  b.textContent = `DE ESTE MOVIL (${deviceCache.length})`
}

// ---------- Abrir una salida ----------
// Un respiro para que se pinte «ANALIZANDO» (sin requestAnimationFrame: en una pestaña oculta no llega)
const nextFrame = () => new Promise((r) => setTimeout(r, 30))

async function open(id, { range, cur } = {}) {
  if (S.cmp) exitCompare()
  K('busy').hidden = false
  await nextFrame()
  try {
    const A = await analysisOf(id)
    if (!A) throw new Error('No está en la biblioteca')
    if (A.empty) throw new Error('Sin GPS suficiente para analizarla')
    S.id = id
    S.A = A
    S.range = [0, A.n - 1]
    S.cur = A.valid.indexOf(1)
    history.replaceState(null, '', `#s=${encodeURIComponent(id)}`)
    K('empty').hidden = true
    K('work').hidden = false
    // La punta del análisis (la que guardó el móvil antes podía ser falsa)
    const lm = S.list.find((x) => x.id === id)
    if (lm && Number.isFinite(A.stats.vMax) && Math.abs((lm.vmaxBB ?? -1) - A.stats.vMax) > 0.05) updateMeta({ ...lm, vmaxBB: A.stats.vMax }).catch(() => {})
    S.fresh.delete(id)
    root.querySelector('[data-act="csv"]').disabled = false
    ensureViews()
    const m = A.meta
    K('title').innerHTML = `<b>${fmtDateTime(m.start)}</b> · ${toDist(A.stats.dist).toFixed(1)} ${distUnit()} · ${fmtDur(A.stats.dur)}${m.source !== 'real' ? ` · <i class="src ${m.source}">${(SRC[m.source] || ['?'])[0]}</i>` : ''}${m.rider?.bike ? ` · ${esc(m.rider.bike)}` : ''}`
    if (S.map) paintMap(true)
    buildCharts()
    renderAll()
    refreshList()
    if (range) setRange(...range)
    if (cur != null) setCursor(cur, 'list')
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
  out.push({ i: first, label: 'SALIDA', color: pal('green'), kind: 'start' }, { i: last, label: 'FIN', color: pal('ink'), kind: 'end' })
  for (const r of A.runs) {
    const head = r.marks?.['k0-100'] ?? r.marks?.['m0-60']
    out.push({ i: r.i, label: head != null ? `PASADA ${head.toFixed(2)} s` : 'PASADA', color: pal('yellow'), kind: 'run' })
  }
  for (const c of A.corners) out.push({ i: c.apex, label: `${c.n}`, color: pal('yellow'), kind: 'corner' })
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
      const full = i0 === 0 && i1 === A.n - 1
      const sp = (v) => `${toSpeed(v).toFixed(0)}<small> ${speedUnit()}</small>`
      // Tarjeta; con i, al pulsarla lleva el cursor a ese momento
      const card = (label, val, i, cls = '') => `<div class="stat ${cls} ${i != null && i >= 0 ? 'link' : ''}" ${i != null && i >= 0 ? `data-i="${i}" title="Ver dónde"` : ''}><span>${label}</span><b>${val}</b></div>`
      const nC = A.corners.filter((c) => c.i0 >= i0 && c.i1 <= i1).length
      const nB = A.brakes.filter((c) => c.i0 >= i0 && c.i1 <= i1).length
      const p = getKey() ? S.profile?.totals : null
      // ¿Récord de tu móvil? (comparado con lo que tenía guardado)
      const pr = (v, best) => (p && Number.isFinite(best) && best > 0 && v >= best - 0.01 ? ' best' : '')
      return `<p class="scope">${full ? 'TODA LA SALIDA' : `TRAMO ELEGIDO · ${fmtElapsed(A.t[i0] - A.t[0])} → ${fmtElapsed(A.t[i1] - A.t[0])}`}${full ? '' : ' <button class="linkish" data-act="all">ver toda</button>'}</p>
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
      <p class="note">Pulsa una tarjeta con borde para ir a ese momento. Arrastra sobre las gráficas para ver solo un tramo.${p ? ' <b class="rec-dot">★</b> = igual o mejor que tu récord del móvil.' : ''}</p>`
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
            <h4>PASADA ${k + 1} · ${fmtClock(A.meta.start + r.t * 1000)} · punta ${toSpeed(r.maxV || 0).toFixed(0)} ${speedUnit()} <button class="btn cyan small" data-runcmp="${k}">COMPARAR</button></h4>
            <table class="kv">${ms.map(([id, t]) => row(NAMES[id] || id, `${t.toFixed(2)} s`)).join('')}</table></div>`
        })
        .join('')
    },
    potencia() {
      const d = prefs.dyno
      const pulls = findPulls(A, i0, i1)
      return `<div class="dyno-cfg">
          <label>Moto <input type="number" data-dyno="bike" value="${d.bike}" min="50" max="600" step="5"> kg</label>
          <label>Piloto <input type="number" data-dyno="rider" value="${d.rider}" min="30" max="200" step="1"> kg</label>
          <div class="chips">${CDA_PRESETS.map(([l, v]) => `<button class="chip ${d.cda === v ? 'on' : ''}" data-cda="${v}" title="CdA ${v} m²">${l}</button>`).join('')}</div>
          <label class="toggle"><input type="checkbox" data-dyno="slope" ${d.slope ? 'checked' : ''}> corregir con la pendiente (altitud del GPS)</label>
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
  if (d.act === 'link') return linkDialog()
  if (d.act === 'home') return goHome()
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
    if (d.del === S.id) location.hash = ''
    await refreshList()
    if (d.del === S.id) goHome()
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
  if (d.act === 'compare') return compareDialog()
  if (d.act === 'saveSeg') return saveSegDialog()
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
  if (!S.A || e.target.tagName === 'INPUT') return
  const step = e.shiftKey ? 10 : 1
  if (e.key === 'ArrowRight') setCursor(Math.min(S.range[1], S.cur + step), 'key')
  else if (e.key === 'ArrowLeft') setCursor(Math.max(S.range[0], S.cur - step), 'key')
  else if (e.key === 'Escape') setRange(0, S.A.n - 1)
  else return
  e.preventDefault()
})


// ---------- Análisis en caché (comparar y tramos miran varias salidas) ----------
const cache = new Map()
async function analysisOf(id) {
  if (S.A && S.id === id) return S.A
  if (cache.has(id)) return cache.get(id)
  const data = await loadSession(id)
  if (!data) return null
  const A = analyze(data)
  cache.set(id, A)
  if (cache.size > 4) cache.delete(cache.keys().next().value)
  return A
}

/** Caja de la salida (las importadas antes de guardarla se calculan una vez). */
async function bboxOf(m) {
  if (m.bbox) return m.bbox
  const data = await loadSession(m.id)
  m.bbox = data ? gpsBbox(data.gps) : null
  await updateMeta(m)
  return m.bbox
}

const fmtLen = (m) => (m >= 1000 ? `${toDist(m).toFixed(2)} ${distUnit()}` : `${Math.round(m)} m`)
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
  const [i0, i1] = S.range
  if (A.d[i1] - A.d[i0] < 100) return toast('Elige un tramo de al menos 100 m: arrastra sobre una gráfica')
  const P = makePath(pathPoints(A, i0, i1))
  const own = findPasses(P, A, { from: i0 - 150, to: i1 + 150 })
  const ref = own.find((p) => p.i0 <= i0 + 60 && p.i1 >= i1 - 60) || own[0]
  if (!ref) return toast('No se pudo usar este tramo como referencia')
  const el = modal(`<h2>COMPARAR ESTE TRAMO</h2>
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
  const head = (r) => r.marks?.['k0-100'] ?? r.marks?.['m0-60']
  found.sort((a, b) => (head(a.run) ?? 99) - (head(b.run) ?? 99))
  box.innerHTML = `<table class="grid"><thead><tr><th>#</th><th>PASADA</th><th>0-100</th><th>1/8</th><th>PUNTA</th></tr></thead><tbody>
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

/** Compara la pasada `ref` de la salida abierta con `f` (otra pasada, de esta salida u otra). */
async function startCompare(ref, f, L, labels) {
  const B = f.id === S.id ? S.A : await analysisOf(f.id)
  const C = compare(ref, S.A, f.pass, B, L)
  S.cmp = { C, B, ref, f }
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
  if (S.A) (buildCharts(), setRange(...S.range))
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
  const [i0, i1] = S.range
  const pts = pathPoints(A, i0, i1)
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
const EFFORTS_VERSION = 2

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
        return { t0: p.t0, t1: p.t1, time: p.time, i0: p.i0, i1: p.i1, vmax, lean }
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
  const p = findPasses(makePath(seg.points), A).find((q) => Math.abs(q.t0 - e.t0) < 0.5)
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
  if (seg.circuit) renderShared(seg, efforts, el.querySelector('[data-k="shared"]'))
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
        ? `<table class="grid"><thead><tr><th>#</th><th>PILOTO</th><th>MOTO</th><th>TIEMPO</th><th>FECHA</th></tr></thead><tbody>${rows
            .map((r, k) => `<tr class="${r.device === me ? 'cur' : ''}"><td>${k + 1}</td><td>${esc(r.rider)}</td><td>${esc(r.bike)}</td><td><b>${fmtLap(r.time_s)}</b></td><td>${fmtDateTime(Date.parse(r.ridden_at))}</td></tr>`)
            .join('')}</tbody></table>`
        : '<p class="note">Nadie ha publicado todavía.</p>'
    }${efforts.length ? `<button class="btn small" data-k="pub">PUBLICAR MI MEJOR (${fmtLap(efforts[0].time)})</button>` : ''}<p class="note">Los tiempos se publican tal cual, sin comprobar: es una clasificación entre amigos.</p>`
    const pub = box.querySelector('[data-k="pub"]')
    if (pub)
      pub.onclick = async () => {
        const rider = askRider()
        if (rider == null) return
        const e = efforts[0]
        try {
          await publishEffort({ segment_id: seg.remoteId, rider, bike: String(e.meta.rider?.bike || '').slice(0, 30), time_s: e.time, v_max: Math.min(150, e.vmax), lean_max: Math.min(80, e.lean), ridden_at: new Date(e.meta.start + e.t0 * 1000).toISOString(), device: me })
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
  const name = prompt('Tu nombre en la clasificación (lo verán los demás):', prefs.rider || '')
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
      const c = await sharedCircuit(b.dataset.add)
      const P = makePath(c.points)
      await saveSegment({ id: `seg-r-${c.id}`, name: c.name, points: c.points, length: P.length, closed: c.closed, circuit: true, remoteId: c.id, bbox: P.bbox, createdAt: Date.now() })
      b.outerHTML = 'AÑADIDO'
      refreshSegs()
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
  const [i0, i1] = S.range
  const pulls = findPulls(A, i0, i1)
  const curves = pulls.map((p) => ({ p, c: pullCurve(A, p, prefs.dyno) }))
  const env = envelope(curves.map((x) => x.c))
  const peakJ = env.cv.reduce((b, v, j) => (v > env.cv[b] ? j : b), 0)
  const sp = (kmh) => (units.speed === 'mph' ? kmh / 1.609344 : kmh)
  body.querySelector('[data-k="dpeak"]').innerHTML = `<b>${env.cv[peakJ].toFixed(0)} CV</b> en rueda <small>(${(env.cv[peakJ] * 0.7355).toFixed(0)} kW)</small> a ${sp(env.kmh[peakJ]).toFixed(0)} ${speedUnit()}`
  body.querySelector('[data-k="dpulls"]').innerHTML = curves
    .map(({ p, c }, k) => `<tr class="link" data-zoom="${p.i0},${p.i1},${p.i0}"><td>${k + 1}</td><td>${fmtClock(A.meta.start + A.t[p.i0] * 1000)}</td><td>${toSpeed(p.v0).toFixed(0)}</td><td>${toSpeed(p.v1).toFixed(0)}</td><td><b>${c.peak.cv.toFixed(0)} CV</b></td><td>${sp(c.peak.kmh).toFixed(0)}</td></tr>`)
    .join('')
  // Todas las curvas sobre el mismo eje de velocidad
  const xs = env.kmh
  const COLORS = ['#22e3ff', '#ff2e88', '#3dff7a', '#ff8a1f', '#9d8cff']
  const series = [{}, { stroke: '#ffd23f', width: 2.5, label: 'Máx' }]
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
        { stroke: '#8a80c4', font: '11px ui-monospace, Menlo, monospace', grid: { stroke: '#241a4d' }, ticks: { stroke: '#241a4d' }, label: speedUnit(), labelFont: '11px ui-monospace, Menlo, monospace', labelSize: 18 },
        { stroke: '#8a80c4', font: '11px ui-monospace, Menlo, monospace', grid: { stroke: '#241a4d' }, ticks: { stroke: '#241a4d' }, label: 'CV', labelFont: '11px ui-monospace, Menlo, monospace', labelSize: 18, size: 44 },
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
            <b>${toDist(m.dist || 0).toFixed(1)} <small>${distUnit()}</small></b>
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
      <p class="alt">Otras formas: <button class="linkish" data-act="link">pegar la clave larga</button> · <label class="linkish">importar un archivo .json<input type="file" accept=".json,application/json" multiple hidden data-k="homeFile"></label> · <button class="linkish" data-act="demo">ver la demo</button></p>
    </section>`
  if (!p) {
    el.innerHTML = `${linked ? `<section class="onboard"><h2>VINCULADO</h2><p>${S.list.length ? 'Tus salidas llegan solas. Elige una a la izquierda o aquí abajo.' : 'Aún no ha llegado nada: el móvil sube cada salida al terminarla (con conexión). Si acabas de vincularlo, abre la app en el móvil un momento.'}</p></section>` : onboarding}${rideCards ? `<h3 class="h">ULTIMAS SALIDAS</h3>${rideCards}` : ''}`
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
    ${rideCards ? `<h3 class="h">ULTIMAS SALIDAS</h3>${rideCards}` : '<p class="note">Aún no ha llegado ninguna salida: el móvil sube cada una al terminarla.</p>'}`
}

/** Vuelve al inicio (perfil y salidas). */
function goHome() {
  if (S.cmp) exitCompare()
  S.id = null
  S.A = null
  history.replaceState(null, '', location.pathname + location.search)
  root.querySelector('[data-act="csv"]').disabled = true
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
    // El fondo del mapa se tiñe al crearlo: con otro tema se recarga (vuelve a la misma salida)
    if (S.map) return location.reload()
    // Lo dibujado en canvas lleva los colores dentro: se vuelve a dibujar
    if (S.A) (buildCharts(), renderAll())
  }
  if (changed) renderCloud()
}

let syncing = null
function cloudSync() {
  syncing ??= (async () => {
    if (!getKey() || !cloudAvailable()) return renderCloud()
    renderCloud('Mirando si hay salidas nuevas…', 'busy')
    try {
      await syncProfile()
      const remote = await listRemote()
      const have = new Map(S.list.map((m) => [m.id, m]))
      const todo = remote.filter((r) => {
        const h = have.get(r.id)
        return !h || (h.bytes ?? 0) < (r.meta?.bytes ?? 0)
      })
      let n = 0
      for (const r of todo) {
        renderCloud(`Bajando ${++n} de ${todo.length}…`, 'busy')
        const sess = await fetchRemote(r.id)
        await addSessions([sess], 'nube')
        if (!have.has(r.id)) S.fresh.add(r.id)
        cache.delete(r.id)
      }
      await refreshList()
      lastSync = Date.now()
      renderCloud(todo.length ? `${todo.length} ${todo.length === 1 ? 'salida nueva' : 'salidas nuevas'}` : `Al día · ${remote.length} en la nube · ${fmtClock(lastSync).slice(0, 5)}`)
      if (todo.length) toast(`${todo.length === 1 ? 'Ha llegado una salida nueva' : `Han llegado ${todo.length} salidas nuevas`} de tu móvil`)
    } catch (e) {
      renderCloud(`No se pudo: ${e.message}`, 'err')
    }
  })().finally(() => (syncing = null))
  return syncing
}

// Sola: cada minuto mientras se ve la página, y al volver a ella
let lastSync = 0
setInterval(() => document.visibilityState === 'visible' && getKey() && cloudSync(), 60000)
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && getKey() && Date.now() - lastSync > 15000 && cloudSync())

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
keyFromUrl()
renderReadout()
renderCloud()
await refreshList()
refreshSegs()
checkDevice()
cloudSync()
// Con un enlace a una salida (#s=…) se abre; si no, el inicio (perfil y últimas salidas)
const want = decodeURIComponent((location.hash.match(/s=([^&]+)/) || [])[1] || '')
if (want && S.list.some((m) => m.id === want)) open(want)
else renderHome()
window.__bb = { S, prefs, open, setRange, setCursor }
