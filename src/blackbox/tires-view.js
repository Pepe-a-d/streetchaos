// Pestaña NEUMATICOS del Blackbox: qué parte de la banda has usado (siempre, sale de la inclinación) y,
// si lo activaste en el móvil (Garaje → Opciones avanzadas), la temperatura estimada de cada rueda por
// zonas a lo largo de la salida, con el tiempo que hacía.
import uPlot from 'uplot'
import { treadUsage, runSeries, modelConfig, tireSettings, tireState, workingTemp, TIRE_TYPES, STATE_NAMES, parseSize, roadTemp } from '../core/tires.js'
import { weatherAt } from '../core/weather.js'
import { pal } from './palette.js'
import { DT } from './process.js'

const EDGE = 54
const RAD = Math.PI / 180
const pct = (x) => `${Math.round(x * 100)} %`
const fmtMin = (s) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`)

/** Corte del neumático visto desde detrás: la banda, cuánto rato pisaste cada parte y la tira sin usar. */
function treadSvg(u) {
  const W = 320
  const H = 150
  const cx = W / 2
  const cy = 142
  const r = 112
  const pt = (deg, rr = r) => [cx + rr * Math.sin(deg * RAD), cy - rr * Math.cos(deg * RAD)]
  const arc = (a, b, rr = r) => {
    const [x0, y0] = pt(a, rr)
    const [x1, y1] = pt(b, rr)
    return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${rr} ${rr} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`
  }
  const max = Math.max(...u.bins) || 1
  let segs = ''
  for (let k = 0; k < 24; k++) {
    const a = Math.max(-EDGE, -60 + 5 * k)
    const b = Math.min(EDGE, -55 + 5 * k)
    if (b <= a || !u.bins[k]) continue
    // Raíz: así también se ven las partes que pisaste poco
    const o = 0.18 + 0.82 * Math.sqrt(u.bins[k] / max)
    segs += `<path d="${arc(a, b)}" stroke="var(--yellow)" stroke-opacity="${o.toFixed(2)}" stroke-width="16" fill="none"/>`
  }
  const strip = (from, to) => (to > from ? `<path d="${arc(from, to)}" stroke="var(--red)" stroke-width="16" fill="none" stroke-dasharray="3 3"/>` : '')
  const tick = (deg, label) => {
    const [x0, y0] = pt(deg, r - 12)
    const [x1, y1] = pt(deg, r + 12)
    const [tx, ty] = pt(deg, r + 24)
    return `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="var(--ink)" stroke-width="2"/><text x="${tx}" y="${ty}" text-anchor="middle" font-size="9" fill="var(--ink)">${label}</text>`
  }
  return `<svg class="tread" viewBox="0 0 ${W} ${H}" role="img" aria-label="Uso de la banda">
    <path d="${arc(-EDGE - 6, EDGE + 6, r)}" stroke="var(--line)" stroke-width="22" fill="none"/>
    <path d="${arc(-EDGE, EDGE)}" stroke="var(--panel2)" stroke-width="16" fill="none"/>
    ${strip(-EDGE, -Math.min(EDGE, u.maxL))}${strip(Math.min(EDGE, u.maxR), EDGE)}
    ${segs}
    ${u.maxL > 0 ? tick(-Math.min(EDGE, u.maxL), `${Math.round(u.maxL)}°`) : ''}${u.maxR > 0 ? tick(Math.min(EDGE, u.maxR), `${Math.round(u.maxR)}°`) : ''}
    <text x="8" y="${H - 6}" font-size="9" fill="var(--dim)">IZQ</text><text x="${W - 8}" y="${H - 6}" font-size="9" fill="var(--dim)" text-anchor="end">DER</text>
  </svg>`
}

/** Lo de la banda, para el tramo [i0, i1]. */
export function treadHtml(A, i0, i1, profileTires) {
  const st = tireSettings(profileTires)
  const fW = parseSize(st.front, '100/80-17').W
  const rW = parseSize(st.rear, '130/70-17').W
  const args = { i0, i1, lean: (i) => A.lean[i], valid: (i) => A.valid[i], v: (i) => A.v[i], dt: DT }
  const uR = treadUsage(args, rW)
  const uF = treadUsage(args, fW)
  if (uR.time < 5) return '<p class="note">Hace falta ir en marcha un rato con la inclinación medida para ver qué parte de la banda usas.</p>'
  const mine = profileTires ? '' : ' (medidas de serie: pon las tuyas en el móvil, Garaje → Opciones avanzadas)'
  return `<h4 class="h">USO DE LA BANDA</h4>
    <div class="tread-box">${treadSvg(uR)}
      <div class="tread-share"><span class="l">IZQ <b>${pct(uR.share.L)}</b></span><span>CENTRO <b>${pct(uR.share.C)}</b></span><span class="r">DER <b>${pct(uR.share.R)}</b></span></div>
    </div>
    <table class="kv">
      <tr><th>Inclinación máxima</th><td>izquierda ${uR.maxL.toFixed(0)}° · derecha ${uR.maxR.toFixed(0)}°</td></tr>
      <tr><th>Sin estrenar delante</th><td>${uF.unusedL} mm a la izquierda · ${uF.unusedR} mm a la derecha</td></tr>
      <tr><th>Sin estrenar detrás</th><td>${uR.unusedL} mm a la izquierda · ${uR.unusedR} mm a la derecha</td></tr>
    </table>
    <p class="note">Amarillo: lo que pisaste (más intenso, más rato). Rojo: la tira de cada lado que no llegaste a usar, hasta el borde de la banda (~${EDGE}°). Es una estimación con la inclinación medida (±4°) y el ancho de tus neumáticos${mine}.</p>`
}

// ---------- Temperatura ----------
const cache = new Map()

/** La serie del análisis tal como la quiere el modelo (sin GPS cuenta como parado). */
function seriesOf(A) {
  const v = new Float32Array(A.n)
  for (let i = 0; i < A.n; i++) v[i] = A.valid[i] ? A.v[i] : NaN
  return { n: A.n, dt: DT, v, gLong: A.gLong, gLat: A.gLat, lean: A.lean }
}

function firstFix(A) {
  for (let i = 0; i < A.n; i++) if (A.valid[i] && Number.isFinite(A.lat[i]) && Number.isFinite(A.lon[i])) return { lat: A.lat[i], lon: A.lon[i] }
  return null
}

/**
 * El tiempo de esa salida: el guardado en su ficha, o se pregunta a Open-Meteo (una vez) y se guarda.
 * Sin tiempo de internet (o si lo apagaste), tu temperatura a mano.
 */
export async function sessionWeather(A, meta, st, saveMeta) {
  if (!st.weather) return { tAir: Number(st.airManual) || 15, src: 'manual' }
  if (meta?.weather?.src === 'open-meteo') return meta.weather
  const p = firstFix(A)
  const mid = A.meta.start + (A.t[A.n - 1] * 1000) / 2
  const w = p ? await weatherAt(p.lat, p.lon, mid) : null
  if (!w) return { tAir: Number(st.airManual) || 15, src: 'manual', failed: true }
  if (meta && saveMeta) {
    meta.weather = w
    saveMeta(meta).catch(() => {})
  }
  return w
}

/** La temperatura de toda la salida (se guarda mientras no cambien los ajustes ni el tiempo). */
export function sessionTemps(A, st, env) {
  const key = `${A.meta.id}|${JSON.stringify(modelConfig(st))}|${env.tAir}|${env.sun}|${env.wet}`
  if (cache.has(key)) return cache.get(key)
  const e = { ...env, tRoad: env.tRoad ?? roadTemp(env) }
  const r = runSeries(seriesOf(A), modelConfig(st), e)
  cache.clear()
  cache.set(key, r)
  return r
}

/** Resumen de un tramo: máximos, cuándo entró en temperatura y cuánto rato fue en su ventana. */
function tempStats(A, R, i0, i1, type) {
  const [lo] = TIRE_TYPES[type].ok
  const out = {}
  for (const w of ['f', 'r']) {
    let max = -Infinity
    let iMax = i0
    let warm = null
    let inWin = 0
    let moving = 0
    let t0 = null
    for (let i = i0; i <= i1; i++) {
      const z = { L: R[w + 'L'][i], C: R[w + 'C'][i], R: R[w + 'R'][i] }
      const wt = workingTemp(z, A.lean[i])
      if (wt > max) (max = wt), (iMax = i)
      if (!(A.valid[i] && A.v[i] > 3)) continue
      t0 ??= A.t[i]
      moving += DT
      if (tireState(wt, type) === 'ok') inWin += DT
      if (warm == null && wt >= lo) warm = A.t[i] - t0
    }
    out[w] = { max, iMax, warm, inWin, share: moving ? inWin / moving : 0, core: R[w + 'core'][i1] }
  }
  return out
}

/** HTML de la parte de temperatura (las gráficas se dibujan luego con drawTemps). */
export function tempsHtml(A, R, i0, i1, st, env) {
  const type = TIRE_TYPES[st.type] ? st.type : 'calle'
  const [lo, hi] = TIRE_TYPES[type].ok
  const s = tempStats(A, R, i0, i1, type)
  const nCal = st.cals?.length || 0
  const lastCal = nCal ? st.cals[st.cals.length - 1] : null
  const envTxt = env.src === 'open-meteo' ? `${env.tAir.toFixed(1)} °C de aire${env.sun > 30 ? `, sol ${Math.round(env.sun)} W/m²` : ''}${env.wet ? ', lloviendo' : ''} (Open-Meteo)` : `${env.tAir.toFixed(1)} °C de aire (a mano${env.failed ? ': no se pudo consultar el tiempo' : ''})`
  const card = (w, label) => {
    const x = s[w]
    return `<div class="stat link" data-i="${x.iMax}" title="Ver dónde"><span>${label} MAX</span><b>${x.max.toFixed(0)}<small> °C</small></b></div>
      <div class="stat"><span>${label} EN VENTANA</span><b>${pct(x.share)}</b></div>
      <div class="stat"><span>${label} A ${lo} °C</span><b>${x.warm == null ? 'NO' : fmtMin(x.warm)}</b></div>`
  }
  return `<h4 class="h">TEMPERATURA ESTIMADA</h4>
    <div class="tire-now" data-k="tirenow"></div>
    <div class="stats">${card('f', 'DEL.')}${card('r', 'TRAS.')}</div>
    <div class="tire-chart" data-k="tchartF"></div>
    <div class="tire-chart" data-k="tchartR"></div>
    <p class="note">Neumático ${TIRE_TYPES[type].name.toLowerCase()} (ventana ${lo}–${hi} °C, la franja verde) · ${envTxt}. Líneas: centro, hombro izquierdo y derecho; a trazos, la carcasa.
    ${nCal ? `Calibrado con ${nCal} ${nCal === 1 ? 'medida' : 'medidas'}${lastCal && Number.isFinite(lastCal.err1) ? ` (la última cuadró a ±${lastCal.err1.toFixed(1)} °C)` : ''}.` : '<b>Sin calibrar</b>: fíate más de las subidas y bajadas que del número. Calibra con un termómetro en el móvil, Garaje → Opciones avanzadas.'}
    No se mide: se calcula con la velocidad, las G, la inclinación, tus presiones y el tiempo.</p>`
}

let plots = []
/** Las dos gráficas (delantero y trasero) del tramo. */
export function drawTemps(body, A, R, i0, i1, st, onPick) {
  plots.forEach((p) => p.destroy())
  plots = []
  const type = TIRE_TYPES[st.type] ? st.type : 'calle'
  const [lo, hi] = TIRE_TYPES[type].ok
  const step = Math.max(1, Math.ceil((i1 - i0 + 1) / 3000))
  const idx = []
  for (let i = i0; i <= i1; i += step) idx.push(i)
  const xs = idx.map((i) => A.t[i] / 60)
  for (const [w, k, label] of [['f', 'tchartF', 'DELANTERO'], ['r', 'tchartR', 'TRASERO']]) {
    const host = body.querySelector(`[data-k="${k}"]`)
    if (!host) continue
    const data = [xs, ...['C', 'L', 'R', 'core'].map((z) => idx.map((i) => R[w + z][i]))]
    // Se ve siempre el borde de abajo de la ventana buena (y entera si llegas a ella)
    let mx = -Infinity
    let mn = Infinity
    for (const arr of data.slice(1)) for (const v of arr) (mx = Math.max(mx, v)), (mn = Math.min(mn, v))
    mx = Math.max(mx + 3, lo + 8)
    const font = '11px ui-monospace, Menlo, monospace'
    const axis = { stroke: pal('dim'), font, grid: { stroke: pal('grid') }, ticks: { stroke: pal('grid') } }
    const p = new uPlot(
      {
        title: label,
        width: Math.max(200, host.clientWidth),
        height: 150,
        legend: { show: false },
        cursor: { points: { show: false }, drag: { x: false, y: false } },
        scales: { x: { time: false }, y: { range: () => [Math.floor((mn - 2) / 5) * 5, Math.ceil(mx / 5) * 5] } },
        axes: [{ ...axis, label: 'min', labelFont: font, labelSize: 16 }, { ...axis, label: '°C', labelFont: font, labelSize: 16, size: 40 }],
        series: [{}, { stroke: pal('yellow'), width: 2, label: 'Centro' }, { stroke: pal('cyan'), width: 1.5, label: 'Izq' }, { stroke: pal('pink'), width: 1.5, label: 'Der' }, { stroke: pal('dim'), width: 1, dash: [4, 4], label: 'Carcasa' }].map((x, j) => (j ? { ...x, points: { show: false } } : x)),
        hooks: {
          // La ventana de temperatura buena, de fondo
          drawClear: [
            (u) => {
              const c = u.ctx
              const y0 = u.valToPos(hi, 'y', true)
              const y1 = u.valToPos(lo, 'y', true)
              c.save()
              c.fillStyle = pal('green') + '22'
              const top = Math.max(u.bbox.top, y0)
              const bot = Math.min(u.bbox.top + u.bbox.height, y1)
              if (bot > top) c.fillRect(u.bbox.left, top, u.bbox.width, bot - top)
              c.restore()
            },
          ],
        },
      },
      data,
      host,
    )
    p.over.addEventListener('click', () => {
      const j = p.cursor.idx
      if (j != null) onPick?.(idx[j])
    })
    plots.push(p)
  }
}

/** Las temperaturas en el cursor. */
export function tireNowHtml(A, R, i, st) {
  if (!R || i == null) return ''
  const type = TIRE_TYPES[st.type] ? st.type : 'calle'
  const wheel = (w, label) => {
    const z = { L: R[w + 'L'][i], C: R[w + 'C'][i], R: R[w + 'R'][i] }
    const wt = workingTemp(z, A.lean[i])
    const state = tireState(wt, type)
    const cell = (k) => `<span class="tz ${tireState(z[k], type)}">${z[k].toFixed(0)}°</span>`
    return `<div class="tw"><b>${label}</b>${cell('L')}${cell('C')}${cell('R')}<em class="${state}">${STATE_NAMES[state]}</em></div>`
  }
  return `${wheel('f', 'DEL')}${wheel('r', 'TRAS')}`
}

export function destroyTemps() {
  plots.forEach((p) => p.destroy())
  plots = []
}
