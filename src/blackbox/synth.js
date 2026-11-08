// Salida en moto inventada pero coherente (física de la curva, postura del móvil en el soporte,
// ruido del GPS y de los sensores) para probar el analizador y para la demo de /blackbox.
// Devuelve lo mismo que readSession() de la caja negra, más la «verdad» para comparar.
import { FORMAT, toBase64, STREAMS } from '../core/blackbox.js'

const G = 9.80665
const RAD = Math.PI / 180
const R_EARTH = 6371008.8

function rng(seed) {
  let a = seed >>> 0
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const gauss = () => Math.sqrt(-2 * Math.log(uni() + 1e-12)) * Math.cos(2 * Math.PI * uni())
  return { uni, gauss }
}

const movAvg = (a, w) => a.map((_, i) => {
  let s = 0
  let c = 0
  for (let j = Math.max(0, i - w); j <= Math.min(a.length - 1, i + w); j++) (s += a[j]), c++
  return s / c
})

/**
 * @param {object} o
 * @param {number[][]} o.path  [[lat, lon], ...] por donde va la moto
 * @param {boolean} [o.drag]   empieza con una pasada a fondo en una recta de 400 m antes del recorrido
 * @param {number} [o.tilt]    grados que el móvil va inclinado hacia atrás en el soporte
 * @param {boolean} [o.invert] signo del acelerómetro al revés (como algunos navegadores)
 * @param {boolean} [o.imu]    con sensores (sin ellos, como el simulador o un ordenador)
 */
export function synthRide({ path, seed = 7, start = Date.UTC(2026, 10, 9, 9, 30), imuHz = 60, tilt = 15, invert = false, imu = true, drag = true, vRoad = 24, aLat = 0.6 } = {}) {
  const R = rng(seed)
  const [lat0, lon0] = path[0]
  const kx = Math.cos(lat0 * RAD) * R_EARTH * RAD
  const ky = R_EARTH * RAD
  let pts = path.map(([la, lo]) => [(lo - lon0) * kx, (la - lat0) * ky])

  // Recta previa para la pasada
  const DRAG_LEN = 400
  if (drag) {
    const [x1, y1] = pts.find(([x, y]) => Math.hypot(x, y) > 20) || pts[1]
    const m = Math.hypot(x1, y1)
    pts = [[(-x1 / m) * DRAG_LEN, (-y1 / m) * DRAG_LEN], ...pts]
  }

  // Cada metro y suavizado (las carreteras no tienen esquinas)
  const dense = []
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[i + 1]
    const L = Math.hypot(bx - ax, by - ay)
    const k = Math.max(1, Math.round(L))
    for (let j = 0; j < k; j++) dense.push([ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k])
  }
  dense.push(pts.at(-1))
  let xs = movAvg(dense.map((p) => p[0]), 12)
  let ys = movAvg(dense.map((p) => p[1]), 12)
  xs = movAvg(xs, 12)
  ys = movAvg(ys, 12)
  // Remuestreo a 1 m por longitud de arco
  const X = [xs[0]]
  const Y = [ys[0]]
  let carry = 0
  for (let i = 1; i < xs.length; i++) {
    let seg = Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
    let ax = xs[i - 1]
    let ay = ys[i - 1]
    while (carry + seg >= 1) {
      const f = (1 - carry) / seg
      ax += (xs[i] - ax) * f
      ay += (ys[i] - ay) * f
      X.push(ax)
      Y.push(ay)
      seg = Math.hypot(xs[i] - ax, ys[i] - ay)
      carry = 0
    }
    carry += seg
  }
  const N = X.length
  const s = X.map((_, i) => i)
  // Rumbo (° desde el norte, + horario) y curvatura (rad/m, + derecha)
  const psi = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 1)
    const b = Math.min(N - 1, i + 1)
    psi[i] = Math.atan2(X[b] - X[a], Y[b] - Y[a])
  }
  for (let i = 1; i < N; i++) {
    let d = psi[i] - psi[i - 1]
    d = ((d + 3 * Math.PI) % (2 * Math.PI)) - Math.PI
    psi[i] = psi[i - 1] + d
  }
  const kap = movAvg(Array.from(psi, (_, i) => (i > 0 && i < N - 1 ? (psi[i + 1] - psi[i - 1]) / 2 : 0)), 6)

  // Velocidad: límite por curva y carretera, aceleración y frenada limitadas, paradas
  const dragEnd = drag ? 300 : -1
  const stops = drag ? [{ i: 0, dwell: 8 }, { i: dragEnd, dwell: 6 }, { i: N - 1, dwell: 5 }] : [{ i: 0, dwell: 5 }, { i: N - 1, dwell: 5 }]
  const vlim = kap.map((k, i) => (i <= dragEnd ? 40 : Math.min(vRoad, Math.sqrt((aLat * G) / Math.max(Math.abs(k), 1e-6)))))
  for (const st of stops) vlim[st.i] = 0
  const accel = (i, v) => (i < dragEnd ? 9.5 * (1 - v / 70) : Math.max(0.5, Math.min(3.2, 6 * (1 - v / 45))))
  const brake = (i) => (i <= dragEnd ? 7.5 : 4.5)
  const V = new Float64Array(N)
  for (let i = 1; i < N; i++) V[i] = Math.min(vlim[i], Math.sqrt(V[i - 1] ** 2 + 2 * accel(i - 1, V[i - 1])))
  for (let i = N - 2; i >= 0; i--) V[i] = Math.min(V[i], Math.sqrt(V[i + 1] ** 2 + 2 * brake(i)))

  // Tiempo de paso por cada metro; en las paradas el punto se repite con la espera
  const tt = []
  const ss = []
  const vv = []
  let t = 0
  for (let i = 0; i < N; i++) {
    if (i) t += 1 / Math.max(0.05, (V[i] + V[i - 1]) / 2)
    tt.push(t)
    ss.push(i)
    vv.push(V[i])
    const st = stops.find((q) => q.i === i)
    if (st) {
      t += st.dwell
      tt.push(t)
      ss.push(i)
      vv.push(0)
    }
  }
  const tEnd = t
  let cur = 0
  const at = (tau) => {
    if (tau <= tt[0]) cur = 0
    while (cur < tt.length - 2 && tt[cur + 1] < tau) cur++
    while (cur > 0 && tt[cur] > tau) cur--
    const a = tt[cur]
    const b = tt[cur + 1] ?? a
    const f = b > a ? Math.max(0, Math.min(1, (tau - a) / (b - a))) : 0
    const sv = ss[cur] + (ss[cur + 1] - ss[cur]) * f
    const v = vv[cur] + (vv[cur + 1] - vv[cur]) * f
    const i = Math.min(N - 2, Math.floor(sv))
    const g = sv - i
    const k = kap[i] + (kap[i + 1] - kap[i]) * g
    return {
      s: sv,
      v,
      x: X[i] + (X[i + 1] - X[i]) * g,
      y: Y[i] + (Y[i + 1] - Y[i]) * g,
      psi: psi[i] + (psi[i + 1] - psi[i]) * g,
      kappa: k,
      // v·dv/ds con la diferencia de v²/2: exacta con aceleración constante, sin picos al salir o parar
      a: ss[cur + 1] === ss[cur] ? 0 : (V[i + 1] ** 2 - V[i] ** 2) / 2, // parado esperando: 0
      lean: Math.atan((v * v * k) / G),
      alt: 20 + 15 * Math.sin(sv / 700) + 8 * Math.sin(sv / 230),
    }
  }

  // GPS a 1 Hz
  const gps = []
  let ex = 0
  let ey = 0
  for (let tau = 0; tau <= tEnd; tau += 1) {
    const S = at(tau)
    ex = ex * 0.9 + R.gauss() * 0.5
    ey = ey * 0.9 + R.gauss() * 0.5
    const v = Math.max(0, S.v + R.gauss() * 0.08)
    const hdg = S.v > 1 ? ((((S.psi / RAD + R.gauss() * 0.8) % 360) + 360) % 360) : NaN
    gps.push(tau, start + tau * 1000, lat0 + (S.y + ey) / ky, lon0 + (S.x + ex) / kx, 3.5 + R.uni() * 1.5, S.alt + R.gauss() * 1.2, 4, v, hdg, v, hdg)
  }

  // Sensores: fuerza específica, aceleración sin gravedad y giro en ejes de la moto (adelante F,
  // derecha R, arriba U) pasados a los del móvil: x = R, y = cosθ·U + senθ·F, z = −cosθ·F + senθ·U
  const th = tilt * RAD
  const toPhone = ([f, r, u]) => [r, Math.cos(th) * u + Math.sin(th) * f, -Math.cos(th) * f + Math.sin(th) * u]
  const sgn = invert ? -1 : 1
  const bias = [R.gauss() * 0.4, R.gauss() * 0.4, R.gauss() * 0.4]
  const imuRows = []
  if (imu) {
    const dtI = 1 / imuHz
    for (let tau = 0; tau <= tEnd; tau += dtI) {
      const S = at(tau)
      const S2 = at(tau + 0.02)
      const phiDot = (S2.lean - S.lean) / 0.02
      const yawRate = S.v * S.kappa
      const vibA = 0.4 + S.v / 25
      const sf = toPhone([S.a, 0, G / Math.cos(S.lean)])
      const lin = toPhone([S.a, yawRate * Math.cos(S.lean) * S.v, yawRate * Math.sin(S.lean) * S.v])
      const w = toPhone([phiDot, yawRate * Math.sin(S.lean), -yawRate * Math.cos(S.lean)]).map((x) => x / RAD)
      imuRows.push(
        tau,
        sgn * sf[0] + R.gauss() * vibA,
        sgn * sf[1] + R.gauss() * vibA,
        sgn * sf[2] + R.gauss() * vibA,
        sgn * lin[0] + R.gauss() * vibA,
        sgn * lin[1] + R.gauss() * vibA,
        sgn * lin[2] + R.gauss() * vibA,
        w[2] + bias[2] + R.gauss() * 0.6,
        w[0] + bias[0] + R.gauss() * 0.6,
        w[1] + bias[1] + R.gauss() * 0.6,
      )
    }
  }

  // Lo que habría calculado la app (con sus retrasos)
  const calc = []
  let cl = 0
  let cg = 0
  for (let tau = 0; tau <= tEnd; tau += 0.1) {
    const S = at(tau)
    cg += (S.a / G - cg) * (0.1 / 0.7)
    cl += (S.lean / RAD - cl) * (0.1 / 0.22)
    calc.push(tau, S.v, cg, Math.sin(S.lean), cl)
  }

  // Pasada del crono
  const ev = []
  if (drag) {
    const tLaunch = stops[0].dwell
    const marks = {}
    const find = (fn) => {
      for (let tau = tLaunch; tau < tLaunch + 30; tau += 0.005) if (fn(at(tau))) return Math.round((tau - tLaunch) * 1000) / 1000
      return null
    }
    const dist = (m) => (S) => S.s >= m
    for (const [id, f] of [['k0-50', (S) => S.v >= 50 / 3.6], ['k0-100', (S) => S.v >= 100 / 3.6], ['60ft', dist(18.288)], ['330ft', dist(100.584)], ['1/8', dist(201.168)]]) {
      const tm = find(f)
      if (tm != null) marks[id] = tm
    }
    ev.push({ type: 'launch', t: tLaunch }, { type: 'run', t: tLaunch, id: 'demo-run', marks, maxV: Math.max(...V.slice(0, dragEnd)) })
  }

  let vmax = 0
  for (let i = 0; i < N; i++) vmax = Math.max(vmax, V[i])
  const g = new Float64Array(gps)
  const im = new Float32Array(imuRows)
  const ca = new Float32Array(calc)
  const meta = {
    id: `demo-${seed}${invert ? 'i' : ''}${imu ? '' : 'g'}`,
    format: FORMAT,
    state: 'done',
    start,
    end: start + Math.round(tEnd * 1000),
    updated: start + Math.round(tEnd * 1000),
    source: 'demo',
    sim: null,
    calib: { leanZero: null, gyroSign: null },
    rider: { bike: 'Moto inventada', units: 'kmh' },
    device: { ua: 'Salida inventada para la demo', screen: null, orientation: 'portrait-primary', standalone: true },
    chunks: 1,
    bytes: g.byteLength + im.byteLength + ca.byteLength,
    rows: { gps: g.length / 11, imu: im.length / 10, calc: ca.length / 5, ev: ev.length },
    dist: N - 1,
    moving: tEnd - stops.reduce((q, st) => q + st.dwell, 0),
    vmax,
    imuInterval: imu ? 1000 / imuHz : null,
    resumed: 0,
  }
  return { meta, gps: g, imu: im, calc: ca, ev, truth: { at, dist: N - 1, vmax, tEnd } }
}

/** Archivo de exportación (el mismo formato que saca la app) con estas sesiones. */
export function exportJson(sessions) {
  return JSON.stringify({
    app: 'streetchaos',
    format: 'streetchaos-export',
    version: 1,
    id: 'demo',
    exportedAt: new Date().toISOString(),
    device: { ua: 'demo', screen: null, viewport: null },
    settings: { units: 'kmh' },
    totals: {},
    runs: [],
    races: [],
    telemetry: {
      format: FORMAT,
      streams: STREAMS,
      sessions: sessions.map((s) => ({ ...s.meta, events: s.ev, gps: toBase64(s.gps), imu: toBase64(s.imu), calc: toBase64(s.calc) })),
    },
  })
}
