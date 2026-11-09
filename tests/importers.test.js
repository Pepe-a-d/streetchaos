// Archivos de otros aparatos: GPX, CSV de RaceBox y RaceChrono, VBO y NMEA. Se escriben con el mismo
// formato que los de verdad (cabeceras, unidades y signos comprobados con archivos reales) a partir de
// una salida inventada, y se comprueba que el análisis sale igual que el de la salida original.
import { describe, it, expect } from 'vitest'
import { synthRide } from '../src/blackbox/synth.js'
import { analyze } from '../src/blackbox/process.js'
import { parseLoggerFile, isLoggerFile } from '../src/blackbox/importers.js'

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

// La «verdad»: el recorrido exacto de una salida inventada, como lo grabaría un GPS de 25 Hz (con unos
// centímetros de error); A es el análisis de lo que grabó el móvil en esa misma salida
const ride = synthRide({ path: road(), drag: false })
const A = analyze(ride)
const T = ride.truth
const lat0 = road()[0][0]
const lon0 = road()[0][1]
const rows = []
for (let t = 0; t <= T.tEnd; t += 0.04) {
  const S = T.at(t)
  // El error de un GPS va a la deriva (decímetros que cambian despacio) más un temblor de centímetros
  const e = Math.sin(t * 0.3) * 0.4 + Math.sin(t * 13) * 0.03
  rows.push({ ms: ride.meta.start + Math.round(t * 1000), lat: lat0 + (S.y + e) / ky, lon: lon0 + (S.x - e) / kx, alt: 20, v: Math.max(0, S.v + Math.sin(t * 5.1) * 0.05), hdg: ((S.psi / RAD) % 360 + 360) % 360, lean: S.lean / RAD, gLong: S.a / 9.80665, gLat: Math.tan(S.lean) })
}
let TRUE_LEAN = 0
for (const r of rows) TRUE_LEAN = Math.max(TRUE_LEAN, Math.abs(r.lean))
const iso = (ms) => new Date(ms).toISOString()
const hms = (ms) => {
  const d = new Date(ms)
  const p = (x) => String(x).padStart(2, '0')
  return `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.${String(Math.round(d.getUTCMilliseconds() / 10)).padStart(2, '0')}`
}

function check(s, { lean = false } = {}) {
  const B = analyze(s)
  expect(B.empty).toBeFalsy()
  expect(s.meta.source).toBe('real')
  expect(s.meta.logger.hz).toBeGreaterThan(8)
  expect(Math.abs(B.stats.vMax - T.vmax)).toBeLessThan(0.3)
  expect(Math.abs(B.stats.dist - A.stats.dist) / A.stats.dist).toBeLessThan(0.02)
  // Las curvas se encuentran y la inclinación máxima cuadra con la de verdad (la del aparato o la del
  // rumbo del GPS, que con 25 posiciones por segundo ya es fina)
  const maxLean = Math.max(...B.corners.map((c) => c.lean))
  expect(B.corners.length).toBeGreaterThanOrEqual(A.corners.length - 1)
  expect(Math.abs(maxLean - TRUE_LEAN)).toBeLessThan(lean ? 1 : 2.5)
  if (lean) expect(B.info.leanFrom).toBe('device')
  return B
}

describe('Importar archivos de otros aparatos', () => {
  it('CSV de RaceBox: velocidad sin unidad (km/h), G lateral + izquierda', () => {
    const csv = ['Record,Time,Latitude,Longitude,Altitude,Speed,GForceX,GForceY,GForceZ,Lap,GyroX,GyroY,GyroZ', ...rows.map((r, k) => [k + 1, iso(r.ms), r.lat.toFixed(7), r.lon.toFixed(7), '20.0', (r.v * 3.6).toFixed(2), r.gLong.toFixed(3), (-r.gLat).toFixed(3), '1.000', 0, '0.00', '0.00', '0.00'].join(','))].join('\r\n')
    expect(isLoggerFile('RaceBox Session.csv')).toBe(true)
    const [s] = parseLoggerFile(csv, 'RaceBox Session.csv')
    expect(s.meta.logger.kind).toBe('racebox')
    const B = check(s)
    expect(B.info.longFrom).toBe('device')
  })

  it('CSV de RaceBox en modo moto, con cabecera de sesión y LeanAngle', () => {
    const head = ['Format,RaceBox CSV', 'Data Source,RaceBox Mini S', `Date UTC,${iso(rows[0].ms)}`, 'Track,Oleiros', '']
    const csv = [...head, 'Record,Time,Latitude,Longitude,Altitude,Speed,GForceX,GForceZ,Lap,LeanAngle,GyroX,GyroY,GyroZ', ...rows.map((r, k) => [k + 1, iso(r.ms), r.lat.toFixed(7), r.lon.toFixed(7), '20.0', (r.v * 3.6).toFixed(2), r.gLong.toFixed(3), '1.000', 0, r.lean.toFixed(1), 0, 0, 0].join(','))].join('\n')
    const [s] = parseLoggerFile(csv, 'bike.csv')
    expect(s.meta.logger.name).toMatch(/RaceBox.*Mini S/)
    check(s, { lean: true })
  })

  it('CSV v3 de RaceChrono: tres filas de cabecera y columnas repetidas por fuente', () => {
    const head = ['This file is created using RaceChrono Pro v10.2.4 ( http://racechrono.com/ ).', 'Format,3', 'Session title,"Oleiros, mañana"', 'Session type,Lap timing', 'Track name,"Oleiros"', 'Driver name,', 'Created,09/11/2026,09:30', 'Note,', '']
    const names = 'timestamp,fragment_id,lap_number,elapsed_time,distance_traveled,accuracy,altitude,bearing,device_update_rate,fix_type,latitude,longitude,satellites,speed,combined_acc,lateral_acc,lean_angle,longitudinal_acc,speed'
    const units = 'unix time,,,s,m,m,m,deg,Hz,,deg,deg,sats,m/s,G,G,deg,G,m/s'
    const srcs = ',,,,,100: gps,100: gps,100: gps,100: gps,100: gps,100: gps,100: gps,100: gps,100: gps,calc,calc,calc,calc,calc'
    const data = rows.map((r) => [(r.ms / 1000).toFixed(3), 0, 1, '', '', '0.5', '20', r.hdg.toFixed(2), 10, 3, r.lat.toFixed(7), r.lon.toFixed(7), 15, r.v.toFixed(3), '', (-r.gLat).toFixed(3), r.lean.toFixed(2), r.gLong.toFixed(3), (r.v * 0.99).toFixed(3)].join(','))
    const [s] = parseLoggerFile([...head, names, units, srcs, ...data].join('\r\n'), 'session.csv')
    expect(s.meta.logger.kind).toBe('racechrono')
    check(s, { lean: true })
  })

  it('VBO: minutos, longitud positiva al oeste y hora UTC', () => {
    const f = (x, w, d) => `${x < 0 ? '-' : '+'}${Math.abs(x).toFixed(d).padStart(w, '0')}`
    const d = new Date(rows[0].ms)
    const p = (x) => String(x).padStart(2, '0')
    const txt = [
      `File created on ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} @ ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
      '',
      '[header]',
      'time',
      'latitude',
      'longitude',
      'velocity kmh',
      'heading',
      'height',
      'LongAcc',
      'LatAcc',
      '',
      '[comments]',
      'Generated by RaceBox',
      '',
      '[column names]',
      'time lat lng velocity heading height LongAcc LatAcc',
      '',
      '[data]',
      ...rows.map((r) => [hms(r.ms), f(r.lat * 60, 11, 5), f(-r.lon * 60, 12, 5), (r.v * 3.6).toFixed(3).padStart(7, '0'), r.hdg.toFixed(2), '+00020.00', f(r.gLong, 5, 3), f(-r.gLat, 5, 3)].join(' ')),
    ].join('\r\n')
    const [s] = parseLoggerFile(txt, 'session.vbo')
    expect(s.meta.logger.name).toBe('RaceBox (VBO)')
    expect(s.meta.start).toBe(rows[0].ms)
    // Oeste: longitud negativa, como la de verdad
    check(s)
  })

  it('GPX 1.1 con velocidad de Garmin y GPX sin velocidad', () => {
    const pt = (r, sp) => `<trkpt lat="${r.lat.toFixed(7)}" lon="${r.lon.toFixed(7)}"><ele>20</ele><time>${iso(r.ms)}</time>${sp ? `<extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>${r.v.toFixed(3)}</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions>` : ''}</trkpt>`
    const gpx = (sp) => `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="RaceBox" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2"><trk><trkseg>\n${rows.map((r) => pt(r, sp)).join('\n')}\n</trkseg></trk></gpx>`
    const [a] = parseLoggerFile(gpx(true), 'ruta.gpx')
    expect(a.meta.logger.name).toBe('RaceBox (GPX)')
    check(a)
    const [b] = parseLoggerFile(gpx(false), 'ruta.gpx')
    const B = analyze(b)
    expect(Math.abs(B.stats.vMax - T.vmax)).toBeLessThan(1)
    // El mismo archivo dos veces es la misma salida (no se duplica al importarlo otra vez)
    expect(parseLoggerFile(gpx(true), 'otra.gpx')[0].meta.id).toBe(a.meta.id)
  })

  it('NMEA a 25 Hz (RMC + GGA, velocidad en nudos)', () => {
    const cs = (s) => {
      let x = 0
      for (const ch of s) x ^= ch.charCodeAt(0)
      return x.toString(16).toUpperCase().padStart(2, '0')
    }
    const dm = (deg, isLat) => {
      const a = Math.abs(deg)
      const d = Math.floor(a)
      return `${String(d).padStart(isLat ? 2 : 3, '0')}${((a - d) * 60).toFixed(5).padStart(8, '0')}`
    }
    const d = new Date(rows[0].ms)
    const date = `${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCFullYear() - 2000).padStart(2, '0')}`
    const lines = []
    for (const r of rows) {
      const rmc = `GNRMC,${hms(r.ms)},A,${dm(r.lat, true)},${r.lat < 0 ? 'S' : 'N'},${dm(r.lon, false)},${r.lon < 0 ? 'W' : 'E'},${(r.v / 0.514444).toFixed(3)},${r.hdg.toFixed(2)},${date},,,A`
      const gga = `GNGGA,${hms(r.ms)},${dm(r.lat, true)},N,${dm(r.lon, false)},W,1,12,0.8,20.0,M,50.0,M,,`
      lines.push(`$${rmc}*${cs(rmc)}`, `$${gga}*${cs(gga)}`)
    }
    lines.push('$GNRMC,basura*00')
    const [s] = parseLoggerFile(lines.join('\r\n'), 'log.nmea')
    check(s)
  })

  it('dice claro lo que no puede leer', () => {
    expect(() => parseLoggerFile('a,b,c\n1,2,3', 'x.csv')).toThrow(/latitud/)
    expect(() => parseLoggerFile('<gpx><trk></trk></gpx>', 'x.gpx')).toThrow(/punto/)
  })
})
