// Vídeo de GoPro: desde la HERO5, las GoPro graban su GPS dentro del propio MP4, en una pista de
// metadatos «gpmd» con formato GPMF (github.com/gopro/gpmf-parser). Con eso se sabe, en cada momento
// del vídeo, la hora UTC y dónde estaba la cámara, y el vídeo se sincroniza solo con la salida.
//
// Se lee sin cargar el vídeo entero (pueden ser 4 GB): primero las cabeceras de las cajas del MP4,
// luego la caja «moov» (el índice) y por último solo los trocitos de metadatos (unos KB por segundo).
//
// También vale para vídeos de otras cámaras o del móvil: sin GPMF se usa la hora de grabación del
// archivo (si la tiene) y se ajusta a mano.
import { DT } from './process.js'

const MAC_EPOCH = Date.UTC(1904, 0, 1) // los MP4 cuentan desde 1904
const Y2000 = Date.UTC(2000, 0, 1)

/** Lector de un archivo (File/Blob) por trozos. */
export const fileReader = (blob) => ({ size: blob.size, read: async (o, n) => new Uint8Array(await blob.slice(o, o + n).arrayBuffer()) })
/** Lector de un buffer en memoria (pruebas). */
export const bufferReader = (u8) => ({ size: u8.length, read: async (o, n) => u8.subarray(o, Math.min(u8.length, o + n)) })

const fourcc = (u8, p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3])
const dvOf = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength)

/** Cajas de primer nivel del archivo: [{ type, start, hdr, size }] (solo lee las cabeceras). */
async function topBoxes(R) {
  const out = []
  let pos = 0
  while (pos + 8 <= R.size && out.length < 10000) {
    const h = await R.read(pos, 16)
    const dv = dvOf(h)
    let size = dv.getUint32(0)
    const type = fourcc(h, 4)
    let hdr = 8
    if (size === 1) {
      size = dv.getUint32(8) * 2 ** 32 + dv.getUint32(12)
      hdr = 16
    } else if (size === 0) size = R.size - pos
    if (size < hdr) break
    out.push({ type, start: pos, hdr, size })
    pos += size
  }
  return out
}

/** Cajas hijas dentro de u8[from, to). */
function children(u8, from, to) {
  const dv = dvOf(u8)
  const out = []
  let p = from
  while (p + 8 <= to) {
    let size = dv.getUint32(p)
    let hdr = 8
    if (size === 1) {
      size = dv.getUint32(p + 8) * 2 ** 32 + dv.getUint32(p + 12)
      hdr = 16
    } else if (size === 0) size = to - p
    if (size < hdr || p + size > to) break
    out.push({ type: fourcc(u8, p + 4), start: p, body: p + hdr, end: p + size })
    p += size
  }
  return out
}
const child = (u8, box, type) => children(u8, box.body, box.end).find((b) => b.type === type)
function path(u8, box, ...types) {
  let b = box
  for (const t of types) {
    b = b && child(u8, b, t)
    if (!b) return null
  }
  return b
}

/** Hora (ms) y duración (s) de mvhd/mdhd: [creación, timescale, duración]. */
function timeBox(u8, b) {
  const dv = dvOf(u8)
  const v = u8[b.body]
  if (v === 1) {
    const created = dv.getUint32(b.body + 4) * 2 ** 32 + dv.getUint32(b.body + 8)
    const scale = dv.getUint32(b.body + 20)
    const dur = dv.getUint32(b.body + 24) * 2 ** 32 + dv.getUint32(b.body + 28)
    return [created, scale, dur]
  }
  return [dv.getUint32(b.body + 4), dv.getUint32(b.body + 12), dv.getUint32(b.body + 16)]
}

/** Muestras de una pista: [{ offset, size, time, dur }] con time y dur en segundos. */
function sampleTable(u8, stbl, scale) {
  const dv = dvOf(u8)
  const box = (t) => child(u8, stbl, t)
  const stsz = box('stsz')
  const stco = box('stco') || box('co64')
  const stsc = box('stsc')
  const stts = box('stts')
  if (!stsz || !stco || !stsc || !stts) return []
  const fixed = dv.getUint32(stsz.body + 4)
  const n = dv.getUint32(stsz.body + 8)
  const sizes = Array.from({ length: n }, (_, i) => (fixed ? fixed : dv.getUint32(stsz.body + 12 + 4 * i)))
  const nCh = dv.getUint32(stco.body + 4)
  const big = stco.type === 'co64'
  const chunk = Array.from({ length: nCh }, (_, i) => (big ? dv.getUint32(stco.body + 8 + 8 * i) * 2 ** 32 + dv.getUint32(stco.body + 12 + 8 * i) : dv.getUint32(stco.body + 8 + 4 * i)))
  const nSc = dv.getUint32(stsc.body + 4)
  const sc = Array.from({ length: nSc }, (_, i) => [dv.getUint32(stsc.body + 8 + 12 * i), dv.getUint32(stsc.body + 12 + 12 * i)])
  const out = []
  let s = 0
  for (let c = 0; c < nCh && s < n; c++) {
    // Muestras de este trozo: la última entrada de stsc que empieza en este trozo o antes
    let per = 1
    for (const [first, k] of sc) if (first - 1 <= c) per = k
    let off = chunk[c]
    for (let j = 0; j < per && s < n; j++, s++) {
      out.push({ offset: off, size: sizes[s], time: 0, dur: 0 })
      off += sizes[s]
    }
  }
  const nTs = dv.getUint32(stts.body + 4)
  let t = 0
  let q = 0
  for (let i = 0; i < nTs; i++) {
    const count = dv.getUint32(stts.body + 8 + 8 * i)
    const delta = dv.getUint32(stts.body + 12 + 8 * i)
    for (let j = 0; j < count && q < out.length; j++, q++) {
      out[q].time = t / scale
      out[q].dur = delta / scale
      t += delta
    }
  }
  return out
}

// ---------- GPMF ----------

const SIZES = { b: 1, B: 1, c: 1, s: 2, S: 2, l: 4, L: 4, f: 4, q: 4, d: 8, j: 8, J: 8, Q: 8, F: 4 }
function num(dv, p, t) {
  switch (t) {
    case 'b':
      return dv.getInt8(p)
    case 'B':
    case 'c':
      return dv.getUint8(p)
    case 's':
      return dv.getInt16(p)
    case 'S':
      return dv.getUint16(p)
    case 'l':
      return dv.getInt32(p)
    case 'L':
    case 'F':
      return dv.getUint32(p)
    case 'f':
      return dv.getFloat32(p)
    case 'd':
      return dv.getFloat64(p)
    case 'q':
      return dv.getInt32(p) / 65536
    case 'j':
      return Number(dv.getBigInt64(p))
    case 'J':
      return Number(dv.getBigUint64(p))
    case 'Q':
      return dv.getInt32(p) + dv.getUint32(p + 4) / 2 ** 32
    default:
      return NaN
  }
}

/** «yymmddhhmmss.sss» (UTC) → ms desde 1970. */
export function parseGpsu(s) {
  const m = /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d(?:\.\d+)?)/.exec(String(s).trim())
  if (!m) return NaN
  const sec = Number(m[6])
  return Date.UTC(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Math.floor(sec), Math.round((sec % 1) * 1000))
}

/**
 * Lee un trozo GPMF (una muestra de la pista de metadatos) y devuelve lo del GPS que traiga:
 * [{ kind: 'GPS5'|'GPS9', rows: number[][], utc, fix, dop }].
 */
export function parseGpmf(u8) {
  const dv = dvOf(u8)
  const found = []
  function walk(from, to, st) {
    let p = from
    while (p + 8 <= to) {
      const key = fourcc(u8, p)
      const type = String.fromCharCode(u8[p + 4])
      const size = u8[p + 5]
      const rep = dv.getUint16(p + 6)
      const len = size * rep
      const body = p + 8
      const next = body + ((len + 3) & ~3)
      if (key === '\0\0\0\0' || next > to + 3) break
      if (u8[p + 4] === 0) {
        // Anidado: cada STRM tiene su escala y su tipo
        walk(body, Math.min(to, body + len), key === 'STRM' ? {} : st)
      } else if (key === 'SCAL') {
        const w = SIZES[type] || 4
        st.scal = Array.from({ length: (len / w) | 0 }, (_, i) => num(dv, body + i * w, type))
      } else if (key === 'TYPE') {
        st.type = String.fromCharCode(...u8.subarray(body, body + len)).replace(/\0+$/, '')
      } else if (key === 'GPSU') {
        st.utc = parseGpsu(String.fromCharCode(...u8.subarray(body, body + Math.min(len, 16))))
      } else if (key === 'GPSF') {
        st.fix = num(dv, body, type)
      } else if (key === 'GPSP') {
        st.dop = num(dv, body, type) / 100
      } else if (key === 'GPS5' || key === 'GPS9') {
        // GPS5: 5 × int32 (lat, lon, alt, vel. 2D, vel. 3D). GPS9 (HERO11+): tipo compuesto con fecha y hora en cada fila
        const types = key === 'GPS5' ? 'lllll' : type === '?' ? st.type || 'lllllllSS' : type.repeat(size / (SIZES[type] || 4))
        const scal = st.scal || []
        const rows = []
        for (let r = 0; r < rep; r++) {
          let q = body + r * size
          const row = []
          for (let c = 0; c < types.length; c++) {
            const t = types[c]
            const raw = num(dv, q, t)
            const sc = scal.length > 1 ? scal[c] : scal[0]
            row.push(sc ? raw / sc : raw)
            q += SIZES[t] || 4
          }
          rows.push(row)
        }
        found.push({ kind: key, rows, utc: st.utc, fix: st.fix, dop: st.dop })
      }
      p = next
    }
  }
  walk(0, u8.length, {})
  return found
}

/**
 * Lee un vídeo: duración, hora de grabación según la cámara y, si es de GoPro, su GPS.
 * @returns {Promise<{ dur: number, created: number, points: {vt, utc, lat, lon, alt, v}[], gpmf: boolean, gpsSamples: number }>}
 */
export async function readVideo(R, onProgress) {
  const top = await topBoxes(R)
  const mv = top.find((b) => b.type === 'moov')
  if (!mv) throw new Error('No parece un vídeo MP4 o MOV')
  if (mv.size > 200 * 1024 * 1024) throw new Error('Índice del vídeo demasiado grande')
  const u8 = await R.read(mv.start, mv.size)
  const moov = { type: 'moov', start: 0, body: mv.hdr, end: mv.size }
  const mvhd = child(u8, moov, 'mvhd')
  let dur = 0
  let created = NaN
  if (mvhd) {
    const [c, scale, d] = timeBox(u8, mvhd)
    dur = scale ? d / scale : 0
    // Muchas cámaras ponen 0 o una fecha absurda si no tienen hora
    const ms = MAC_EPOCH + c * 1000
    if (c > 0 && ms > Date.UTC(2010, 0, 1)) created = ms
  }
  let meta = null
  for (const trak of children(u8, moov.body, moov.end).filter((b) => b.type === 'trak')) {
    const mdia = child(u8, trak, 'mdia')
    const stsd = path(u8, mdia, 'minf', 'stbl', 'stsd')
    if (!stsd) continue
    // stsd: versión (4) + número de entradas (4) + la primera: tamaño (4) y formato (4)
    if (fourcc(u8, stsd.body + 12) === 'gpmd') {
      const [, scale] = timeBox(u8, child(u8, mdia, 'mdhd'))
      meta = sampleTable(u8, path(u8, mdia, 'minf', 'stbl'), scale || 1000)
    }
  }
  const points = []
  if (meta?.length) {
    // Los trozos de metadatos están repartidos por el archivo: se leen de 24 en 24
    for (let i = 0; i < meta.length; i += 24) {
      const batch = meta.slice(i, i + 24)
      const bufs = await Promise.all(batch.map((s) => R.read(s.offset, s.size)))
      batch.forEach((s, j) => {
        let gps
        try {
          gps = parseGpmf(bufs[j])
        } catch {
          return
        }
        // Las HERO11 y HERO13 graban GPS5 y GPS9 a la vez: vale GPS9, que trae la hora de cada fila
        const has9 = gps.some((g) => g.kind === 'GPS9')
        for (const g of gps) {
          if (has9 && g.kind === 'GPS5') continue
          if (g.fix != null && g.fix < 2) continue // sin cobertura: posiciones viejas o a cero
          if (g.dop > 10) continue
          const n = g.rows.length
          g.rows.forEach((r, k) => {
            if (!r[0] && !r[1]) return
            const vt = s.time + (k / n) * s.dur
            // GPS9 trae la hora en cada fila (días desde 2000 y segundos del día); GPS5, una por trozo
            const utc = g.kind === 'GPS9' && r.length >= 7 && r[5] > 0 ? Y2000 + r[5] * 86400000 + r[6] * 1000 : Number.isFinite(g.utc) ? g.utc + (k / n) * s.dur * 1000 : NaN
            if (g.kind === 'GPS9' && r.length >= 9 && r[8] < 2) return
            points.push({ vt, utc, lat: r[0], lon: r[1], alt: r[2], v: r[3] })
          })
        }
      })
      onProgress?.(Math.min(1, (i + 24) / meta.length))
    }
  }
  return { dur, created, points, gpmf: !!meta?.length, gpsSamples: points.length }
}

// ---------- Sincronizar con la salida ----------

const R_EARTH = 6371008.8
const RAD = Math.PI / 180

/** Posición y velocidad de la salida en el instante t (s de sesión), interpolando entre muestras. */
function at(A, t) {
  const f = (t - A.T0) / DT
  const i = Math.floor(f)
  if (i < 0 || i + 1 >= A.n || !A.valid[i] || !A.valid[i + 1]) return null
  const u = f - i
  return { lat: A.lat[i] + (A.lat[i + 1] - A.lat[i]) * u, lon: A.lon[i] + (A.lon[i + 1] - A.lon[i]) * u, v: A.v[i] + (A.v[i + 1] - A.v[i]) * u }
}

/** Cuánto se parecen el GPS del vídeo y la salida con un desfase dado (menos es mejor). */
function cost(A, pts, off) {
  const ky = R_EARTH * RAD
  let s = 0
  let c = 0
  const dsum = []
  for (const p of pts) {
    const q = at(A, p.vt + off)
    if (!q) continue
    const kx = Math.cos(p.lat * RAD) * ky
    const d = Math.hypot((p.lat - q.lat) * ky, (p.lon - q.lon) * kx)
    // Una diferencia de 1 m/s pesa como 3 m de posición
    const dv = Number.isFinite(p.v) ? (p.v - q.v) * 3 : 0
    s += Math.min(d * d + dv * dv, 2500)
    dsum.push(d)
    c++
  }
  if (c < 5) return { cost: Infinity, n: c, err: Infinity }
  dsum.sort((a, b) => a - b)
  return { cost: s / c, n: c, err: dsum[dsum.length >> 1] }
}

/**
 * Desfase entre el vídeo y la salida: tiempo de la salida = tiempo del vídeo + off.
 * Con GPS en el vídeo: primero por la hora UTC y luego afinando con la posición y la velocidad (a la
 * décima). Sin hora UTC, buscando en toda la salida dónde encaja. Sin GPS, la hora de grabación.
 * @returns {{ off: number, how: 'gps'|'utc'|'clock'|'none', err?: number, overlap?: number }}
 */
export function syncOffset(A, video) {
  const start = A.meta?.start
  const all = video.points || []
  // Para buscar basta con unos cientos de puntos repartidos
  const step = Math.max(1, Math.floor(all.length / 400))
  const pts = all.filter((_, k) => k % step === 0)
  const tEnd = A.t[A.n - 1]
  if (pts.length >= 10) {
    const withUtc = pts.filter((p) => Number.isFinite(p.utc))
    let guess = null
    if (withUtc.length >= 5 && Number.isFinite(start)) {
      const offs = withUtc.map((p) => (p.utc - start) / 1000 - p.vt).sort((a, b) => a - b)
      guess = offs[offs.length >> 1]
    }
    let lo
    let hi
    let coarse = 0.1
    if (guess != null) (lo = guess - 6), (hi = guess + 6)
    else {
      // Sin hora: de segundo en segundo por toda la salida, y luego fino
      lo = A.T0 - pts.at(-1).vt
      hi = tEnd - pts[0].vt
      coarse = 1
    }
    let best = { off: guess ?? 0, cost: Infinity, err: Infinity, n: 0 }
    const scan = (a, b, d) => {
      for (let off = a; off <= b + 1e-9; off += d) {
        const c = cost(A, pts, off)
        if (c.cost < best.cost) best = { off, ...c }
      }
    }
    scan(lo, hi, coarse)
    if (coarse > 0.1) scan(best.off - 1.5, best.off + 1.5, 0.1)
    // Afinado entre las décimas vecinas (parábola)
    const c0 = cost(A, pts, best.off - 0.1).cost
    const c2 = cost(A, pts, best.off + 0.1).cost
    const den = c0 - 2 * best.cost + c2
    if (Number.isFinite(den) && den > 1e-9) best.off += Math.max(-0.1, Math.min(0.1, (0.1 * (c0 - c2)) / (2 * den)))
    const overlap = best.n * step * (all.length > 1 ? (all.at(-1).vt - all[0].vt) / all.length : 0)
    // Encaja si la cámara y la salida van por el mismo sitio (mediana a menos de 25 m)
    if (best.err < 25) return { off: best.off, how: 'gps', err: best.err, overlap }
    if (guess != null) return { off: guess, how: 'utc', err: best.err, overlap }
  }
  if (Number.isFinite(video.created) && Number.isFinite(start)) {
    const off = (video.created - start) / 1000
    if (off > -video.dur && off < tEnd) return { off, how: 'clock' }
  }
  return { off: 0, how: 'none' }
}

/** Horas UTC (ms) que cubre el vídeo, si se saben: [desde, hasta] o null. */
export function videoSpan(video) {
  const p = (video.points || []).filter((x) => Number.isFinite(x.utc))
  if (p.length >= 2) {
    const off = p[p.length >> 1].utc - p[p.length >> 1].vt * 1000
    return [off, off + video.dur * 1000]
  }
  if (Number.isFinite(video.created)) return [video.created, video.created + video.dur * 1000]
  return null
}
