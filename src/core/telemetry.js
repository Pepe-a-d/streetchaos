// Telemetría: recibe muestras de la fuente GPS (real o simulada) y del acelerómetro/giroscopio
// y calcula lo que enseña el dashboard: velocidad, máximos, viaje, rumbo, G y ángulo de inclinación.

import { haversine, bearing, headingDelta } from './geo.js'
import { G } from './perf.js'
import { settings, setSetting, totals, saveTotals } from './store.js'
import { isIOS } from './device.js'
import { dot, norm, orthoTo, angleBetween, gyroVec, screenRight, leanAngle, rightFrom, defaultAxes, defaultConv } from './mount.js'

const now = () => performance.now() / 1000
const ema = (prev, x, dt, tau) => (prev == null ? x : prev + (x - prev) * Math.min(1, dt / (tau + dt)))
const emaV = (prev, x, dt, tau) => (prev ? [ema(prev[0], x[0], dt, tau), ema(prev[1], x[1], dt, tau), ema(prev[2], x[2], dt, tau)] : [...x])
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const DEG = Math.PI / 180
const IOS = (() => {
  try {
    return isIOS()
  } catch {
    return false
  }
})()

// Retraso del GPS del móvil (s): el iPhone entrega cada posición ~1 s después del momento al que
// corresponde (medido en la primera salida: el acelerómetro y el giroscopio cuadran con el GPS
// adelantado 1,0-1,2 s). Se le resta a la hora de cada muestra para que el GPS y los sensores vayan
// en el mismo reloj (salida del crono, curva de velocidad). En otros móviles no está medido: 0.
export const gpsLag = () => (Number.isFinite(settings.gpsLag) ? settings.gpsLag : IOS ? 1 : 0)

export const T = {
  source: null,
  status: 'off', // off | waiting | ok | lost | denied | error
  error: '',
  fix: null,
  v: 0,
  // La velocidad viene del GPS (Doppler). Si el móvil no la da, no se inventa con las posiciones:
  // se mantiene un momento la última o se pone a 0, y esa muestra no cuenta para récords, G ni giros.
  vOk: true,
  vDisp: 0,
  maxV: 0,
  trip: 0,
  tripTime: 0,
  alt: null,
  heading: null,
  hz: 0,
  acc: null,
  gLong: 0,
  gLat: 0,
  gMax: 0,
  brakeMax: 0, // la frenada más fuerte del viaje (g, positiva)
  lean: 0,
  leanMaxL: 0,
  leanMaxR: 0,
  yawGps: 0,
  motion: false,
  gyro: false,
  // Permiso del acelerómetro: unknown | granted | denied | tap (hay que pedirlo en un toque) | unsupported
  motionPerm: 'unknown',
}

const sampleSubs = new Set()
const hintSubs = new Set()
const rawSubs = new Set()
const accelSubs = new Set()
export const onSample = (fn) => (sampleSubs.add(fn), () => sampleSubs.delete(fn))
export const onHint = (fn) => (hintSubs.add(fn), () => hintSubs.delete(fn))
/** Cada evento devicemotion tal cual, con su hora (para la caja negra). */
export const onRawMotion = (fn) => (rawSubs.add(fn), () => rawSubs.delete(fn))
/** Aceleración hacia delante del acelerómetro (m/s², ~10 por segundo) cuando ya se sabe dónde es «delante». */
export const onAccel = (fn) => (accelSubs.add(fn), () => accelSubs.delete(fn))

let lastFixAt = 0

export function useSource(src) {
  T.source?.stop()
  T.source = src
  T.status = 'waiting'
  T.error = ''
  T.fix = null
  src.start(handleSample, (err) => {
    T.status = err?.code === 1 ? 'denied' : 'error'
    T.error = err?.message || 'Error de GPS'
  })
}

export function resetTrip() {
  T.trip = 0
  T.tripTime = 0
  T.maxV = 0
  T.gMax = 0
  T.brakeMax = 0
  T.leanMaxL = 0
  T.leanMaxR = 0
}

function handleSample(s) {
  const p = T.fix
  if (p && s.t <= p.t) return
  const dt = p ? s.t - p.t : 1
  const ok = s.vOk !== false
  const okBoth = ok && p?.vOk !== false
  // Rumbo: el del GPS si va en marcha; si no, el de la posición (solo con velocidad de verdad)
  if (s.heading == null && p && ok && s.v > 3 && haversine(p.lat, p.lon, s.lat, s.lon) > 3) s.heading = bearing(p.lat, p.lon, s.lat, s.lon)
  if (p && dt < 5) {
    T.hz = ema(T.hz || 1 / dt, 1 / dt, 1, 3)
    const ds = ((p.v + s.v) / 2) * dt
    if (s.v > 1 && s.acc < 40) {
      T.trip += ds
      T.tripTime += dt
      totals.odo += ds
      totals.time = (totals.time || 0) + dt
    }
    // G longitudinal del GPS solo si el acelerómetro todavía no sabe dónde es «delante»
    if (!accelReady()) T.gLong = okBoth ? ema(T.gLong, clamp((s.v - p.v) / dt / G, -1.2, 1.2), dt, 0.6) : ema(T.gLong, 0, dt, 0.6)
    if (okBoth && p.heading != null && s.heading != null && s.v > 3) {
      const yaw = (headingDelta(p.heading, s.heading) * Math.PI) / 180 / dt
      T.yawGps = ema(T.yawGps, yaw, dt, 0.5)
      alignGyro(p, s, yaw)
      learnLeanSign(p, s, yaw)
      confirmRecords(p, s, yaw)
    } else T.yawGps = ema(T.yawGps, 0, dt, 0.5)
    if (okBoth && dt <= 1.6) learnForward(p, s)
  }
  T.fix = s
  T.v = s.v
  T.vOk = ok
  T.acc = s.acc
  T.alt = Number.isFinite(s.alt) ? s.alt : T.alt
  if (s.heading != null && s.v > 1.5) T.heading = s.heading
  if (ok && s.acc < 25) {
    T.maxV = Math.max(T.maxV, s.v)
    totals.maxV = Math.max(totals.maxV, s.v)
  }
  if (!T.motion) updateLean(dt)
  T.status = 'ok'
  lastFixAt = now()
  saveTotals()
  for (const fn of sampleSubs) fn(s)
}

setInterval(() => {
  if (T.status === 'ok' && now() - lastFixAt > 4) T.status = 'lost'
}, 1000)

/** Barras de cobertura según la precisión. */
export function signalBars() {
  if (T.status !== 'ok' || T.acc == null) return 0
  return T.acc <= 5 ? 4 : T.acc <= 10 ? 3 : T.acc <= 20 ? 2 : T.acc <= 50 ? 1 : 0
}

/**
 * Llamar en cada frame: velocidad suavizada y llevada al momento actual. La última muestra del GPS es
 * de hace un rato (el retraso del móvil más lo que lleve desde que llegó): se adelanta con la G de ahora.
 */
export function tick(dt) {
  let target = T.v
  if (T.fix && T.status === 'ok') {
    const ahead = clamp(now() - T.fix.t, 0, 2.5)
    target = Math.max(0, T.v + T.gLong * G * ahead * 0.8)
  }
  T.vDisp += (target - T.vDisp) * Math.min(1, dt * 7)
  if (T.vDisp < 0.05) T.vDisp = 0
}

// ---------- Acelerómetro y giroscopio ----------
//
// La inclinación sale de la GRAVEDAD que calcula el propio móvil, que combina acelerómetro y giroscopio
// (accelerationIncludingGravity - acceleration): es el giro de la vertical del mundo alrededor del eje
// de avance de la moto. Vale parado y en marcha y no necesita el GPS. En la primera salida real coincidió
// con la física de la curva (sen φ = v·giro/g) dentro de ±4°.
//
// Postura del móvil en el soporte (ajuste `mount`, se guarda):
// - up: la vertical de la moto recta vista por el móvil. Al poner a cero, o sola: se toma al empezar y se
//   afina mientras vas en recta (en recta la moto va derecha). Si mueves el móvil en el soporte, se rehace.
// - right: el eje lateral. Sale del «delante» aprendido (al acelerar y frenar el acelerómetro lo marca) y,
//   mientras no se sabe, de si el móvil iba en vertical u horizontal al calibrar. NO sigue a la pantalla
//   en marcha: al tumbar, el iPhone puede girar la pantalla, y antes el inclinómetro cambiaba de sentido y
//   volvía hacia atrás. Solo se mira la pantalla con la moto parada.
// - fwd: el «delante», con la evidencia acumulada (S, W, N).

const saved = settings.mount && Array.isArray(settings.mount.up) ? settings.mount : null
const M = {
  conv: Number.isFinite(settings.gravConv) ? settings.gravConv : defaultConv(IOS),
  // En el iPhone los ejes del giroscopio ya se saben (alpha = x, beta = y, gamma = z): no se aprenden.
  // El 10-11-2026 la app los cambió sola en marcha y el inclinómetro fue al revés 9 minutos
  axes: IOS ? 'xyz' : settings.gyroAxes || defaultAxes(IOS),
  // Giro sobre la vertical del mundo: con la regla de la mano derecha una curva a derecha es negativa
  sign: Number.isFinite(settings.yawSign) ? settings.yawSign : -1,
  leanSign: Number.isFinite(settings.leanSign) ? settings.leanSign : 1,
  // El sentido ya se ha comprobado con una curva del GPS (hasta entonces la inclinación no hace récords)
  leanSure: Number.isFinite(settings.leanSign),
  against: 0, // segundos de curvas que dicen que el sentido ya comprobado está al revés
  g: null, // gravedad del móvil (su convenio), suavizada
  sys: false, // la gravedad es la del sistema (hay aceleración sin gravedad)
  wu: null, // vertical del mundo (unitaria, hacia arriba)
  acc: null, // aceleración sin gravedad, física (m/s²), suavizada
  up: saved?.up ?? null,
  right: saved?.right ?? null,
  angle: saved?.angle ?? null, // giro de pantalla con el que se eligió `right`
  fwd: saved?.fwd ?? null,
  S: saved?.S ?? [0, 0, 0],
  W: saved?.W ?? 0,
  N: saved?.N ?? 0,
  rawLean: 0,
  leanCorr: 0,
  yaw: 0,
  // Historia de los últimos segundos: [t, inclinación sin signo, giro w3c, giro xyz, inclinación, G long].
  // El GPS llega tarde
  // (el iPhone, ~1 s): su giro hay que compararlo con lo que hacían los sensores en ESE rato, no ahora.
  // Antes se comparaba con lo de ahora y en una curva en S (izquierda y enseguida derecha) salía al revés
  hist: [],
  mountAt: -Infinity, // cuándo se rehízo la postura (justo después, la inclinación no hace récords)
  corr: { w3c: 0, xyz: 0 },
  corrE: 0,
  last: 0,
  over: null,
  cool: 0,
  movedFor: 0,
  wildFor: 0,
  turnFor: 0,
  dirty: false,
  savedAt: 0,
  bins: [], // aceleración física en cajas de 0,1 s: [t, x, y, z, n]
  lastAccelOut: 0,
}

/** iPhone y iPad piden permiso para el acelerómetro, y solo dentro de un toque. */
export const motionNeedsTap = () => typeof window.DeviceMotionEvent?.requestPermission === 'function'

let motionOn = false
let asking = null
/**
 * Empieza a escuchar el acelerómetro. En iPhone pide permiso, y eso solo funciona dentro de un toque
 * de verdad: al levantar el dedo («pointerup», «click», «touchend»), no al apoyarlo («pointerdown»).
 * Fuera de un toque iOS lo rechaza sin preguntar: queda en «tap» para reintentarlo en el siguiente.
 */
export function requestMotion() {
  const DM = window.DeviceMotionEvent
  if (!DM) {
    T.motionPerm = 'unsupported'
    return Promise.resolve(false)
  }
  if (motionOn) return Promise.resolve(true)
  asking ??= (async () => {
    if (motionNeedsTap()) {
      let r
      try {
        r = await DM.requestPermission()
      } catch {
        T.motionPerm = 'tap'
        return false
      }
      if (r !== 'granted') {
        T.motionPerm = 'denied'
        return false
      }
    }
    window.addEventListener('devicemotion', onMotion)
    motionOn = true
    T.motionPerm = 'granted'
    return true
  })().finally(() => (asking = null))
  return asking
}

const fin = (o) => o && Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.z)
const accelReady = () => !!(M.fwd && M.sys && T.motion)

function screenAngle() {
  try {
    if (typeof screen !== 'undefined' && Number.isFinite(screen.orientation?.angle)) return screen.orientation.angle
    if (typeof window !== 'undefined' && Number.isFinite(window.orientation)) return window.orientation
  } catch {}
  return 0
}

function onMotion(e) {
  const ag = e.accelerationIncludingGravity
  if (!fin(ag)) return
  const t = now()
  const dt = clamp(t - (M.last || t - 0.016), 0.004, 0.1)
  M.last = t
  T.motion = true
  for (const fn of rawSubs) fn(e, t)
  const a = e.acceleration
  const sys = fin(a)
  // Gravedad: la que calcula el sistema si da la aceleración sin gravedad; si no, la aparente suavizada
  // (que en las curvas se alinea con la moto: de lado solo vale parado)
  if (sys !== M.sys) M.g = null
  M.sys = sys
  M.g = emaV(M.g, sys ? [ag.x - a.x, ag.y - a.y, ag.z - a.z] : [ag.x, ag.y, ag.z], dt, sys ? 0.05 : 0.4)
  const wu = norm([M.conv * M.g[0], M.conv * M.g[1], M.conv * M.g[2]])
  if (!wu) return
  M.wu = wu
  if (!M.up) initMount(wu)

  // Aceleración del piloto (sin gravedad), en el sentido físico
  const lin = sys ? [M.conv * a.x, M.conv * a.y, M.conv * a.z] : null
  if (lin) {
    M.acc = emaV(M.acc, lin, dt, 0.1)
    addBin(t, lin)
  }

  // Giro alrededor de la vertical (rad/s), con las dos asignaciones de ejes para descubrir la buena
  const rr = e.rotationRate
  let w = null
  if (rr && Number.isFinite(rr.alpha) && Number.isFinite(rr.beta) && Number.isFinite(rr.gamma)) {
    T.gyro = true
    w = { w3c: dot(gyroVec(rr, 'w3c'), wu) * DEG, xyz: dot(gyroVec(rr, 'xyz'), wu) * DEG }
    M.yaw = ema(M.yaw, w[M.axes], dt, 0.12)
  }

  // G longitudinal del acelerómetro (al momento y sin el retraso del GPS) cuando ya se sabe dónde es delante
  if (accelReady() && M.acc) {
    const f = dot(M.acc, M.fwd)
    T.gLong = ema(T.gLong, f / G, dt, 0.25)
    if (t - M.lastAccelOut >= 0.1) {
      M.lastAccelOut = t
      for (const fn of accelSubs) fn(t, f)
    }
  }

  // Tirón de salida (para el crono): aceleración media; hacia delante si ya se sabe
  const push = M.acc ? (accelReady() ? dot(M.acc, M.fwd) : Math.hypot(...M.acc)) / G : 0
  if (push > 0.18) {
    M.over ??= t
    if (t - M.over > 0.1 && t > M.cool) {
      M.cool = t + 1.5
      for (const fn of hintSubs) fn(M.over - 0.05)
    }
  } else M.over = null

  updateMount(dt, t)
  updateLean(dt)
  remember(t, w)
}

/** Apunta la inclinación y el giro de ahora (cada 0,05 s, los últimos 8 s). */
function remember(t, w) {
  const h = M.hist
  if (h.length && t - h[h.length - 1][0] < 0.05) return
  h.push([t, M.rawLean, w ? w.w3c : NaN, w ? w.xyz : NaN, T.lean, T.gLong])
  while (h.length && t - h[0][0] > 8) h.shift()
}

/** Media de la columna k de la historia entre t0 y t1 (null si no hay bastante). */
function histMean(t0, t1, k) {
  let s = 0
  let n = 0
  for (const r of M.hist) if (r[0] >= t0 - 0.03 && r[0] <= t1 + 0.03 && Number.isFinite(r[k])) (s += r[k]), n++
  return n >= 3 ? s / n : null
}

/** Postura de partida: la vertical de ahora y el lateral según cómo va la pantalla. */
function initMount(wu) {
  M.up = [...wu]
  M.angle = screenAngle()
  M.right = orthoTo(screenRight(M.angle), M.up) || orthoTo([1, 0, 0], M.up)
  M.fwd = null
  M.S = [0, 0, 0]
  M.W = 0
  M.N = 0
  M.dirty = true
  M.mountAt = now()
}

function updateMount(dt, t) {
  const v = T.v
  const ang = angleBetween(M.wu, M.up)
  // ¿Has movido el móvil en el soporte? Parado, más de 35° fuera de su vertical durante 2 s
  // (la pata de cabra tumba unos 10-15°); en marcha, más de 75° durante 3 s
  if (v < 0.5) {
    M.movedFor = ang > 35 * DEG ? M.movedFor + dt : 0
    M.wildFor = 0
  } else {
    M.wildFor = ang > 75 * DEG ? M.wildFor + dt : 0
    M.movedFor = 0
  }
  if (M.movedFor > 2 || M.wildFor > 3) {
    initMount(M.wu)
    M.movedFor = M.wildFor = 0
  }
  // En recta y rápido la moto va derecha: la vertical se afina sola (en ~30 s de recta)
  const straight = T.vOk && v > 8 && Math.abs(T.yawGps) < 0.03 && Math.abs(M.yaw) < 0.05 && ang < 15 * DEG
  if (straight) {
    const k = dt / 30
    M.up = norm([M.up[0] + (M.wu[0] - M.up[0]) * k, M.up[1] + (M.wu[1] - M.up[1]) * k, M.up[2] + (M.wu[2] - M.up[2]) * k])
    M.right = orthoTo(M.right, M.up) || M.right
    M.dirty = true
  }
  // Sin «delante» aprendido, el lateral sigue a la pantalla, pero solo con la moto parada y la pantalla
  // quieta 2 s: en marcha no, que al tumbar el iPhone puede girarla
  if (!M.fwd && v < 0.5) {
    const a = screenAngle()
    if (a !== M.angle) {
      M.turnFor += dt
      if (M.turnFor > 2) {
        M.angle = a
        M.right = orthoTo(screenRight(a), M.up) || M.right
        M.turnFor = 0
        M.dirty = true
      }
    } else M.turnFor = 0
  } else M.turnFor = 0
  if (M.dirty && t - M.savedAt > 30) saveMount(t)
}

function saveMount(t = now()) {
  M.dirty = false
  M.savedAt = t
  const r3 = (a) => a && a.map((x) => Math.round(x * 1e5) / 1e5)
  setSetting('mount', { up: r3(M.up), right: r3(M.right), angle: M.angle, fwd: r3(M.fwd), S: r3(M.S), W: Math.round(M.W * 100) / 100, N: M.N })
}

// Aceleración en cajas de 0,1 s de los últimos segundos (para compararla con la del GPS)
function addBin(t, a) {
  const k = Math.floor(t * 10)
  const b = M.bins[M.bins.length - 1]
  if (b && b[0] === k) {
    b[1] += a[0]
    b[2] += a[1]
    b[3] += a[2]
    b[4]++
  } else {
    M.bins.push([k, a[0], a[1], a[2], 1])
    if (M.bins.length > 80) M.bins.shift()
  }
}
function meanAccel(t0, t1) {
  let s = [0, 0, 0]
  let n = 0
  for (const b of M.bins) {
    const t = (b[0] + 0.5) / 10
    if (t < t0 || t > t1) continue
    s = [s[0] + b[1], s[1] + b[2], s[2] + b[3]]
    n += b[4]
  }
  return n > 10 ? s.map((x) => x / n) : null
}

/**
 * Aprende dónde es «delante»: la aceleración del GPS entre dos muestras frente a la media del
 * acelerómetro en ese mismo rato (ya en el mismo reloj, por el retraso descontado). Con unas cuantas
 * acelerones y frenadas la vibración se anula y queda el eje de avance.
 */
function learnForward(p, s) {
  if (!T.motion || !M.sys || !M.up) return
  const aG = (s.v - p.v) / (s.t - p.t)
  if (Math.abs(aG) < 0.4 || Math.abs(aG) > 12) return
  const m = meanAccel(p.t, s.t)
  if (!m) return
  M.S = [M.S[0] * 0.998 + aG * m[0], M.S[1] * 0.998 + aG * m[1], M.S[2] * 0.998 + aG * m[2]]
  M.W = M.W * 0.998 + aG * aG
  M.N++
  M.dirty = true
  if (M.N < 12 || M.W < 25) return
  // Tiene que ser sobre todo horizontal (si no, es ruido)
  const sl = Math.hypot(...M.S)
  const f = orthoTo(M.S, M.up)
  if (!f || sl === 0 || Math.abs(dot(M.S, M.up)) / sl > 0.6) return
  const first = !M.fwd
  M.fwd = f
  const r = rightFrom(f, M.up)
  if (!r) return
  // Si el lateral nuevo apunta al revés que el que había, el signo aprendido con el viejo se da la vuelta
  if (M.right && dot(r, M.right) < 0) {
    M.leanSign = -M.leanSign
    M.leanCorr = -M.leanCorr
    setSetting('leanSign', M.leanSign)
  }
  M.right = r
  if (first) saveMount()
}

/**
 * El signo de la inclinación se comprueba con las curvas del GPS: girando a la derecha, tumbas a la
 * derecha. El giro es el de entre dos posiciones (p → s, ya en el reloj de los sensores) y la
 * inclinación, la de ese mismo rato. Una vez comprobado, solo se da la vuelta si muchas curvas seguidas
 * dicen lo contrario (antes bastaba una curva en S).
 */
function learnLeanSign(p, s, yaw) {
  if (!T.motion || !T.vOk || s.v < 6 || Math.abs(yaw) < 0.08) return
  const lean = histMean(p.t, s.t, 1)
  if (lean == null || Math.abs(lean) < 5 * DEG) return
  const dt = Math.min(2, s.t - p.t)
  if (!M.leanSure) {
    M.leanCorr = M.leanCorr * 0.97 + lean * yaw
    if (Math.abs(M.leanCorr) > 0.15) {
      M.leanSign = M.leanCorr > 0 ? 1 : -1
      M.leanSure = true
      M.against = 0
      setSetting('leanSign', M.leanSign)
    }
    return
  }
  const agree = Math.sign(lean * yaw) === M.leanSign
  M.against = agree ? Math.max(0, M.against - 2 * dt) : M.against + dt
  if (M.against > 8) {
    M.leanSign = -M.leanSign
    M.leanCorr = -M.leanCorr
    M.against = 0
    setSetting('leanSign', M.leanSign)
  }
}

/**
 * Ejes y signo del giroscopio: el que se parece al giro que marca el GPS entre dos posiciones (con lo que
 * medía el giroscopio en ese mismo rato). En el iPhone los ejes ya se saben: solo el signo.
 */
function alignGyro(p, s, yaw) {
  if (!T.gyro) return
  const avg = { w3c: histMean(p.t, s.t, 2), xyz: histMean(p.t, s.t, 3) }
  if (avg.w3c == null || avg.xyz == null) return
  if (!T.vOk || s.v < 4 || Math.abs(yaw) < 0.05) return
  for (const k of ['w3c', 'xyz']) M.corr[k] = M.corr[k] * 0.95 + avg[k] * yaw
  M.corrE = M.corrE * 0.95 + yaw * yaw
  if (M.corrE < CORR_SURE) return
  const best = IOS || Math.abs(M.corr.xyz) > Math.abs(M.corr.w3c) ? 'xyz' : 'w3c'
  const other = best === 'xyz' ? 'w3c' : 'xyz'
  // Solo con una diferencia clara, para que unas muestras raras no lo cambien
  if ((!IOS && Math.abs(M.corr[best]) < 2 * Math.abs(M.corr[other])) || Math.abs(M.corr[best]) / M.corrE < 0.3) return
  const sign = M.corr[best] > 0 ? 1 : -1
  if (best !== M.axes) {
    M.axes = best
    setSetting('gyroAxes', best)
  }
  if (sign !== M.sign) {
    M.sign = sign
    setSetting('yawSign', sign)
  }
}

const CORR_SURE = 0.03 // (rad/s)²: un par de segundos de curva clara

function updateLean(dt) {
  const v = T.v
  let lean
  if (T.motion && M.wu && M.up && M.right) {
    const grav = leanAngle(M.wu, M.up, M.right)
    if (M.sys) lean = grav
    else {
      // Sin la gravedad del sistema: en marcha, la física de la curva con el giroscopio
      // (sobre la vertical aparente, que va con la moto: sen φ = v·giro/g)
      const k = smooth(4, 8, v)
      const dyn = Math.asin(clamp((v * M.sign * M.yaw) / G, -0.97, 0.97))
      lean = k * dyn + (1 - k) * grav
    }
    M.rawLean = lean
    lean *= M.leanSign
  } else {
    // Solo GPS: el giro del rumbo es el del mundo (tan φ = v·giro/g); despacio el rumbo es ruido
    lean = Math.atan(clamp((v * T.yawGps) / G, -1.2, 1.2)) * smooth(4, 8, v)
  }
  T.lean = ema(T.lean, lean, dt, 0.1)
  // G lateral de la curva (en una curva redonda, tan φ); parado no la hay aunque la moto esté tumbada
  T.gLat = Math.tan(clamp(T.lean, -1.2, 1.2)) * smooth(3, 8, v)
  // Solo con GPS la inclinación sale del propio GPS: récords al momento. Con sensores se confirman al
  // llegar la posición de ese rato (confirmRecords)
  if (T.motion) return
  const deg = (T.lean * 180) / Math.PI
  if (v > 5 && T.vOk && Math.abs(deg) < 65) record(deg, Math.hypot(T.gLat, T.gLong), -T.gLong)
}

function record(deg, gt, brake = 0) {
  if (brake > 0 && brake < 1.6) T.brakeMax = Math.max(T.brakeMax, brake)
  if (deg < 0) T.leanMaxL = Math.max(T.leanMaxL, -deg)
  else T.leanMaxR = Math.max(T.leanMaxR, deg)
  totals.maxLeanL = Math.max(totals.maxLeanL, T.leanMaxL)
  totals.maxLeanR = Math.max(totals.maxLeanR, T.leanMaxR)
  if (gt < 1.6) {
    T.gMax = Math.max(T.gMax, gt)
    totals.maxG = Math.max(totals.maxG, gt)
  }
}

/**
 * Récords de inclinación y G con sensores: los de entre dos posiciones (p → s), cuando ya se sabe qué
 * curva trazaba la moto en ese rato. Si el móvil marcaba 20° más de lo que pide la curva (tan φ = v·giro/g),
 * no era la moto: se estaba colocando o iba en la mano (el 9-11-2026 apuntó 64,7° y 1,23 G así). También
 * hace falta el sentido comprobado y el móvil quieto en el soporte desde hace 10 s.
 */
function confirmRecords(p, s, yaw) {
  if (!T.motion || s.vOk === false || p.vOk === false || !(p.v > 5 && s.v > 5) || !M.leanSure || now() - M.mountAt <= 10) return
  const curve = Math.atan((Math.abs(yaw) * (p.v + s.v)) / 2 / G)
  const vMid = (p.v + s.v) / 2
  let best = null
  for (const r of M.hist) {
    if (r[0] < p.t - 0.03 || r[0] > s.t + 0.03) continue
    const lean = r[4]
    if (!Number.isFinite(lean) || Math.abs(lean) > curve + 20 * DEG || Math.abs(lean) > 65 * DEG) return
    const gt = Math.hypot(Math.tan(lean) * smooth(3, 8, vMid), Number.isFinite(r[5]) ? r[5] : 0)
    if (!best) best = { L: 0, R: 0, g: 0, b: 0 }
    if (lean < 0) best.L = Math.max(best.L, -lean)
    else best.R = Math.max(best.R, lean)
    best.g = Math.max(best.g, gt)
    if (Number.isFinite(r[5])) best.b = Math.max(best.b, -r[5])
  }
  if (!best) return
  if (best.L) record(-best.L / DEG, best.g, best.b)
  if (best.R) record(best.R / DEG, best.g, best.b)
  if (!best.L && !best.R) record(0, best.g, best.b)
}

/** Pone a cero la inclinación con la moto recta: guarda la vertical de ahora (y el lateral, si hace falta). */
export function zeroLean() {
  if (!M.wu) return false
  M.up = [...M.wu]
  if (M.fwd) M.right = rightFrom(orthoTo(M.fwd, M.up) || M.fwd, M.up) || M.right
  else {
    M.angle = screenAngle()
    M.right = orthoTo(screenRight(M.angle), M.up) || M.right
  }
  T.lean = 0
  saveMount()
  return true
}

/** Calibración actual (para la caja negra y para enseñarla). */
export const calibration = () => ({ conv: M.conv, axes: M.axes, yawSign: M.sign, leanSign: M.leanSign, gpsLag: gpsLag(), up: M.up, right: M.right, fwd: M.fwd, sys: M.sys })

// ---------- Fuente GPS real ----------

export function createRealGps() {
  let id = null
  let prev = null
  const lags = []
  return {
    kind: 'real',
    start(onFix, onError) {
      if (!('geolocation' in navigator)) return onError({ message: 'Este navegador no tiene GPS' })
      id = navigator.geolocation.watchPosition(
        (pos) => {
          const s = fromPosition(pos, prev, lags)
          if (!s) return
          prev = s
          onFix(s)
        },
        (err) => onError(err),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
      )
    },
    stop() {
      if (id != null) navigator.geolocation.clearWatch(id)
      id = null
    },
  }
}

/**
 * Convierte una posición del navegador en una muestra. Devuelve null si es vieja (al volver de segundo
 * plano el móvil entrega a veces una posición de hace un rato con la hora de ahora).
 * - Hora: la de llegada menos lo que la posición ya traía de retraso, menos el retraso del GPS.
 * - Velocidad: la del GPS (Doppler). Si no la da (parado o muy despacio, y en el iPhone pasa en ~1 de
 *   cada 6), NO se calcula con las posiciones: con 15-25 m de error eso daba saltos de 40-130 km/h
 *   parado. Se mantiene la última un momento si ibas rápido, o 0, y se marca vOk = false.
 */
export function fromPosition(pos, prev, lags = [], { recv = performance.now(), wall = Date.now(), lag = gpsLag() } = {}) {
  const c = pos.coords
  // Retraso con el que llega respecto a su propia hora (con el reloj del móvil desfasado puede ser
  // cualquier cosa: se compara con el mínimo reciente)
  const d = wall - pos.timestamp
  lags.push(d)
  if (lags.length > 12) lags.shift()
  const ref = Math.min(...lags)
  if (d - ref > 3000) return null
  if (prev && pos.timestamp <= prev.ts) return null
  const t = (recv - clamp(d - ref, 0, 3000)) / 1000 - lag
  if (prev && t <= prev.t) return null
  const doppler = Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null
  let v = doppler
  if (v == null) v = prev && prev.vOk && prev.v > 3 && t - prev.t < 2.5 ? prev.v : 0
  return {
    t,
    lat: c.latitude,
    lon: c.longitude,
    v,
    vOk: doppler != null,
    acc: c.accuracy,
    alt: c.altitude,
    heading: Number.isFinite(c.heading) && doppler != null && doppler > 1 ? c.heading : null,
    // Lo que da el móvil sin tocar, para la caja negra
    ts: pos.timestamp,
    altAcc: c.altitudeAccuracy,
    speedRaw: c.speed,
    headingRaw: c.heading,
  }
}

// Solo para los tests: inyectar eventos de movimiento y ver el estado interno
export const __test = { onMotion: (e) => onMotion(e), M, initMount, saveMount }
