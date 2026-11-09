// Diagrama G-G (círculo de fricción) con su envolvente, e histograma de inclinación, del tramo elegido.
import { pal, contrast, halo } from './palette.js'
import { rampColor, toSpeed, speedUnit } from './channels.js'

// Colores del tema (palette.js)
const SPEED = () => [[0, pal('line')], [0.25, pal('cyan')], [0.5, pal('green')], [0.75, pal('yellow')], [1, pal('pink')]]
const LEAN = () => [[0, pal('line')], [0.3, pal('cyan')], [0.55, pal('green')], [0.75, pal('yellow')], [1, pal('red')]]

function setup(canvas) {
  const dpr = devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  return { ctx, w, h }
}

function drawBase(A, i0, i1, w, h, dpr, key) {
  const off = document.createElement('canvas')
  off.width = Math.round(w * dpr)
  off.height = Math.round(h * dpr)
  const ctx = off.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const size = Math.min(w, h)
  const cx = w / 2
  const cy = h / 2
  // Escala: hasta el máximo del tramo (mínimo 1 g)
  let gmax = 1
  for (let i = i0; i <= i1; i++) if (A.valid[i] && A.v[i] > 3) gmax = Math.max(gmax, Math.hypot(A.gLat[i], A.gLong[i]))
  gmax = Math.ceil(gmax * 4) / 4
  const R = size / 2 - 22
  const k = R / gmax

  ctx.strokeStyle = pal('grid')
  ctx.fillStyle = pal('dim')
  ctx.font = '10px ui-monospace, Menlo, monospace'
  ctx.lineWidth = 1
  for (let g = 0.25; g <= gmax + 1e-6; g += 0.25) {
    ctx.beginPath()
    ctx.setLineDash(g % 0.5 ? [2, 4] : [])
    ctx.arc(cx, cy, g * k, 0, Math.PI * 2)
    ctx.stroke()
    if (!(g % 0.5)) ctx.fillText(`${g.toFixed(1)}`, cx + g * k * 0.71 + 2, cy - g * k * 0.71 - 2)
  }
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(cx - R, cy)
  ctx.lineTo(cx + R, cy)
  ctx.moveTo(cx, cy - R)
  ctx.lineTo(cx, cy + R)
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.fillText('ACELERA', cx, cy - R - 8)
  ctx.fillText('FRENA', cx, cy + R + 16)
  ctx.textAlign = 'left'
  ctx.fillText('IZQ', 2, cy - 4)
  ctx.textAlign = 'right'
  ctx.fillText('DER', w - 2, cy - 4)

  // Puntos (como mucho ~12 000) coloreados por velocidad
  const n = i1 - i0 + 1
  const step = Math.max(1, Math.floor(n / 12000))
  const vTop = Math.max(10, A.stats.vMax)
  const SECT = 36
  const env = new Float64Array(SECT)
  ctx.globalAlpha = 0.55
  // Por colores: 24 tonos de la rampa, cada uno de una vez (antes se calculaba el color punto a punto)
  const NC = 24
  const ramp = SPEED()
  const groups = Array.from({ length: NC }, () => [])
  for (let i = i0; i <= i1; i += step) {
    if (!A.valid[i] || A.v[i] < 3) continue
    const x = A.gLat[i]
    const y = A.gLong[i]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    groups[Math.min(NC - 1, Math.floor((A.v[i] / vTop) * NC))].push(cx + x * k - 1.5, cy - y * k - 1.5)
  }
  groups.forEach((g, c) => {
    if (!g.length) return
    ctx.fillStyle = rampColor(ramp, (c + 0.5) / NC)
    for (let j = 0; j < g.length; j += 2) ctx.fillRect(g[j], g[j + 1], 3, 3)
  })
  for (let i = i0; i <= i1; i++) {
    if (!A.valid[i] || A.v[i] < 3) continue
    const x = A.gLat[i]
    const y = A.gLong[i]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const s = Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * SECT) % SECT
    env[s] = Math.max(env[s], Math.hypot(x, y))
  }
  ctx.globalAlpha = 1
  // Envolvente: lo máximo que has usado en cada dirección
  ctx.strokeStyle = pal('ink')
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let s = 0; s <= SECT; s++) {
    const a = ((s % SECT) + 0.5) / SECT * 2 * Math.PI - Math.PI
    const r = env[s % SECT] * k
    const px = cx + Math.cos(a) * r
    const py = cy - Math.sin(a) * r
    s ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
  }
  ctx.stroke()
  ctx.textAlign = 'left'
  ctx.fillStyle = pal('dim')
  ctx.fillText(`color: ${speedUnit()} (0-${Math.round(toSpeed(vTop))})`, 4, h - 4)
  return { key, canvas: off, k, cx, cy }
}

// El fondo (rejilla, puntos y envolvente) se dibuja una vez por tramo y tamaño en un lienzo aparte; al
// mover el cursor solo se copia y se pinta el círculo (antes se redibujaban ~12 000 puntos a cada paso)
let base = null // { key, canvas, k, cx, cy, vTop }

export function drawGG(canvas, A, i0, i1, cur) {
  const { ctx, w, h } = setup(canvas)
  const dpr = devicePixelRatio || 1
  const key = `${A.meta?.id}|${A.n}|${i0}|${i1}|${w}|${h}|${dpr}|${pal('cyan')}|${pal('bg')}|${speedUnit()}`
  if (base?.key !== key) base = drawBase(A, i0, i1, w, h, dpr, key)
  ctx.drawImage(base.canvas, 0, 0, w, h)
  const { k, cx, cy } = base
  if (cur != null && A.valid[cur]) {
    const x = cx + A.gLat[cur] * k
    const y = cy - A.gLong[cur] * k
    ctx.strokeStyle = halo()
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(x, y, 7, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = contrast()
    ctx.lineWidth = 2
    ctx.stroke()
  }
}

/** Tiempo a cada inclinación (bloques de 5°, de 60° IZQ a 60° DER), por encima de 20 km/h. */
export function drawLeanHist(canvas, A, i0, i1) {
  const { ctx, w, h } = setup(canvas)
  const B = 24
  const bins = new Float64Array(B)
  for (let i = i0; i <= i1; i++) {
    if (!A.valid[i] || A.v[i] < 5.5) continue
    const b = Math.floor((A.lean[i] + 60) / 5)
    if (b >= 0 && b < B) bins[b] += 0.1
  }
  const max = Math.max(1, ...bins)
  const left = 4
  const bottom = h - 16
  const bw = (w - left * 2) / B
  for (let b = 0; b < B; b++) {
    const mid = Math.abs(b * 5 - 60 + 2.5)
    const bh = (bins[b] / max) * (bottom - 14)
    ctx.fillStyle = rampColor(LEAN(), mid / 55)
    ctx.fillRect(left + b * bw + 1, bottom - bh, bw - 2, bh)
  }
  ctx.fillStyle = pal('dim')
  ctx.font = '10px ui-monospace, Menlo, monospace'
  ctx.textAlign = 'center'
  for (const deg of [-60, -40, -20, 0, 20, 40, 60]) ctx.fillText(`${Math.abs(deg)}`, left + ((deg + 60) / 5) * bw, h - 3)
  ctx.textAlign = 'left'
  ctx.fillText('IZQ', left, 10)
  ctx.textAlign = 'right'
  ctx.fillText('DER', w - left, 10)
  ctx.textAlign = 'center'
  ctx.fillText(`máx ${Math.round(max)} s`, w / 2, 10)
}
