// Vídeo de GoPro: leer el GPS que lleva dentro (GPMF) y sincronizarlo solo con la salida.
import { describe, it, expect } from 'vitest'
import { synthRide } from '../src/blackbox/synth.js'
import { analyze } from '../src/blackbox/process.js'
import { readVideo, bufferReader, parseGpmf, parseGpsu, syncOffset, videoSpan } from '../src/blackbox/gpmf.js'

const RAD = Math.PI / 180
const O = [43.37, -8.4]
const kx = Math.cos(O[0] * RAD) * 6371008.8 * RAD
const ky = 6371008.8 * RAD

function road() {
  const pts = [[0, 0]]
  let x = 0
  let y = 0
  let h = 0
  const go = (len) => {
    for (let s = 0; s < len; s += 4) pts.push([(x += 4 * Math.sin(h)), (y += 4 * Math.cos(h))])
  }
  const turn = (r, deg) => {
    const n = Math.ceil((Math.abs(deg) * RAD * r) / 4)
    for (let k = 0; k < n; k++) {
      h += (deg * RAD) / n
      pts.push([(x += ((Math.abs(deg) * RAD * r) / n) * Math.sin(h)), (y += ((Math.abs(deg) * RAD * r) / n) * Math.cos(h))])
    }
  }
  go(300)
  turn(60, 90)
  go(250)
  turn(40, -120)
  go(300)
  turn(80, 70)
  go(400)
  return pts.map(([x, y]) => [O[0] + y / ky, O[1] + x / kx])
}

// ---------- Un MP4 de mentira con su pista GPMF, como los de las GoPro ----------
const enc = new TextEncoder()
function cat(...parts) {
  const n = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) (out.set(p, o), (o += p.length))
  return out
}
const u32 = (...v) => {
  const b = new Uint8Array(4 * v.length)
  const dv = new DataView(b.buffer)
  v.forEach((x, i) => dv.setUint32(4 * i, x >>> 0))
  return b
}
const box = (type, ...parts) => {
  const body = cat(...parts)
  return cat(u32(8 + body.length), enc.encode(type), body)
}
/** Un KLV de GPMF: clave, tipo, tamaño, repeticiones y datos rellenos a 4 bytes. */
function klv(key, type, size, rep, data) {
  const h = new Uint8Array(8)
  h.set(enc.encode(key))
  h[4] = type ? type.charCodeAt(0) : 0
  h[5] = size
  new DataView(h.buffer).setUint16(6, rep)
  const pad = new Uint8Array((4 - (data.length % 4)) % 4)
  return cat(h, data, pad)
}
const i32 = (...v) => {
  const b = new Uint8Array(4 * v.length)
  const dv = new DataView(b.buffer)
  v.forEach((x, i) => dv.setInt32(4 * i, Math.round(x)))
  return b
}
const u16 = (...v) => {
  const b = new Uint8Array(2 * v.length)
  const dv = new DataView(b.buffer)
  v.forEach((x, i) => dv.setUint16(2 * i, Math.round(x)))
  return b
}
const gpsu = (ms) => {
  const d = new Date(ms)
  const p = (x, n = 2) => String(x).padStart(n, '0')
  return enc.encode(`${p(d.getUTCFullYear() - 2000)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`)
}

/** Muestra GPMF de 1 s con 18 fixes (GPS5) o 10 (GPS9). */
function sample(rows, utc, kind) {
  const strm =
    kind === 'GPS9'
      ? cat(
          klv('TYPE', 'c', 1, 9, enc.encode('lllllllSS')),
          klv('SCAL', 'l', 4, 9, i32(1e7, 1e7, 1000, 1000, 100, 1, 1000, 100, 1)),
          klv(
            'GPS9',
            '?',
            32,
            rows.length,
            cat(...rows.map((r) => cat(i32(r.lat * 1e7, r.lon * 1e7, r.alt * 1000, r.v * 1000, r.v * 100, Math.floor((r.utc - Date.UTC(2000, 0, 1)) / 86400000), ((r.utc - Date.UTC(2000, 0, 1)) % 86400000) / 1000 * 1000), u16(120, 3)))),
          ),
        )
      : cat(
          klv('SCAL', 'l', 4, 5, i32(1e7, 1e7, 1000, 1000, 100)),
          klv('GPSF', 'L', 4, 1, u32(3)),
          ...(utc == null ? [] : [klv('GPSU', 'U', 16, 1, gpsu(utc))]),
          klv('GPSP', 'S', 2, 1, u16(140)),
          klv('GPS5', 'l', 20, rows.length, cat(...rows.map((r) => i32(r.lat * 1e7, r.lon * 1e7, r.alt * 1000, r.v * 1000, r.v * 100)))),
        )
  // Antes del GPS, una corriente de acelerómetro como en las de verdad (hay que saltarla)
  const s1 = cat(klv('STNM', 'c', 1, 5, enc.encode('Accel')), klv('ACCL', 's', 6, 4, new Uint8Array(24)))
  const strmA = klv('STRM', null, 1, s1.length, s1)
  const strmG = klv('STRM', null, 1, strm.length, strm)
  const inner = cat(klv('DVID', 'L', 4, 1, u32(1)), strmA, strmG)
  return klv('DEVC', null, 1, inner.length, inner)
}

/** MP4 con una pista «gpmd» de muestras de 1 s; moov al final, como hacen muchas cámaras. */
function mp4(samples, { created = 0, dur = samples.length } = {}) {
  const ftyp = box('ftyp', enc.encode('mp41'), u32(0), enc.encode('mp41'))
  const filler = new Uint8Array(37) // vídeo «de mentira» entre medias
  const parts = []
  const offsets = []
  let pos = ftyp.length + 8
  for (const s of samples) {
    parts.push(filler)
    pos += filler.length
    offsets.push(pos)
    parts.push(s)
    pos += s.length
  }
  const mdat = box('mdat', ...parts)
  const mvhd = box('mvhd', u32(0, created, created, 1000, dur * 1000), new Uint8Array(80))
  const mdhd = box('mdhd', u32(0, 0, 0, 1000, dur * 1000), u16(0, 0))
  const hdlr = box('hdlr', u32(0, 0), enc.encode('meta'), u32(0, 0, 0), enc.encode('GoPro MET\0'))
  const stsd = box('stsd', u32(0, 1), u32(16), enc.encode('gpmd'), new Uint8Array(6), u16(1))
  const stts = box('stts', u32(0, 1, samples.length, 1000))
  const stsc = box('stsc', u32(0, 1, 1, 1, 1))
  const stsz = box('stsz', u32(0, 0, samples.length, ...samples.map((s) => s.length)))
  const stco = box('stco', u32(0, samples.length, ...offsets))
  const trak = box('trak', box('mdia', mdhd, hdlr, box('minf', box('stbl', stsd, stts, stsc, stsz, stco))))
  return cat(ftyp, mdat, box('moov', mvhd, trak))
}

/** Lo que vería una GoPro grabando desde el segundo `t0` de la salida, `dur` segundos. */
function cameraOf(A, t0, dur, hz = 18, noise = 2) {
  const rows = []
  for (let s = 0; s < dur; s++) {
    const r = []
    for (let k = 0; k < hz; k++) {
      const t = t0 + s + k / hz
      const i = Math.round((t - A.T0) / 0.1)
      if (i < 0 || i >= A.n || !A.valid[i]) continue
      const e = Math.sin(t * 1.7) * noise
      r.push({ lat: A.lat[i] + e / ky, lon: A.lon[i] + e / kx, alt: 30, v: A.v[i], utc: A.meta.start + t * 1000 })
    }
    rows.push(r)
  }
  return rows
}

describe('GPMF', () => {
  it('lee la hora GPSU', () => {
    expect(parseGpsu('261109093012.345')).toBe(Date.UTC(2026, 10, 9, 9, 30, 12, 345))
    expect(parseGpsu('basura')).toBeNaN()
  })

  it('saca el GPS5 de una muestra con su escala, saltándose otras corrientes', () => {
    const s = sample([{ lat: 43.37, lon: -8.4, alt: 12.5, v: 20 }], Date.UTC(2026, 10, 9), 'GPS5')
    const g = parseGpmf(s)
    expect(g).toHaveLength(1)
    expect(g[0].kind).toBe('GPS5')
    expect(g[0].rows[0][0]).toBeCloseTo(43.37, 6)
    expect(g[0].rows[0][1]).toBeCloseTo(-8.4, 6)
    expect(g[0].rows[0][2]).toBeCloseTo(12.5, 3)
    expect(g[0].rows[0][3]).toBeCloseTo(20, 3)
    expect(g[0].fix).toBe(3)
    expect(g[0].dop).toBeCloseTo(1.4)
    expect(g[0].utc).toBe(Date.UTC(2026, 10, 9))
  })
})

describe('Vídeo sincronizado', () => {
  const ride = synthRide({ path: road(), drag: false })
  const A = analyze(ride)

  it('lee el MP4 por trozos y sincroniza por la hora UTC y la posición (GPS5, HERO5-10)', async () => {
    const T0 = 23.4 // el vídeo empieza en este segundo de la salida
    const cam = cameraOf(A, T0, 60)
    // La hora GPSU de cada trozo llega con algo de error (en las de verdad, hasta ~0,5 s)
    const file = mp4(cam.map((rows, s) => sample(rows, A.meta.start + (T0 + s + 0.35) * 1000, 'GPS5')))
    const v = await readVideo(bufferReader(file))
    expect(v.gpmf).toBe(true)
    expect(v.dur).toBeCloseTo(60)
    expect(v.points.length).toBeGreaterThan(900)
    const r = syncOffset(A, v)
    expect(r.how).toBe('gps')
    expect(Math.abs(r.off - T0)).toBeLessThan(0.15)
    expect(r.err).toBeLessThan(10)
    const span = videoSpan(v)
    expect(Math.abs(span[0] - (A.meta.start + T0 * 1000))).toBeLessThan(800)
  })

  it('sin hora UTC busca en toda la salida dónde encaja', async () => {
    const T0 = 71.0
    const cam = cameraOf(A, T0, 40)
    const v = await readVideo(bufferReader(mp4(cam.map((rows) => sample(rows, null, 'GPS5')))))
    const r = syncOffset(A, v)
    expect(r.how).toBe('gps')
    expect(Math.abs(r.off - T0)).toBeLessThan(0.15)
  })

  it('GPS9 (HERO11 en adelante) trae la hora en cada fila', async () => {
    const T0 = 40.2
    const cam = cameraOf(A, T0, 30, 10)
    const v = await readVideo(bufferReader(mp4(cam.map((rows) => sample(rows, null, 'GPS9')))))
    expect(v.points.length).toBeGreaterThan(250)
    expect(v.points.every((p) => Number.isFinite(p.utc))).toBe(true)
    const r = syncOffset(A, v)
    expect(r.how).toBe('gps')
    expect(Math.abs(r.off - T0)).toBeLessThan(0.15)
  })

  it('un vídeo sin GPS usa la hora de grabación del archivo', async () => {
    const created = Math.round((A.meta.start - Date.UTC(1904, 0, 1)) / 1000) + 30
    const v = await readVideo(bufferReader(mp4([new Uint8Array(0)], { created, dur: 20 })))
    expect(v.gpmf).toBe(true)
    expect(v.points).toHaveLength(0)
    const r = syncOffset(A, v)
    expect(r.how).toBe('clock')
    expect(r.off).toBeCloseTo(30, 0)
  })

  it('un archivo que no es MP4 da un error claro', async () => {
    await expect(readVideo(bufferReader(enc.encode('hola, esto no es un vídeo')))).rejects.toThrow(/MP4/)
  })
})

// ---------- Pasadas de amigos ----------
import { packGhost, unpackGhost } from '../src/blackbox/ghost.js'
import { makePath, findPasses, pathPoints, compare } from '../src/blackbox/align.js'

describe('Pasada de un amigo', () => {
  const mine = analyze(synthRide({ path: road(), drag: false, vRoad: 22, seed: 3 }))
  const friend = analyze(synthRide({ path: road(), drag: false, vRoad: 26, seed: 9, start: Date.UTC(2026, 10, 1, 17, 5) }))
  // El tramo: de los 200 m a los 1300 m de mi salida
  const i0 = mine.d.findIndex((d) => d > 200)
  const i1 = mine.d.findIndex((d) => d > 1300)
  const pts = pathPoints(mine, i0, i1)
  const P = makePath(pts)

  it('empaqueta, viaja como JSON y se compara igual que la original', () => {
    const fp = findPasses(P, friend)[0]
    const mp = findPasses(P, mine)[0]
    expect(fp && mp).toBeTruthy()
    const g = JSON.parse(JSON.stringify(packGhost(friend, fp, pts, { rider: 'Lucía', bike: 'MT-07', name: 'Subida' })))
    expect(JSON.stringify(g).length).toBeLessThan(120000)
    const { B, pass } = unpackGhost(g)
    expect(pass).toBeTruthy()
    expect(pass.time).toBeCloseTo(fp.time, 1)
    expect(B.ghost.rider).toBe('Lucía')
    // La fecha de su pasada se conserva
    expect(Math.abs(B.meta.start + pass.t0 * 1000 - (friend.meta.start + fp.t0 * 1000))).toBeLessThan(200)
    const direct = compare(mp, mine, fp, friend, P.length)
    const viaGhost = compare(mp, mine, pass, B, P.length)
    expect(viaGhost.delta[viaGhost.n - 1]).toBeCloseTo(direct.delta[direct.n - 1], 1)
    // Mi amigo va más rápido: acaba por delante
    expect(viaGhost.delta[viaGhost.n - 1]).toBeLessThan(-2)
  })

  it('el cronómetro de un tramo arranca al cruzar la salida, ni antes ni después', () => {
    // El tramo va de la muestra a a la b: su tiempo es t[b] − t[a]. Antes, justo antes de la salida se
    // enganchaba a un punto ya dentro del tramo y salían hasta 0,9 s de más (según el redondeo del trazado)
    const r6 = (x) => Math.round(x * 1e6) / 1e6
    for (const v of [mine, friend])
      for (const d0 of [150, 420, 700, 950]) {
        const a = v.d.findIndex((d) => d > d0)
        const b = v.d.findIndex((d) => d > d0 + 500)
        const pts = pathPoints(v, a, b)
        for (const P of [makePath(pts), makePath(pts.map(([la, lo]) => [r6(la), r6(lo)]))]) {
          const t = findPasses(P, v)[0]?.time
          expect(Math.abs(t - (v.t[b] - v.t[a]))).toBeLessThan(0.15)
        }
      }
  })

  it('no acepta paquetes rotos', () => {
    expect(() => unpackGhost({ v: 99 })).toThrow()
    expect(() => unpackGhost(null)).toThrow()
  })
})
