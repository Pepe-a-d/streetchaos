// Telemetría: recibe muestras de la fuente GPS (real o simulada) y del acelerómetro/giroscopio
// y calcula lo que enseña el dashboard: velocidad, máximos, viaje, rumbo, G y ángulo de inclinación.

import { haversine, bearing, headingDelta } from './geo.js'
import { G } from './perf.js'
import { settings, setSetting, totals, saveTotals } from './store.js'

const now = () => performance.now() / 1000
const ema = (prev, x, dt, tau) => (prev == null ? x : prev + (x - prev) * Math.min(1, dt / (tau + dt)))
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

export const T = {
  source: null,
  status: 'off', // off | waiting | ok | lost | denied | error
  error: '',
  fix: null,
  v: 0,
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
export const onSample = (fn) => (sampleSubs.add(fn), () => sampleSubs.delete(fn))
export const onHint = (fn) => (hintSubs.add(fn), () => hintSubs.delete(fn))
/** Cada evento devicemotion tal cual, con su hora (para la caja negra). */
export const onRawMotion = (fn) => (rawSubs.add(fn), () => rawSubs.delete(fn))

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
  T.leanMaxL = 0
  T.leanMaxR = 0
}

function handleSample(s) {
  const p = T.fix
  if (p && s.t <= p.t) return
  const dt = p ? s.t - p.t : 1
  // Rumbo: el del GPS si va en marcha; si no, el de la posición
  if (s.heading == null && p && haversine(p.lat, p.lon, s.lat, s.lon) > 3) s.heading = bearing(p.lat, p.lon, s.lat, s.lon)
  if (p && dt < 5) {
    T.hz = ema(T.hz || 1 / dt, 1 / dt, 1, 3)
    const ds = ((p.v + s.v) / 2) * dt
    if (s.v > 1 && s.acc < 40) {
      T.trip += ds
      T.tripTime += dt
      totals.odo += ds
      totals.time = (totals.time || 0) + dt
    }
    T.gLong = ema(T.gLong, (s.v - p.v) / dt / G, dt, 0.6)
    if (p.heading != null && s.heading != null && s.v > 3) {
      const yaw = (headingDelta(p.heading, s.heading) * Math.PI) / 180 / dt
      T.yawGps = ema(T.yawGps, yaw, dt, 0.5)
      alignGyro()
    } else T.yawGps = ema(T.yawGps, 0, dt, 0.5)
  }
  T.fix = s
  T.v = s.v
  T.acc = s.acc
  T.alt = Number.isFinite(s.alt) ? s.alt : T.alt
  if (s.heading != null && s.v > 1.5) T.heading = s.heading
  if (s.acc < 25) {
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

/** Llamar en cada frame: velocidad suavizada y extrapolada entre muestras de GPS. */
export function tick(dt) {
  let target = T.v
  if (T.fix && T.status === 'ok') {
    const ahead = clamp(now() - T.fix.t, 0, 1)
    target = Math.max(0, T.v + T.gLong * G * ahead * 0.8)
  }
  T.vDisp += (target - T.vDisp) * Math.min(1, dt * 7)
  if (T.vDisp < 0.05) T.vDisp = 0
}

// ---------- Acelerómetro y giroscopio ----------

// OJO: estas van ANTES de M, que las usa al cargar el módulo. Con `const` no se pueden usar antes de
// su línea: con un cero de inclinómetro guardado, la app entera fallaba al arrancar (pantalla morada).
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const QUARTER = Math.PI / 2
/** Lo que sobra de un ángulo respecto al múltiplo de 90° más cercano (entre -45° y 45°). */
const quarterRest = (a) => a - Math.round(a / QUARTER) * QUARTER
/** Los ajustes antiguos guardaban el ángulo absoluto: se convierte a desviación. */
function leanOffset(saved) {
  return Number.isFinite(saved) ? quarterRest(saved) : 0
}

// Signo del giroscopio. Con el estándar (gravedad aparente hacia ARRIBA en reposo y giros por la
// regla de la mano derecha) una curva a derecha da w < 0, así que se empieza en -1. Si este móvil
// usa el convenio contrario, alignGyro() lo descubre en la primera curva y lo guarda.
const M = { grav: null, lin: null, last: 0, offset: leanOffset(settings.leanZero), tilt: 0, yaw: 0, yawSum: 0, yawN: 0, sign: settings.gyroSign ?? -1, corr: 0, over: null, cool: 0 }

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

function onMotion(e) {
  const ag = e.accelerationIncludingGravity
  if (!ag || ag.x == null) return
  const t = now()
  const dt = clamp(t - (M.last || t - 0.016), 0.004, 0.1)
  M.last = t
  T.motion = true
  for (const fn of rawSubs) fn(e, t)
  const g = { x: ag.x, y: ag.y, z: ag.z }
  M.grav = M.grav ? { x: ema(M.grav.x, g.x, dt, 0.4), y: ema(M.grav.y, g.y, dt, 0.4), z: ema(M.grav.z, g.z, dt, 0.4) } : g

  // Inclinación estática respecto al cero calibrado (sirve parado o muy despacio)
  // El cero se guarda como desviación respecto a la orientación más cercana (vertical u horizontal),
  // así sigue valiendo si cambias el móvil de postura en el soporte.
  M.tilt = -quarterRest(Math.atan2(M.grav.x, M.grav.y) - M.offset)

  // Giro alrededor del eje vertical de la moto (la gravedad aparente ya va por ese eje al tumbar)
  const rr = e.rotationRate
  if (rr && rr.alpha != null) {
    T.gyro = true
    const n = Math.hypot(M.grav.x, M.grav.y, M.grav.z) || 1
    const w = ((rr.beta * M.grav.x + rr.gamma * M.grav.y + rr.alpha * M.grav.z) / n) * (Math.PI / 180)
    M.yaw = ema(M.yaw, w, dt, 0.12)
    M.yawSum += w
    M.yawN++
  }

  // Tirón de salida: aceleración lineal media (la vibración del motor se anula al promediar)
  const a = e.acceleration && e.acceleration.x != null ? e.acceleration : { x: g.x - M.grav.x, y: g.y - M.grav.y, z: g.z - M.grav.z }
  M.lin = M.lin ? { x: ema(M.lin.x, a.x, dt, 0.1), y: ema(M.lin.y, a.y, dt, 0.1), z: ema(M.lin.z, a.z, dt, 0.1) } : { ...a }
  const mag = Math.hypot(M.lin.x, M.lin.y, M.lin.z) / G
  if (mag > 0.2) {
    M.over ??= t
    if (t - M.over > 0.1 && t > M.cool) {
      M.cool = t + 1.5
      for (const fn of hintSubs) fn(M.over - 0.05)
    }
  } else M.over = null

  updateLean(dt)
}

/** El signo del giroscopio depende del móvil: se alinea con el giro que marca el GPS. */
function alignGyro() {
  if (!T.gyro || M.yawN === 0) return
  const avg = M.yawSum / M.yawN
  M.yawSum = 0
  M.yawN = 0
  if (Math.abs(T.yawGps) > 0.05 && T.v > 4) {
    M.corr = M.corr * 0.95 + avg * T.yawGps
    // Solo se cambia con una correlación clara, para que una muestra rara no lo invierta
    if (Math.abs(M.corr) > CORR_SURE) {
      const sign = M.corr > 0 ? 1 : -1
      if (sign !== M.sign) M.sign = sign
      if (settings.gyroSign !== sign) setSetting('gyroSign', sign)
    }
  }
}

const CORR_SURE = 0.02 // (rad/s)²: ~1 s de curva a 0,15 rad/s con el giroscopio de acuerdo

function updateLean(dt) {
  const v = T.v
  const w = T.gyro ? M.sign * M.yaw : T.yawGps
  const lat = (v * w) / G
  const dyn = Math.asin(clamp(lat, -0.97, 0.97))
  const k = smooth(2, 6, v)
  const raw = k * dyn + (1 - k) * (T.motion ? M.tilt : 0)
  T.lean = ema(T.lean, raw, dt, 0.12)
  T.gLat = ema(T.gLat, lat, dt, 0.15)
  const deg = (T.lean * 180) / Math.PI
  if (v > 3) {
    if (deg < 0) T.leanMaxL = Math.max(T.leanMaxL, -deg)
    else T.leanMaxR = Math.max(T.leanMaxR, deg)
    totals.maxLeanL = Math.max(totals.maxLeanL, T.leanMaxL)
    totals.maxLeanR = Math.max(totals.maxLeanR, T.leanMaxR)
  }
  const gt = Math.hypot(T.gLat, T.gLong)
  if (v > 2) {
    T.gMax = Math.max(T.gMax, gt)
    totals.maxG = Math.max(totals.maxG, gt)
  }
}

/** Pone a cero la inclinación con la moto recta. */
export function zeroLean() {
  if (!M.grav) return false
  M.offset = quarterRest(Math.atan2(M.grav.x, M.grav.y))
  setSetting('leanZero', M.offset)
  return true
}

// ---------- Fuente GPS real ----------

export function createRealGps() {
  let id = null
  let prev = null
  return {
    kind: 'real',
    start(onFix, onError) {
      if (!('geolocation' in navigator)) return onError({ message: 'Este navegador no tiene GPS' })
      id = navigator.geolocation.watchPosition(
        (pos) => {
          const c = pos.coords
          const recv = performance.now()
          // Hora del fix si es coherente con la de llegada (si no, la de llegada)
          const lag = Date.now() - pos.timestamp
          const t = (lag >= 0 && lag < 2000 ? recv - lag : recv) / 1000
          let v = Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null
          if (v == null && prev && t > prev.t) {
            const d = haversine(prev.lat, prev.lon, c.latitude, c.longitude)
            v = d < c.accuracy * 0.5 ? 0 : d / (t - prev.t)
          }
          const s = {
            t,
            lat: c.latitude,
            lon: c.longitude,
            v: v ?? 0,
            acc: c.accuracy,
            alt: c.altitude,
            heading: Number.isFinite(c.heading) && (v ?? 0) > 1 ? c.heading : null,
            // Lo que da el móvil sin tocar, para la caja negra
            ts: pos.timestamp,
            altAcc: c.altitudeAccuracy,
            speedRaw: c.speed,
            headingRaw: c.heading,
          }
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

// Solo para los tests: inyectar eventos de movimiento y ver el estado interno
export const __test = { onMotion: (e) => onMotion(e), M }
