// Vista de comparación: dos pasadas por el mismo sitio alineadas por distancia. Arriba la diferencia
// de tiempo (+ = la otra va por detrás, − = va por delante); debajo velocidad, inclinación y G de las dos.
import { pal } from './palette.js'
import uPlot from 'uplot'
import { toSpeed, speedUnit } from './channels.js'

// Colores del tema (palette.js)
const REF = () => pal('cyan')
const CMP = () => pal('pink')
const GRID = () => pal('grid')
const AXIS = () => pal('dim')
const FONT = '11px ui-monospace, SFMono-Regular, Menlo, monospace'

const fmtS = (x) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(2)} s`
export const fmtLap = (t) => {
  if (!Number.isFinite(t)) return '—'
  if (t < 60) return `${t.toFixed(2)} s`
  const m = Math.floor(t / 60)
  return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`
}

/** Color de cada punto de la otra pasada: verde si ahí gana tiempo, rojo si lo pierde. */
export function gainColors(C) {
  const w = Math.max(1, Math.round(10 / C.step))
  const out = new Array(C.n)
  for (let k = 0; k < C.n; k++) {
    const a = Math.max(0, k - w)
    const b = Math.min(C.n - 1, k + w)
    const slope = (C.delta[b] - C.delta[a]) / Math.max(1e-6, C.s[b] - C.s[a])
    out[k] = slope < -0.0015 ? pal('green') : slope > 0.0015 ? pal('red') : pal('ink')
  }
  return out
}

export function createCompareView(el, { onCursor, onExit }) {
  let plots = []
  let C = null
  let A = null
  let B = null
  let quiet = false
  let full = [0, 0]

  const width = () => Math.max(200, el.querySelector('.cmp-stack')?.clientWidth || el.clientWidth)
  const xFmt = (v) => (C.L > 2000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`)
  const nul = (x) => (Number.isFinite(x) ? x : null)

  function setX(min, max) {
    for (const { u } of plots) u.setScale('x', { min, max })
  }

  function show(c, a, b, { refLabel, cmpLabel, kind }) {
    C = c
    A = a
    B = b
    for (const p of plots) p.u.destroy()
    plots = []
    const end = C.delta[C.n - 1]
    el.innerHTML = `
      <div class="cmp-head">
        <span class="cmp-ref"><i style="background:${REF()}"></i>${refLabel} · <b>${fmtLap(C.timeA)}</b></span>
        <span class="cmp-cmp"><i style="background:${CMP()}"></i>${cmpLabel} · <b>${fmtLap(C.timeB)}</b></span>
        <span class="cmp-delta ${end < 0 ? 'gain' : 'loss'}">${fmtS(end)}</span>
        <span class="grow"></span>
        <button class="btn ghost small" data-cmp="all">VER TODO</button>
        <button class="btn small" data-cmp="exit">SALIR DE COMPARAR</button>
      </div>
      <p class="hint">${kind === 'run' ? 'Pasadas del crono alineadas por la distancia desde la salida.' : 'Alineadas por la distancia a lo largo del trazado de referencia.'} Diferencia: − la ${'rosa'} va por delante, + va por detrás. En el mapa, la rosa sale verde donde gana tiempo y roja donde lo pierde.</p>
      <div class="cmp-stack"></div>`
    el.querySelector('[data-cmp="exit"]').onclick = () => onExit()
    el.querySelector('[data-cmp="all"]').onclick = () => setX(C.s[0], C.s[C.n - 1])
    const stack = el.querySelector('.cmp-stack')
    const xs = Array.from(C.s)
    full = [xs[0], xs[xs.length - 1]]
    const val = (S, idx, fn) => Array.from(idx, (i) => nul(fn(S, i)))
    const charts = [
      { id: 'delta', label: 'Diferencia', unit: 's', data: [Array.from(C.delta, nul)], colors: [pal('yellow')], fmt: (v) => fmtS(v), sym: true },
      { id: 'v', label: 'Velocidad', unit: speedUnit(), data: [val(A, C.iA, (S, i) => toSpeed(S.v[i])), val(B, C.iB, (S, i) => toSpeed(S.v[i]))], colors: [REF(), CMP()], fmt: (v) => `${v.toFixed(0)}` },
      { id: 'lean', label: 'Inclinación', unit: '°', data: [val(A, C.iA, (S, i) => S.lean[i]), val(B, C.iB, (S, i) => S.lean[i])], colors: [REF(), CMP()], fmt: (v) => `${Math.abs(v).toFixed(0)}° ${v < 0 ? 'I' : 'D'}`, sym: true },
      { id: 'g', label: 'G longitudinal', unit: 'g', data: [val(A, C.iA, (S, i) => S.gLong[i]), val(B, C.iB, (S, i) => S.gLong[i])], colors: [REF(), CMP()], fmt: (v) => v.toFixed(2), sym: true },
    ]
    charts.forEach((ch, k) => {
      const last = k === charts.length - 1
      const box = document.createElement('div')
      box.className = 'chart'
      box.innerHTML = `<div class="ch-head"><span class="ch-name" style="color:${ch.colors.length > 1 ? pal('ink') : ch.colors[0]}">${ch.label}</span><span class="ch-val" data-k="val">—</span></div><div class="ch-plot"></div>`
      stack.append(box)
      const u = new uPlot(
        {
          width: width(),
          height: k === 0 ? 150 : last ? 140 : 118,
          legend: { show: false },
          scales: {
            x: { time: false },
            y: {
              range: (u, mn, mx) => {
                if (mn == null) return [-1, 1]
                if (ch.sym) {
                  const m = Math.max(Math.abs(mn), Math.abs(mx), ch.id === 'delta' ? 0.2 : 0.1) * 1.1
                  return [-m, m]
                }
                const p = (mx - mn) * 0.08 || 1
                return [Math.max(0, mn - p), mx + p]
              },
            },
          },
          cursor: { sync: { key: 'cmp', setSeries: false }, drag: { x: true, y: false, setScale: false }, points: { size: 7 } },
          select: { show: true },
          axes: [
            { stroke: AXIS(), font: FONT, grid: { stroke: GRID() }, ticks: { stroke: GRID(), size: 4 }, size: last ? 26 : 6, values: last ? (u, v) => v.map(xFmt) : (u, v) => v.map(() => '') },
            { stroke: AXIS(), font: FONT, grid: { stroke: GRID() }, ticks: { stroke: GRID(), size: 4 }, size: 54 },
          ],
          series: [{}, ...ch.colors.map((c, j) => ({ stroke: c, width: j ? 1.5 : 1.8, fill: ch.colors.length === 1 ? c + '22' : undefined, points: { show: false } }))],
          hooks: {
            setCursor: [
              (u) => {
                const i = u.cursor.idx
                if (i == null) return
                const vals = ch.data.map((d) => d[i])
                box.querySelector('[data-k="val"]').innerHTML = vals.map((v, j) => `<span style="color:${ch.colors[j]}">${v == null ? '—' : ch.fmt(v)}</span>`).join(' · ') + ` <small>${ch.unit}</small>`
                if (!quiet) onCursor(i)
              },
            ],
            setSelect: [
              (u) => {
                if (u.select.width > 4) setX(u.posToVal(u.select.left, 'x'), u.posToVal(u.select.left + u.select.width, 'x'))
                u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false)
              },
            ],
          },
        },
        [xs, ...ch.data],
        box.querySelector('.ch-plot'),
      )
      box.addEventListener('dblclick', () => setX(...full))
      plots.push({ u })
    })
  }

  return {
    show,
    get data() {
      return C
    },
    /** Cursor en el punto k de la comparación (desde fuera). */
    setCursorK(k) {
      quiet = true
      for (const { u } of plots) {
        const left = u.valToPos(C.s[k], 'x')
        u.setCursor({ left, top: u.over.clientHeight / 2 })
      }
      quiet = false
    },
    resize() {
      const w = width()
      for (const { u } of plots) u.setSize({ width: w, height: u.height })
    },
    destroy() {
      for (const p of plots) p.u.destroy()
      plots = []
      C = null
      el.innerHTML = ''
    },
  }
}
