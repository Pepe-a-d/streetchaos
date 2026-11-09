// Archivos de otros aparatos: GPS externos de 10-25 Hz (RaceBox, VBOX, Qstarz...), apps (RaceChrono) y
// cualquier GPX. Se convierten en una salida como las del móvil (docs/telemetria.md) para que todo el
// Blackbox funcione igual: mapa, gráficas, curvas, tramos, comparar. Con 10-25 posiciones por segundo
// en vez de una, los tiempos y las velocidades son mucho más finos.
//
// Formatos (comprobados con archivos reales de cada uno):
// - GPX: <trkpt> con <time>; la velocidad, de <speed> (GPX 1.0, OsmAnd) o gpxtpx:speed (Garmin v2), en m/s.
// - CSV de RaceBox: Record,Time,Latitude,Longitude,Altitude,Speed,GForceX,GForceY,... (25 Hz, hora ISO en
//   UTC). «Speed» va en la unidad que eligieras al exportar sin decirla: se deduce con las posiciones.
//   GForceX + = acelera; GForceY + = curva a izquierda; en modo moto, LeanAngle en vez de GForceY.
// - CSV de RaceChrono v3: cabecera de sesión, «Format,3» y tres filas (nombres, unidades, fuentes);
//   «timestamp» en segundos Unix. lean_angle + = derecha; lateral_acc + = izquierda. v2: una fila
//   «Nombre (unidad) *fuente».
// - VBO (Racelogic, también RaceBox y dragy·Lap): secciones [column names] y [data]; hora hhmmss.ss UTC;
//   latitud y longitud en minutos, con la longitud POSITIVA AL OESTE.
// - NMEA ($GPRMC/$GNRMC + GGA): velocidad en nudos, fecha solo en RMC.
import { STREAMS, FORMAT } from '../core/blackbox.js'

const W_GPS = STREAMS.gps.fields.length
const W_CALC = STREAMS.calc.fields.length
const KNOT = 0.514444
const R_EARTH = 6371008.8
const RAD = Math.PI / 180

/** ¿Lo sabe leer este módulo? (por la extensión o por lo que pone al principio) */
export function isLoggerFile(name, head = '') {
  if (/\.(gpx|vbo|nmea|nma|csv)$/i.test(name)) return true
  return /^\s*<\?xml[\s\S]{0,400}<gpx|^\s*<gpx|\[data\]|^\$G[PNL]RMC/m.test(head)
}

// ---------- Utilidades ----------

const median = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y)
  return s.length ? s[s.length >> 1] : NaN
}
const hav = (la1, lo1, la2, lo2) => {
  const dLa = (la2 - la1) * RAD
  const dLo = (lo2 - lo1) * RAD
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin(dLo / 2) ** 2
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)))
}
const bearing = (la1, lo1, la2, lo2) => {
  const y = Math.sin((lo2 - lo1) * RAD) * Math.cos(la2 * RAD)
  const x = Math.cos(la1 * RAD) * Math.sin(la2 * RAD) - Math.sin(la1 * RAD) * Math.cos(la2 * RAD) * Math.cos((lo2 - lo1) * RAD)
  return (Math.atan2(y, x) / RAD + 360) % 360
}
function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}
const num = (x) => {
  if (x == null) return NaN
  const s = String(x).trim()
  if (!s) return NaN
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

/**
 * Puntos [{ ms, lat, lon, alt, speed (m/s), heading, acc, lean, gLong, gLat }] → una salida.
 * Rellena lo que falte: rumbo con las posiciones, velocidad con las posiciones si no la trae.
 */
export function toSession(points, { kind, name, file = '', speedFromPos = false }) {
  const P = points.filter((p) => Number.isFinite(p.ms) && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && !(p.lat === 0 && p.lon === 0)).sort((a, b) => a.ms - b.ms)
  // Repetidos (la misma hora): el primero
  const pts = []
  for (const p of P) if (!pts.length || p.ms - pts.at(-1).ms >= 5) pts.push(p)
  if (pts.length < 10) throw new Error('No hay posiciones suficientes en el archivo')
  const n = pts.length
  const start = pts[0].ms
  const dt = []
  for (let k = 1; k < n; k++) dt.push((pts[k].ms - pts[k - 1].ms) / 1000)
  const step = median(dt)
  const hz = step > 0 ? Math.round((1 / step) * 10) / 10 : 1
  // Velocidad y rumbo con las posiciones, sobre ~0,4 s (más corto, el ruido de la posición manda)
  const span = Math.max(1, Math.round(0.2 / Math.max(0.01, step)))
  const posV = new Float64Array(n).fill(NaN)
  const posH = new Float64Array(n).fill(NaN)
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - span)
    const b = Math.min(n - 1, k + span)
    const t = (pts[b].ms - pts[a].ms) / 1000
    if (!(t > 0) || t > 5) continue
    const d = hav(pts[a].lat, pts[a].lon, pts[b].lat, pts[b].lon)
    posV[k] = d / t
    if (d > 0.5) posH[k] = bearing(pts[a].lat, pts[a].lon, pts[b].lat, pts[b].lon)
  }
  const gps = new Float64Array(n * W_GPS)
  const hasCalc = pts.some((p) => Number.isFinite(p.lean) || Number.isFinite(p.gLong) || Number.isFinite(p.gLat))
  const calc = new Float32Array(hasCalc ? n * W_CALC : 0)
  let dist = 0
  let moving = 0
  let vmax = 0
  for (let k = 0; k < n; k++) {
    const p = pts[k]
    const t = (p.ms - start) / 1000
    let v = speedFromPos ? posV[k] : p.speed
    if (!Number.isFinite(v) && !speedFromPos) v = posV[k]
    const hdg = Number.isFinite(p.heading) ? p.heading : posH[k]
    gps.set([t, p.ms, p.lat, p.lon, Number.isFinite(p.acc) ? p.acc : NaN, Number.isFinite(p.alt) ? p.alt : NaN, NaN, Number.isFinite(v) ? v : NaN, Number.isFinite(hdg) && v > 1 ? hdg : NaN, Number.isFinite(v) ? v : NaN, Number.isFinite(hdg) ? hdg : NaN], k * W_GPS)
    if (hasCalc) calc.set([t, Number.isFinite(v) ? v : NaN, num(p.gLong), num(p.gLat), num(p.lean)], k * W_CALC)
    if (k) {
      const d = hav(pts[k - 1].lat, pts[k - 1].lon, p.lat, p.lon)
      const ddt = (p.ms - pts[k - 1].ms) / 1000
      if (ddt < 5 && d / Math.max(ddt, 1e-3) < 120) dist += d
      if (v > 1 && ddt < 5) moving += ddt
    }
    if (Number.isFinite(v) && v < 120) vmax = Math.max(vmax, v)
  }
  const end = pts[n - 1].ms
  const meta = {
    id: `${kind}-${hash(`${start}|${end}|${n}|${pts[n >> 1].lat}`)}`,
    format: FORMAT,
    state: 'done',
    start,
    end,
    source: 'real',
    logger: { kind, name, hz, file: String(file).slice(0, 120), lean: pts.some((p) => Number.isFinite(p.lean)), g: pts.some((p) => Number.isFinite(p.gLong)) },
    calib: null,
    rider: {},
    device: { ua: name },
    rows: { gps: n, imu: 0, calc: hasCalc ? n : 0, ev: 0 },
    dist,
    moving,
    vmax,
  }
  return { meta, gps, imu: new Float32Array(0), calc, ev: [] }
}

/**
 * Si el archivo no dice en qué va la velocidad: la que mejor cuadra con las posiciones (m/s, km/h, mph
 * o nudos). Devuelve el factor para pasarla a m/s.
 */
function speedFactor(pts) {
  const r = []
  for (let k = 5; k < pts.length - 5; k += 3) {
    const a = pts[k - 5]
    const b = pts[k + 5]
    const t = (b.ms - a.ms) / 1000
    if (!(t > 0.2) || t > 4 || !(pts[k].speed > 0.5)) continue
    const v = hav(a.lat, a.lon, b.lat, b.lon) / t
    if (v > 3) r.push(pts[k].speed / v)
  }
  const m = median(r)
  if (!Number.isFinite(m)) return 1
  const C = [
    [1, 1],
    [3.6, 1 / 3.6],
    [2.236936, 1 / 2.236936],
    [1.943844, KNOT],
  ]
  return C.reduce((best, c) => (Math.abs(Math.log(m / c[0])) < Math.abs(Math.log(m / best[0])) ? c : best))[1]
}

// ---------- GPX ----------

export function parseGpx(text, file) {
  const pts = []
  const tag = (inner, name) => {
    const m = new RegExp(`<(?:[\\w-]+:)?${name}>\\s*([^<]*?)\\s*</(?:[\\w-]+:)?${name}>`, 'i').exec(inner)
    return m ? m[1] : null
  }
  const re = /<trkpt\b([^>]*?)(\/>|>([\s\S]*?)<\/trkpt>)/gi
  let m
  while ((m = re.exec(text))) {
    const attrs = m[1]
    const inner = m[3] || ''
    const lat = num((/\blat\s*=\s*["']([^"']+)/i.exec(attrs) || [])[1])
    const lon = num((/\blon\s*=\s*["']([^"']+)/i.exec(attrs) || [])[1])
    const time = tag(inner, 'time')
    pts.push({ ms: time ? Date.parse(time) : NaN, lat, lon, alt: num(tag(inner, 'ele')), speed: num(tag(inner, 'speed')), heading: num(tag(inner, 'course') ?? tag(inner, 'bearing')) })
  }
  if (!pts.length) throw new Error('El GPX no tiene ningún punto de recorrido (trkpt)')
  if (!pts.some((p) => Number.isFinite(p.ms))) throw new Error('El GPX no trae la hora de cada punto: sin ella no se pueden sacar tiempos')
  const creator = (/<gpx\b[^>]*\bcreator\s*=\s*["']([^"']*)/i.exec(text) || [])[1] || ''
  const name = /racebox/i.test(creator) ? 'RaceBox (GPX)' : /racechrono/i.test(creator) ? 'RaceChrono (GPX)' : creator ? `GPX · ${creator.slice(0, 40)}` : 'GPX'
  const withSpeed = pts.filter((p) => Number.isFinite(p.speed)).length > pts.length * 0.5
  return toSession(pts, { kind: 'gpx', name, file, speedFromPos: !withSpeed })
}

// ---------- CSV (RaceBox, RaceChrono y otros) ----------

function splitter(line) {
  const d = [',', ';', '\t'].map((c) => [c, line.split(c).length]).sort((a, b) => b[1] - a[1])[0][0]
  return (l) => {
    // Comillas sencillas (RaceChrono pone el título entre comillas)
    if (!l.includes('"')) return l.split(d)
    const out = []
    let cur = ''
    let q = false
    for (const ch of l) {
      if (ch === '"') q = !q
      else if (ch === d && !q) (out.push(cur), (cur = ''))
      else cur += ch
    }
    out.push(cur)
    return out
  }
}
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\(.*?\)|\*.*$/g, '')
    .replace(/[^a-z0-9]/g, '')

/** Qué columna es cada cosa. `src` (RaceChrono) dice de dónde sale: gps, calc, acc... */
function columns(names, units = [], srcs = []) {
  const N = names.map(norm)
  const S = srcs.map((s) => String(s || '').toLowerCase())
  const pick = (alts, prefer) => {
    let found = -1
    for (const a of alts)
      for (let i = 0; i < N.length; i++) {
        if (N[i] !== a) continue
        if (found < 0) found = i
        if (prefer && S[i]?.includes(prefer)) return i
      }
    return found
  }
  return {
    time: pick(['timestamp', 'time', 'utctime', 'datetime', 'utc', 'date', 'elapsedtime']),
    lat: pick(['latitude', 'lat']),
    lon: pick(['longitude', 'lon', 'lng', 'long']),
    alt: pick(['altitude', 'alt', 'height', 'elevation']),
    speed: pick(['speed', 'velocity', 'kph', 'kmh', 'mph', 'gpsspeed'], 'gps'),
    heading: pick(['bearing', 'heading', 'course'], 'gps'),
    acc: pick(['accuracy', 'hacc', 'horizontalaccuracy']),
    lean: pick(['leanangle', 'lean', 'leanangledeg']),
    gLong: pick(['longitudinalacc', 'longitudinalacceleration', 'longacc', 'gforcex', 'gx'], 'calc'),
    gLat: pick(['lateralacc', 'lateralacceleration', 'latacc', 'gforcey', 'gy'], 'calc'),
    // Unidad de la velocidad, si la dice
    speedUnit: (() => {
      const i = pick(['speed', 'velocity', 'kph', 'kmh', 'mph', 'gpsspeed'], 'gps')
      if (i < 0) return null
      const txt = `${names[i]} ${units[i] || ''}`.toLowerCase()
      if (/m\/s|mps/.test(txt)) return 1
      if (/km\/?h|kph|kmh/.test(txt)) return 1 / 3.6
      if (/mph/.test(txt)) return 1 / 2.236936
      if (/knot|kn\b|kts/.test(txt)) return KNOT
      return null
    })(),
  }
}

/** Hora de una celda: ISO, segundos Unix, milisegundos o segundos desde el principio (con base). */
function timeOf(cell, base) {
  const s = String(cell || '').trim()
  if (!s) return NaN
  if (/^\d+(\.\d+)?$/.test(s)) {
    const x = Number(s)
    if (x > 1e12) return x
    if (x > 1e9) return x * 1000
    return Number.isFinite(base) ? base + x * 1000 : NaN
  }
  // «2024-06-15 11:00:00» sin zona: se toma como UTC si el archivo lo dice; si no, hora local
  const iso = s.includes('T') || /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T')
  return Date.parse(iso)
}

export function parseCsv(text, file, { mtime } = {}) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  // La fila de cabecera: la primera que tenga latitud y longitud
  let h = -1
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const l = lines[i].toLowerCase()
    if (/lat/.test(l) && /lon|lng/.test(l) && /time|timestamp|utc|date/.test(l)) {
      h = i
      break
    }
  }
  if (h < 0) throw new Error('No se encuentran columnas de latitud, longitud y hora')
  const split = splitter(lines[h])
  const names = split(lines[h]).map((x) => x.trim())
  const rc3 = /^format,\s*3/im.test(lines.slice(0, h).join('\n'))
  const rc2 = /^format,\s*2/im.test(lines.slice(0, h).join('\n'))
  const racechrono = /racechrono/i.test(lines[0] || '') || rc3 || rc2
  let units = []
  let srcs = []
  let first = h + 1
  if (rc3) {
    units = split(lines[h + 1] || '')
    srcs = split(lines[h + 2] || '')
    first = h + 3
  } else if (rc2) srcs = names.map((n) => (/\*(\w+)/.exec(n) || [])[1] || 'gps')
  const C = columns(names, units, srcs)
  if (C.lat < 0 || C.lon < 0 || C.time < 0) throw new Error('No se encuentran columnas de latitud, longitud y hora')
  // Hora base para archivos que cuentan segundos desde el principio: la de la cabecera (RaceBox «Date UTC»)
  const head = lines.slice(0, h).join('\n')
  const baseTxt = (/^date utc\s*[,;]\s*(.+)$/im.exec(head) || [])[1]
  const base = baseTxt ? Date.parse(baseTxt.trim()) : Number.isFinite(mtime) ? mtime : NaN
  const racebox = /racebox/i.test(head) || (names[0] === 'Record' && names.includes('GForceX'))
  const pts = []
  for (let i = first; i < lines.length; i++) {
    const l = lines[i]
    if (!l || !l.trim()) continue
    const c = split(l)
    const ms = timeOf(c[C.time], base)
    pts.push({
      ms,
      lat: num(c[C.lat]),
      lon: num(c[C.lon]),
      alt: C.alt >= 0 ? num(c[C.alt]) : NaN,
      speed: C.speed >= 0 ? num(c[C.speed]) : NaN,
      heading: C.heading >= 0 ? num(c[C.heading]) : NaN,
      acc: C.acc >= 0 ? num(c[C.acc]) : NaN,
      lean: C.lean >= 0 ? num(c[C.lean]) : NaN,
      gLong: C.gLong >= 0 ? num(c[C.gLong]) : NaN,
      // La lateral se guarda + derecha (como en la app); RaceBox y RaceChrono la dan + izquierda
      gLat: C.gLat >= 0 ? -num(c[C.gLat]) : NaN,
    })
  }
  if (C.speed >= 0) {
    const f = C.speedUnit ?? speedFactor(pts)
    for (const p of pts) p.speed *= f
  }
  // RaceChrono mezcla filas de cada sensor (GPS, acelerómetro...) con lo demás interpolado: a 50 Hz basta
  let keep = pts
  if (racechrono) {
    keep = []
    for (const p of pts) if (!keep.length || p.ms - keep.at(-1).ms >= 19) keep.push(p)
  }
  const name = racebox ? `RaceBox${/data source\s*,\s*([^\r\n]+)/i.test(head) ? ` · ${/data source\s*,\s*([^\r\n]+)/i.exec(head)[1].trim().replace(/^racebox\s*/i, '')}` : ''}` : racechrono ? 'RaceChrono' : 'CSV'
  return toSession(keep, { kind: racebox ? 'racebox' : racechrono ? 'racechrono' : 'csv', name: name.replace(/ · $/, ''), file, speedFromPos: C.speed < 0 })
}

// ---------- VBO (Racelogic VBOX, RaceBox, dragy·Lap) ----------

export function parseVbo(text, file) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const sections = {}
  let cur = 'pre'
  for (const l of lines) {
    const m = /^\s*\[([^\]]+)\]\s*$/.exec(l)
    if (m) {
      cur = m[1].toLowerCase()
      sections[cur] = []
      continue
    }
    ;(sections[cur] ||= []).push(l)
  }
  const cols = (sections['column names'] || []).join(' ').trim().split(/\s+/).filter(Boolean)
  const data = (sections.data || []).filter((l) => l.trim())
  if (!cols.length || !data.length) throw new Error('El VBO no tiene [column names] o [data]')
  const ix = (re) => cols.findIndex((c) => re.test(c))
  const C = { time: ix(/^time$/i), lat: ix(/^lat/i), lon: ix(/^(long|lng|lon)/i), v: ix(/^velocity|^speed/i), hdg: ix(/^heading/i), alt: ix(/^height|^alt/i), lean: ix(/lean/i), gLong: ix(/^longacc|^long_?acc/i), gLat: ix(/^latacc|^lat_?acc/i) }
  if (C.time < 0 || C.lat < 0 || C.lon < 0) throw new Error('El VBO no tiene hora, latitud o longitud')
  // Unidad de la velocidad: en [header] («velocity kmh», «velocity mph»...)
  const hv = (sections.header || []).find((l) => /velocity|speed/i.test(l)) || 'velocity kmh'
  const vf = /m\/s/i.test(hv) ? 1 : /mph/i.test(hv) ? 1 / 2.236936 : /knot/i.test(hv) ? KNOT : 1 / 3.6
  // Fecha: «UTC Date Started : 05/05/2026 16:35» (RaceBox) o «File created on 07/12/2014 @ 09:02:23»
  const all = text.slice(0, 4000)
  const dm = /utc date started\s*:\s*(\d\d)\/(\d\d)\/(\d{4})\s+(\d\d):(\d\d)/i.exec(all) || /created on\s+(\d\d)\/(\d\d)\/(\d{4})\s*(?:@|at)?\s*(\d\d):(\d\d)/i.exec(all)
  const pts = []
  let day = null
  let lastSod = -1
  let dayAdd = 0
  for (const l of data) {
    const c = l.trim().split(/\s+/)
    const tt = c[C.time]
    const hh = Number(tt.slice(0, 2))
    const mi = Number(tt.slice(2, 4))
    const ss = Number(tt.slice(4))
    let sod = hh * 3600 + mi * 60 + ss
    if (!Number.isFinite(sod)) continue
    if (day == null) {
      if (dm) {
        const [, D, M, Y, H, Mi] = dm.map(Number)
        const head = Date.UTC(Y, M - 1, D, H, Mi)
        // La hora de la cabecera puede ser local: el día UTC que deja la primera muestra más cerca
        day = [-1, 0, 1].map((k) => Date.UTC(Y, M - 1, D + k)).reduce((b, d) => (Math.abs(d + sod * 1000 - head) < Math.abs(b + sod * 1000 - head) ? d : b))
      } else day = Date.UTC(2000, 0, 1)
    }
    // Pasa la medianoche
    if (lastSod >= 0 && sod < lastSod - 43200) dayAdd += 86400
    lastSod = sod
    sod += dayAdd
    const lat = num(c[C.lat]) / 60
    const lon = -num(c[C.lon]) / 60 // positiva al oeste
    pts.push({
      ms: day + sod * 1000,
      lat,
      lon,
      alt: C.alt >= 0 ? num(c[C.alt]) : NaN,
      speed: C.v >= 0 ? num(c[C.v]) * vf : NaN,
      heading: C.hdg >= 0 ? num(c[C.hdg]) : NaN,
      lean: C.lean >= 0 ? num(c[C.lean]) : NaN,
      gLong: C.gLong >= 0 ? num(c[C.gLong]) : NaN,
      gLat: C.gLat >= 0 ? -num(c[C.gLat]) : NaN, // + izquierda en el VBO
    })
  }
  const comments = (sections.comments || []).join('\n')
  const by = /generated by\s*(.+)/i.exec(comments)?.[1]?.trim()
  return toSession(pts, { kind: 'vbo', name: by ? `${by} (VBO)` : 'VBOX', file, speedFromPos: C.v < 0 })
}

// ---------- NMEA ----------

function nmeaOk(l) {
  const m = /^\$([^*]+)\*([0-9A-F]{2})\s*$/i.exec(l)
  if (!m) return /^\$[^*]+$/.test(l)
  let x = 0
  for (const ch of m[1]) x ^= ch.charCodeAt(0)
  return x === parseInt(m[2], 16)
}
const nmeaDeg = (v, h) => {
  const x = num(v)
  if (!Number.isFinite(x)) return NaN
  const d = Math.floor(x / 100)
  const r = d + (x - d * 100) / 60
  return h === 'S' || h === 'W' ? -r : r
}

export function parseNmea(text, file) {
  const byTime = new Map()
  let date = null
  let lastSod = -1
  let dayAdd = 0
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim()
    if (!l.startsWith('$') || !nmeaOk(l)) continue
    const f = l.split('*')[0].split(',')
    const type = f[0].slice(3)
    const tt = f[1]
    if (!tt) continue
    let sod = Number(tt.slice(0, 2)) * 3600 + Number(tt.slice(2, 4)) * 60 + Number(tt.slice(4))
    if (type === 'RMC') {
      if (f[2] !== 'A') continue
      const d = f[9]
      if (d && d.length === 6) date = Date.UTC(2000 + Number(d.slice(4, 6)), Number(d.slice(2, 4)) - 1, Number(d.slice(0, 2)))
    }
    if (lastSod >= 0 && sod < lastSod - 43200) dayAdd += 86400
    lastSod = Math.max(lastSod, sod)
    sod += dayAdd
    const p = byTime.get(sod) || { sod }
    if (type === 'RMC') Object.assign(p, { lat: nmeaDeg(f[3], f[4]), lon: nmeaDeg(f[5], f[6]), speed: num(f[7]) * KNOT, heading: num(f[8]), date })
    else if (type === 'GGA' && Number(f[6]) > 0) {
      Object.assign(p, { alt: num(f[9]), acc: num(f[8]) * 2.5 })
      if (!Number.isFinite(p.lat)) Object.assign(p, { lat: nmeaDeg(f[2], f[3]), lon: nmeaDeg(f[4], f[5]) })
    }
    byTime.set(sod, p)
  }
  const pts = [...byTime.values()]
  const d0 = pts.find((p) => p.date != null)?.date
  if (d0 == null) throw new Error('El NMEA no trae fecha (frases RMC)')
  // La fecha se quita a medianoche de la primera RMC (dayAdd ya lleva los días que pasan)
  const sod0 = pts.find((p) => p.date != null).sod
  const base = d0 - Math.floor(sod0 / 86400) * 86400000
  for (const p of pts) p.ms = base + p.sod * 1000
  return toSession(pts, { kind: 'nmea', name: 'NMEA', file })
}

/** Cualquier archivo de otro aparato → sesiones (de momento, una por archivo). */
export function parseLoggerFile(text, file = '', opts = {}) {
  const head = text.slice(0, 3000)
  if (/<gpx\b/i.test(head)) return [parseGpx(text, file)]
  if (/^\s*\[(header|column names|data)\]/im.test(text.slice(0, 20000)) || /\.vbo$/i.test(file)) return [parseVbo(text, file)]
  if (/^\$G[PNL](RMC|GGA)/m.test(head) || /\.(nmea|nma)$/i.test(file)) return [parseNmea(text, file)]
  return [parseCsv(text, file, opts)]
}
