// Gráficas apiladas con el eje X compartido (tiempo o distancia): cursor sincronizado entre ellas y
// con el mapa, zoom arrastrando o con la rueda, y una tira de vista general para moverse por la sesión.
import { pal, contrast } from './palette.js'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { CHANNELS, toDist, distUnit, fmt, fmtElapsed } from './channels.js'

// Colores del tema (palette.js): se leen al construir las gráficas
const GRID = () => pal('grid')
const AXIS = () => pal('dim')
const FONT = '11px ui-monospace, SFMono-Regular, Menlo, monospace'

const nulls = (A, fn) => {
  const out = new Array(A.n)
  for (let i = 0; i < A.n; i++) {
    const v = A.valid[i] ? fn(i) : NaN
    out[i] = Number.isFinite(v) ? v : null
  }
  return out
}

export function createCharts(el, { onCursor, onRange, fill = null }) {
  // fill(): alto disponible para todas las gráficas (en su propia ventana se reparten la pantalla entera)
  const plotH = (last, n) => {
    if (!fill) return last ? 150 : 124
    const h = Math.max(100, Math.floor((fill() - 54 - 40 - n * 22) / Math.max(1, n)))
    return last ? h + 26 : h
  }
  el.innerHTML = `<div class="overview" data-k="ov"></div><div class="stack" data-k="stack"></div>`
  const ovEl = el.querySelector('[data-k="ov"]')
  const stackEl = el.querySelector('[data-k="stack"]')
  let A = null
  let xs = []
  let xMode = 't'
  let plots = []
  let ov = null
  let range = [0, 0]
  let quiet = false // cursor puesto por código: que no rebote
  let cur = null

  const xFmt = (v) => (xMode === 't' ? fmtElapsed(v).replace(/\.\d$/, '') : `${v.toFixed(v < 10 ? 2 : 1)}`)
  const idxOf = (x) => {
    let lo = 0
    let hi = xs.length - 1
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (xs[m] < x) lo = m + 1
      else hi = m
    }
    return lo
  }
  const width = () => Math.max(200, stackEl.clientWidth)

  function axes(last) {
    return [
      { stroke: AXIS(), font: FONT, grid: { stroke: GRID(), width: 1 }, ticks: { stroke: GRID(), width: 1, size: 4 }, size: last ? 26 : 6, values: last ? (u, vals) => vals.map(xFmt) : (u, vals) => vals.map(() => '') },
      { stroke: AXIS(), font: FONT, grid: { stroke: GRID(), width: 1 }, ticks: { stroke: GRID(), width: 1, size: 4 }, size: 54 },
    ]
  }

  function build(an, { ids, mode, showApp }) {
    A = an
    xMode = mode
    for (const p of plots) p.u.destroy()
    ov?.destroy()
    plots = []
    stackEl.innerHTML = ''
    const t0 = A.t[0]
    xs = new Array(A.n)
    for (let i = 0; i < A.n; i++) xs[i] = mode === 't' ? A.t[i] - t0 : toDist(A.d[i]) + i * 1e-9
    range = [0, A.n - 1]

    ids.forEach((id, k) => {
      const ch = CHANNELS[id]
      const last = k === ids.length - 1
      const box = document.createElement('div')
      box.className = 'chart'
      box.innerHTML = `<div class="ch-head"><span class="ch-name" style="color:${ch.color}">${ch.label}</span><span class="ch-val" data-k="val">—</span>${showApp && ch.app ? '<span class="ch-app">- - móvil</span>' : ''}</div><div class="ch-plot"></div>`
      stackEl.append(box)
      const series = [{}, { stroke: ch.color, width: 1.5, fill: ch.color + '1a', points: { show: false } }]
      const data = [xs, nulls(A, (i) => ch.get(A, i))]
      if (showApp && ch.app) {
        series.push({ stroke: pal('ink'), width: 1, dash: [4, 4], points: { show: false } })
        data.push(nulls(A, (i) => ch.app(A, i)))
      }
      const u = new uPlot(
        {
          width: width(),
          height: plotH(last, ids.length),
          legend: { show: false },
          scales: { x: { time: false }, y: { range: (u, mn, mx) => padRange(id, mn, mx) } },
          cursor: { sync: { key: 'bb', setSeries: false }, drag: { x: true, y: false, setScale: false }, points: { size: 7, fill: contrast() } },
          select: { show: true },
          axes: axes(last),
          series,
          hooks: {
            setCursor: [
              (u) => {
                if (quiet) return
                const i = u.cursor.idx
                if (i != null && i !== cur) {
                  cur = i
                  onCursor(i, 'chart')
                }
              },
            ],
            setSelect: [
              (u) => {
                if (u.select.width > 4) {
                  const a = idxOf(u.posToVal(u.select.left, 'x'))
                  const b = idxOf(u.posToVal(u.select.left + u.select.width, 'x'))
                  if (b - a > 5) onRange(a, b, 'select')
                }
                u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false)
              },
            ],
          },
        },
        data,
        box.querySelector('.ch-plot'),
      )
      plots.push({ id, u, val: box.querySelector('[data-k="val"]') })
      // Ctrl/⌘ + rueda (o pellizco en el trackpad): zoom alrededor del ratón; la rueda sola mueve la página
      box.addEventListener(
        'wheel',
        (e) => {
          if (!e.ctrlKey && !e.metaKey) return
          e.preventDefault()
          const rect = u.over.getBoundingClientRect()
          const x = u.posToVal(e.clientX - rect.left, 'x')
          const [a, b] = [xs[range[0]], xs[range[1]]]
          const f = e.deltaY > 0 ? 1.25 : 0.8
          const na = x - (x - a) * f
          const nb = x + (b - x) * f
          onRange(idxOf(Math.max(xs[0], na)), Math.min(A.n - 1, idxOf(Math.min(xs[A.n - 1], nb))), 'wheel')
        },
        { passive: false },
      )
      box.addEventListener('dblclick', () => onRange(0, A.n - 1, 'all'))
    })

    // Vista general: velocidad de toda la sesión con el tramo visible marcado; arrastra para elegir
    ov = new uPlot(
      {
        width: width(),
        height: 54,
        legend: { show: false },
        scales: { x: { time: false } },
        cursor: { drag: { x: true, y: false, setScale: false }, points: { show: false }, y: false },
        select: { show: true },
        axes: [{ show: false }, { show: false }],
        series: [{}, { stroke: pal('cyan'), width: 1, fill: pal('cyan') + '22', points: { show: false } }],
        hooks: {
          draw: [
            (u) => {
              const { ctx } = u
              const l = u.valToPos(xs[range[0]], 'x', true)
              const r = u.valToPos(xs[range[1]], 'x', true)
              const { top, height, left, width: w } = u.bbox
              ctx.save()
              ctx.fillStyle = pal('bg') + '9e'
              ctx.fillRect(left, top, l - left, height)
              ctx.fillRect(r, top, left + w - r, height)
              ctx.strokeStyle = pal('yellow')
              ctx.lineWidth = 2 * devicePixelRatio
              ctx.strokeRect(l, top + 1, Math.max(2, r - l), height - 2)
              ctx.restore()
            },
          ],
          setSelect: [
            (u) => {
              if (u.select.width > 3) onRange(idxOf(u.posToVal(u.select.left, 'x')), idxOf(u.posToVal(u.select.left + u.select.width, 'x')), 'select')
              u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false)
            },
          ],
        },
      },
      [xs, nulls(A, (i) => CHANNELS.v.get(A, i))],
      ovEl,
    )
    ovEl.title = 'Arrastra para elegir el tramo · doble clic en una gráfica para verlo todo'
  }

  function padRange(id, mn, mx) {
    if (mn == null || mx == null) return [0, 1]
    if (id === 'lean') {
      const m = Math.max(15, Math.abs(mn), Math.abs(mx))
      return [-m * 1.08, m * 1.08]
    }
    if (id === 'gLong' || id === 'gLat' || id === 'yaw') {
      const m = Math.max(id === 'yaw' ? 10 : 0.3, Math.abs(mn), Math.abs(mx))
      return [-m * 1.1, m * 1.1]
    }
    const pad = (mx - mn) * 0.08 || 1
    return [id === 'v' || id === 'vib' || id === 'acc' ? Math.max(0, mn - pad) : mn - pad, mx + pad]
  }

  return {
    build,
    setRange(i0, i1) {
      range = [i0, i1]
      for (const { u } of plots) u.setScale('x', { min: xs[i0], max: xs[i1] })
      ov?.redraw(false)
    },
    setCursor(i, from) {
      cur = i
      for (const { id, u, val } of plots) {
        val.textContent = fmt(id, CHANNELS[id].get(A, i))
        if (from === 'chart') continue
        quiet = true
        const left = u.valToPos(xs[i], 'x')
        if (left >= 0 && left <= u.over.clientWidth) u.setCursor({ left, top: u.over.clientHeight / 2 })
        else u.setCursor({ left: -10, top: -10 })
        quiet = false
      }
    },
    resize() {
      const w = width()
      plots.forEach(({ u }, k) => u.setSize({ width: w, height: fill ? plotH(k === plots.length - 1, plots.length) : u.height }))
      ov?.setSize({ width: w, height: 54 })
    },
    xLabel: () => (xMode === 't' ? 'tiempo (min:s)' : `distancia (${distUnit()})`),
    get x() {
      return xs
    },
  }
}
