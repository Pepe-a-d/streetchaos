// Banco de potencia virtual: en cada tirón a fondo, la fuerza que empuja la moto (masa × aceleración
// + aire + rodadura) por la velocidad da la potencia que llega a la rueda. Es una estimación: depende
// de la masa y de la aerodinámica que pongas, pero sirve para comparar antes y después de un cambio.
import { G, DT } from './process.js'

export const DYNO = { bike: 190, rider: 80, cda: 0.35, crr: 0.02, rho: 1.2, slope: false }
export const CDA_PRESETS = [
  ['TUMBADO', 0.3],
  ['DEPORTIVA', 0.35],
  ['NAKED', 0.45],
  ['TRAIL', 0.55],
]
const INERTIA = 1.04 // ruedas, transmisión y motor girando: ~4 % más de masa aparente

/** Tirones: al menos 2,5 s acelerando (≥ 0,12 g, con huecos de cambio de marcha) y +25 km/h. */
export function findPulls(A, i0 = 0, i1 = A.n - 1, { g = 0.12, minDur = 2.5, minDv = 7 } = {}) {
  const out = []
  let i = i0
  while (i <= i1) {
    if (!(A.valid[i] && A.gLong[i] >= g && A.v[i] > 2)) {
      i++
      continue
    }
    const a = i
    let b = i
    let dip = 0
    while (b + 1 <= i1 && A.valid[b + 1]) {
      if (A.gLong[b + 1] >= g * 0.35) {
        dip = 0
        b++
      } else if ((dip += DT) <= 0.5) b++
      else break
    }
    while (b > a && A.gLong[b] < g * 0.35) b--
    if ((b - a) * DT >= minDur && A.v[b] - A.v[a] >= minDv) out.push({ i0: a, i1: b, v0: A.v[a], v1: A.v[b] })
    i = b + 1
  }
  return out
}

/** Pendiente (tanto por uno) alrededor de i, de la altitud en ±3 s. */
function grade(A, i) {
  const a = Math.max(0, i - 30)
  const b = Math.min(A.n - 1, i + 30)
  const dd = A.d[b] - A.d[a]
  return dd > 20 && Number.isFinite(A.alt[a]) && Number.isFinite(A.alt[b]) ? Math.max(-0.15, Math.min(0.15, (A.alt[b] - A.alt[a]) / dd)) : 0
}

/** Potencia en rueda (W) en la muestra i. */
export function powerAt(A, i, o) {
  const m = o.bike + o.rider
  const v = A.v[i]
  const F = m * A.gLong[i] * G * INERTIA + 0.5 * o.rho * o.cda * v * v + o.crr * m * G + (o.slope ? m * G * grade(A, i) : 0)
  return F * v
}

/** Curva de un tirón: la media en cada tramo de `bin` km/h, suavizada con sus vecinos (la máxima
 *  se quedaría con el ruido). { kmh: [], cv: [], peak: {cv, kmh} } */
export function pullCurve(A, pull, o, bin = 2) {
  const map = new Map()
  for (let i = pull.i0; i <= pull.i1; i++) {
    if (!A.valid[i]) continue
    const k = Math.round((A.v[i] * 3.6) / bin)
    const e = map.get(k) || [0, 0]
    e[0] += powerAt(A, i, o) / 735.5
    e[1]++
    map.set(k, e)
  }
  // Rejilla continua: acelerando fuerte, entre dos muestras se saltan tramos de velocidad; se rellenan
  const have = [...map.keys()].sort((a, b) => a - b)
  const ks = []
  const raw = []
  for (let j = 0; j < have.length; j++) {
    const k = have[j]
    const v = map.get(k)[0] / map.get(k)[1]
    if (j) {
      const pk = have[j - 1]
      const pv = raw.at(-1)
      for (let q = pk + 1; q < k; q++) (ks.push(q), raw.push(pv + ((v - pv) * (q - pk)) / (k - pk)))
    }
    ks.push(k)
    raw.push(v)
  }
  const kmh = ks.map((k) => k * bin)
  const cv = raw.map((_, j) => {
    const w = raw.slice(Math.max(0, j - 1), j + 2)
    return w.reduce((s, x) => s + x, 0) / w.length
  })
  let p = 0
  for (let j = 1; j < cv.length; j++) if (cv[j] > cv[p]) p = j
  return { kmh, cv, peak: { cv: cv[p] ?? 0, kmh: kmh[p] ?? 0 } }
}

/** Envolvente de varias curvas (lo máximo a cada velocidad). */
export function envelope(curves) {
  const map = new Map()
  for (const c of curves) c.kmh.forEach((k, j) => map.set(k, Math.max(map.get(k) ?? 0, c.cv[j])))
  const kmh = [...map.keys()].sort((a, b) => a - b)
  return { kmh, cv: kmh.map((k) => map.get(k)) }
}
