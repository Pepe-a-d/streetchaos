// Alinear recorridos: proyecta una salida sobre un trazado de referencia (otra salida, una vuelta o
// un tramo guardado) para saber, en cada metro del trazado, cuándo pasó cada uno. Con eso se comparan
// tiempos a la misma distancia (dónde ganas o pierdes) y se cronometran tramos y vueltas.
import { DT } from './process.js'

const R = 6371008.8
const RAD = Math.PI / 180
const CELL = 40 // m: rejilla para encontrar rápido el trozo de trazado más cercano

const key = (cx, cy) => cx * 100003 + cy

/** Trazado a partir de puntos [lat, lon] (se saltan los que están a menos de 2 m del anterior). */
export function makePath(points) {
  const [lat0, lon0] = points[0]
  const kx = Math.cos(lat0 * RAD) * R * RAD
  const ky = R * RAD
  const X = []
  const Y = []
  for (const [la, lo] of points) {
    const x = (lo - lon0) * kx
    const y = (la - lat0) * ky
    if (X.length && Math.hypot(x - X.at(-1), y - Y.at(-1)) < 2) continue
    X.push(x)
    Y.push(y)
  }
  const n = X.length
  const S = new Float64Array(n)
  const H = new Float64Array(Math.max(1, n - 1))
  for (let k = 1; k < n; k++) S[k] = S[k - 1] + Math.hypot(X[k] - X[k - 1], Y[k] - Y[k - 1])
  for (let k = 0; k < n - 1; k++) H[k] = (Math.atan2(X[k + 1] - X[k], Y[k + 1] - Y[k]) / RAD + 360) % 360
  const grid = new Map()
  for (let k = 0; k < n - 1; k++) {
    const x0 = Math.floor(Math.min(X[k], X[k + 1]) / CELL)
    const x1 = Math.floor(Math.max(X[k], X[k + 1]) / CELL)
    const y0 = Math.floor(Math.min(Y[k], Y[k + 1]) / CELL)
    const y1 = Math.floor(Math.max(Y[k], Y[k + 1]) / CELL)
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const g = grid.get(key(cx, cy))
        if (g) g.push(k)
        else grid.set(key(cx, cy), [k])
      }
  }
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let no = -Infinity
  for (const [la, lo] of points) (w = Math.min(w, lo)), (e = Math.max(e, lo)), (s = Math.min(s, la)), (no = Math.max(no, la))
  return { lat0, lon0, kx, ky, X, Y, S, H, n, grid, length: S[n - 1], closed: n > 2 && Math.hypot(X[0] - X[n - 1], Y[0] - Y[n - 1]) < 30, bbox: [w, s, e, no] }
}

/** Puntos del trazado a menos de `tol` m de (lat, lon) con un rumbo compatible: [{s, d}] */
export function candidates(P, lat, lon, hdg, tol = 25) {
  const x = (lon - P.lon0) * P.kx
  const y = (lat - P.lat0) * P.ky
  const cx = Math.floor(x / CELL)
  const cy = Math.floor(y / CELL)
  const out = []
  const seen = new Set()
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      const list = P.grid.get(key(cx + i, cy + j))
      if (!list) continue
      for (const k of list) {
        if (seen.has(k)) continue
        seen.add(k)
        const ax = P.X[k]
        const ay = P.Y[k]
        const dx = P.X[k + 1] - ax
        const dy = P.Y[k + 1] - ay
        const L2 = dx * dx + dy * dy || 1e-9
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2))
        const d = Math.hypot(x - ax - u * dx, y - ay - u * dy)
        if (d > tol) continue
        if (Number.isFinite(hdg) && Math.abs(((hdg - P.H[k] + 540) % 360) - 180) > 75) continue
        out.push({ s: P.S[k] + u * Math.sqrt(L2), d })
      }
    }
  return out
}

/**
 * Pasadas de la salida A por el trazado P: entra por el principio y llega al final sin salirse.
 * Cada una: { i0, i1, t0, t1, time, s[], t[], idx[] } con t0/t1 interpolados al cruzar el inicio
 * y el final (segundos de la sesión de A). En un circuito cerrado, una vuelta empieza donde acaba la otra.
 */
export function findPasses(P, A, { from = 0, to = A.n - 1, tol = 25, maxMiss = 6 } = {}) {
  const L = P.length
  const START = Math.min(40, L * 0.15)
  const passes = []
  let cur = null
  let miss = 0
  const finish = () => {
    // Desde la última muestra en el inicio (s = 0, proyección pegada al principio) hasta la primera en el final
    const { s, t, idx } = cur
    // Muestras de dentro: entre las que están pegadas al inicio (s = 0) y las pegadas al final (s = L)
    let a = -1
    while (a + 1 < s.length && s[a + 1] <= 0.01) a++
    let b = s.length
    while (b - 1 > a && s[b - 1] >= L - 0.01) b--
    const f = a + 1
    const l = b - 1
    if (l - f < 1) return
    const vAt = (k) => Math.max(0.5, A.v[idx[k]])
    // Cruce del inicio y del final con la velocidad del momento (entre muestras a 10 Hz)
    const t0 = t[f] - s[f] / vAt(f)
    // Si no llegó a cruzar el final (paró o se acabó la salida justo ahí), el final es su última muestra
    const t1 = s.at(-1) >= L - 0.01 ? t[l] + (L - s[l]) / vAt(l) : t[l]
    const S = [0, ...s.slice(f, l + 1), L]
    const T = [t0, ...t.slice(f, l + 1), t1]
    const I = [idx[f], ...idx.slice(f, l + 1), idx[l]]
    passes.push({ i0: idx[f], i1: idx[l], t0, t1, time: t1 - t0, s: S, t: T, idx: I })
  }
  for (let i = Math.max(0, from); i <= Math.min(A.n - 1, to); i++) {
    if (!A.valid[i]) {
      if (cur && (miss += DT) > maxMiss) cur = null
      continue
    }
    const hdg = A.v[i] > 3 ? A.hdg[i] : NaN
    const cands = candidates(P, A.lat[i], A.lon[i], hdg, tol)
    if (cur) {
      const last = cur.s.at(-1)
      const expect = last + A.v[i] * DT
      // En las horquillas la proyección puede saltar varias decenas de metros de una muestra a otra
      const hi = last + Math.max(40, A.v[i] * DT * 6 + 30)
      let best = null
      for (const c of cands) if (c.s >= last - 8 && c.s <= hi && (!best || Math.abs(c.s - expect) < Math.abs(best.s - expect))) best = c
      // Perdido un momento: se engancha al primer punto por delante (en el mismo sentido)
      if (!best && miss >= 1) for (const c of cands) if (c.s > last - 8 && c.s <= last + 200 && (!best || c.s < best.s)) best = c
      const nearEnd = last >= L - Math.min(15, L * 0.03)
      if (!best) {
        // Se sale del trazado justo al final (o el trazado acaba donde paró): cuenta como llegada
        if (nearEnd) (finish(), (cur = null))
        else if ((miss += DT) > maxMiss) cur = null
        continue
      }
      miss = 0
      const sNow = Math.max(last, best.s)
      cur.s.push(sNow)
      cur.t.push(A.t[i])
      cur.idx.push(i)
      const stopped = nearEnd && A.v[i] < 0.5
      if (sNow < L - 0.01 && !stopped && i < to) continue
      if (sNow < L - 0.01 && !nearEnd) {
        cur = null
        continue
      }
      finish()
      cur = null
    }
    // Empezar: cerca del principio del trazado y en marcha
    let st = null
    for (const c of cands) if (c.s < START && (!st || c.s < st.s)) st = c
    if (st && A.v[i] > 1) {
      cur = { s: [st.s], t: [A.t[i]], idx: [i] }
      miss = 0
    }
  }
  return passes
}

/** Pasada del crono como recorrido: distancia desde la salida hasta 1/4 de milla o hasta que frena. */
export function runPass(A, run, maxDist = 402.336) {
  const iL = run.i
  const tL = run.t
  const dL = A.d[iL]
  const s = [0]
  const t = [tL]
  const idx = [iL]
  let vMax = 0
  for (let i = iL + 1; i < A.n; i++) {
    if (!A.valid[i]) break
    const d = A.d[i] - dL
    vMax = Math.max(vMax, A.v[i])
    if (A.t[i] - tL > 1.5 && (A.gLong[i] < -0.15 || A.v[i] < vMax * 0.9)) break
    s.push(Math.max(s.at(-1), d))
    t.push(A.t[i])
    idx.push(i)
    if (d >= maxDist) break
  }
  const L = s.at(-1)
  return { i0: iL, i1: idx.at(-1), t0: tL, t1: t.at(-1), time: t.at(-1) - tL, s, t, idx, length: L }
}

/** Valor de ys en q, con xs creciente (si hay tramos planos, se queda con el último). */
function interpMono(xs, ys, q) {
  let lo = 0
  let hi = xs.length - 1
  if (q <= xs[0]) return ys[0]
  if (q >= xs[hi]) return ys[hi]
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (xs[m] <= q) lo = m
    else hi = m
  }
  const f = xs[hi] > xs[lo] ? (q - xs[lo]) / (xs[hi] - xs[lo]) : 1
  return ys[lo] + (ys[hi] - ys[lo]) * f
}

/**
 * La pasada medida con la distancia que recorre la propia moto (velocidad integrada), escalada para
 * que vaya de 0 a L. La proyección punto a punto sobre el trazado se atasca en las horquillas (el
 * punto más cercano se queda atrás y luego salta); la distancia propia avanza suave y llega igual.
 */
function byOwnDistance(r, S, L) {
  const n = r.idx.length
  if (n < 4) return r
  const f = 1
  const l = n - 2
  const d0 = S.d[r.idx[f]] - Math.max(0, S.v[r.idx[f]]) * (r.t[f] - r.t0)
  const d1 = S.d[r.idx[l]] + Math.max(0, S.v[r.idx[l]]) * (r.t1 - r.t[l])
  const k = d1 > d0 ? L / (d1 - d0) : 1
  const s = [0]
  for (let q = f; q <= l; q++) s.push(Math.min(L, Math.max(s.at(-1), (S.d[r.idx[q]] - d0) * k)))
  s.push(L)
  return { ...r, s }
}

/**
 * Compara dos pasadas por el mismo trazado de longitud L: en cada `step` m, el tiempo de cada una
 * desde su inicio, la diferencia (+ = la comparada va por detrás) y sus canales.
 */
export function compare(ra, A, rb, B, L, step) {
  step ??= L > 3000 ? 5 : L > 600 ? 2 : 1
  ra = byOwnDistance(ra, A, L)
  rb = byOwnDistance(rb, B, L)
  const n = Math.ceil(L / step) + 1 // el último punto, justo en L
  const out = { n, L, step, s: new Float64Array(n), tA: new Float64Array(n), tB: new Float64Array(n), delta: new Float64Array(n), iA: new Int32Array(n), iB: new Int32Array(n) }
  for (let k = 0; k < n; k++) {
    const s = Math.min(L, k * step)
    out.s[k] = s
    out.tA[k] = interpMono(ra.s, ra.t, s) - ra.t0
    out.tB[k] = interpMono(rb.s, rb.t, s) - rb.t0
    out.delta[k] = out.tB[k] - out.tA[k]
    out.iA[k] = Math.round(interpMono(ra.s, ra.idx, s))
    out.iB[k] = Math.round(interpMono(rb.s, rb.idx, s))
  }
  out.timeA = ra.time
  out.timeB = rb.time
  return out
}

/** Puntos [lat, lon] de un tramo de la salida, uno cada ~4 m (para guardarlo como trazado). */
export function pathPoints(A, i0, i1, spacing = 4) {
  const pts = []
  let last = null
  for (let i = i0; i <= i1; i++) {
    if (!A.valid[i]) continue
    const p = [Math.round(A.lat[i] * 1e7) / 1e7, Math.round(A.lon[i] * 1e7) / 1e7]
    if (last && Math.hypot((p[0] - last[0]) * R * RAD, (p[1] - last[1]) * R * RAD * Math.cos(p[0] * RAD)) < spacing && i !== i1) continue
    pts.push(p)
    last = p
  }
  return pts
}

/** ¿Se tocan dos cajas [oeste, sur, este, norte]? Con un margen en grados. */
export const bboxHit = (a, b, m = 0.001) => a && b && a[0] - m <= b[2] && b[0] - m <= a[2] && a[1] - m <= b[3] && b[1] - m <= a[3]
