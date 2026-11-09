// Pasadas de amigos: una pasada tuya (un tramo, una vuelta) empaquetada para que otra persona la compare
// con las suyas en su Blackbox, metro a metro, como si fuera una salida más. Lleva el trazado y los
// canales a 10 Hz de ese trozo con unos segundos de margen, no la salida entera ni dónde empezaste.
import { DT } from './process.js'
import { makePath, findPasses } from './align.js'

export const GHOST_VERSION = 1
const MARGIN = Math.round(5 / DT) // muestras de margen antes y después de la pasada
const CH = ['lat', 'lon', 'd', 'v', 'lean', 'gLong', 'gLat', 'hdg']
export const MAX_GHOST_S = 15 * 60 // una pasada de amigo, como mucho 15 min

function toBase64(u8) {
  if (typeof u8.toBase64 === 'function') return u8.toBase64()
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s)
}
function fromBase64(b64) {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(b64)
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
}

/**
 * Empaqueta la pasada `pass` de la salida A por el trazado `points` ([lat, lon]).
 * @param {{name?: string, rider?: string, bike?: string}} info
 */
export function packGhost(A, pass, points, info = {}) {
  if (pass.time > MAX_GHOST_S) throw new Error('Pasada demasiado larga para compartir (máximo 15 min)')
  const i0 = Math.max(0, pass.i0 - MARGIN)
  const i1 = Math.min(A.n - 1, pass.i1 + MARGIN)
  const n = i1 - i0 + 1
  let k0 = i0
  while (k0 <= i1 && !A.valid[k0]) k0++
  const lat0 = A.lat[k0]
  const lon0 = A.lon[k0]
  // Posición como diferencia con el primer punto: en float32 queda al milímetro
  const f = new Float32Array(n * CH.length)
  for (let j = 0; j < n; j++) {
    const i = i0 + j
    const ok = A.valid[i]
    const row = [A.lat[i] - lat0, A.lon[i] - lon0, A.d[i] - A.d[i0], A.v[i], A.lean[i], A.gLong[i], A.gLat[i], A.hdg[i]]
    for (let c = 0; c < CH.length; c++) f[j * CH.length + c] = ok ? row[c] : NaN
  }
  const r6 = (x) => Math.round(x * 1e6) / 1e6
  return {
    v: GHOST_VERSION,
    name: String(info.name || '').slice(0, 60),
    rider: String(info.rider || '').slice(0, 30),
    bike: String(info.bike || '').slice(0, 30),
    riddenAt: new Date(A.meta.start + pass.t0 * 1000).toISOString(),
    time: Math.round(pass.time * 1000) / 1000,
    length: Math.round(makePath(points).length),
    points: points.map(([la, lo]) => [r6(la), r6(lo)]),
    // La pasada empieza t0 s después de la primera muestra
    t0: Math.round((pass.t0 - A.t[i0]) * 1000) / 1000,
    lat0,
    lon0,
    n,
    ch: CH,
    data: toBase64(new Uint8Array(f.buffer)),
  }
}

/**
 * Deshace el paquete: un análisis con lo justo para compararlo (los mismos canales que una salida) y su
 * pasada por el trazado. `B.ghost` lleva quién es y cuándo fue.
 */
export function unpackGhost(g) {
  if (!g || g.v !== GHOST_VERSION || !Array.isArray(g.points) || g.points.length < 2) throw new Error('Pasada de amigo no válida')
  const u8 = fromBase64(g.data)
  const f = new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4)
  const w = g.ch.length
  const n = Math.min(g.n, Math.floor(f.length / w))
  const B = { n, T0: 0, t: new Float64Array(n), valid: new Uint8Array(n), seg: new Int32Array(n), corners: [], brakes: [], runs: [], events: [] }
  for (const c of g.ch) B[c] = c === 'lat' || c === 'lon' || c === 'd' ? new Float64Array(n).fill(NaN) : new Float32Array(n).fill(NaN)
  for (let j = 0; j < n; j++) {
    B.t[j] = j * DT
    for (let c = 0; c < w; c++) B[g.ch[c]][j] = f[j * w + c]
    B.valid[j] = Number.isFinite(B.lat[j]) && Number.isFinite(B.lon[j]) ? 1 : 0
    if (B.valid[j]) (B.lat[j] += g.lat0), (B.lon[j] += g.lon0)
  }
  // Para que las fechas salgan bien: la «salida» empieza t0 s antes de la pasada
  B.meta = { id: `ghost-${g.riddenAt}`, start: Date.parse(g.riddenAt) - g.t0 * 1000, source: 'ghost', rider: { bike: g.bike } }
  B.ghost = { name: g.name, rider: g.rider, bike: g.bike, riddenAt: g.riddenAt, time: g.time, length: g.length }
  const P = makePath(g.points)
  const passes = findPasses(P, B)
  // La suya (la más parecida al tiempo que dice el paquete)
  const pass = passes.sort((a, b) => Math.abs(a.time - g.time) - Math.abs(b.time - g.time))[0] || null
  return { B, P, pass, points: g.points }
}
