// Conecta la caja negra (blackbox.js) con la app: GPS, sensores, ajustes y eventos.
import { createLogger, idbStore } from './blackbox.js'
import { T, onSample, onRawMotion } from './telemetry.js'
import { settings, onSetting } from './store.js'
import { isStandalone } from './device.js'

let L = null
const endSubs = new Set()
const startSubs = new Set()
/** Cuando se cierra una sesión (para subirla). */
export const onSessionEnd = (fn) => (endSubs.add(fn), () => endSubs.delete(fn))
/** Cuando empieza a grabar una salida nueva. */
export const onSessionStart = (fn) => (startSubs.add(fn), () => startSubs.delete(fn))

export function initLogger() {
  if (L || typeof indexedDB === 'undefined') return L
  L = createLogger({
    store: idbStore(),
    now: () => ({ perf: performance.now() / 1000, epoch: Date.now() }),
    enabled: () => settings.logTelemetry,
    context: () => ({
      source: settings.source,
      sim: settings.source === 'sim' ? { hz: settings.simHz, bike: settings.simBike } : null,
      calib: { leanZero: settings.leanZero, gyroSign: settings.gyroSign },
      rider: { bike: settings.bike, units: settings.units },
      device: {
        ua: navigator.userAgent,
        screen: [screen.width, screen.height, devicePixelRatio],
        orientation: screen.orientation?.type ?? null,
        standalone: isStandalone(),
      },
    }),
    snapshot: () => [T.vDisp, T.gLong, T.gLat, (T.lean * 180) / Math.PI],
    onStart: (meta) => startSubs.forEach((fn) => fn(meta)),
    onEnd: (meta) => endSubs.forEach((fn) => fn(meta)),
  })
  onSample((s) => L.gps(s))
  onRawMotion((e, t) => L.motion(e, t))
  setInterval(() => L.tick(), 100)

  onSetting((key, val) => {
    if (key === 'logTelemetry' && !val) L.end()
    if (key === 'source' || key === 'simHz' || key === 'simBike') L.end()
    if (key === 'leanZero' || key === 'gyroSign') L.event('calib', { [key]: val })
  })
  // En segundo plano el móvil corta GPS y sensores: se apunta y se guarda lo pendiente ya
  document.addEventListener('visibilitychange', () => {
    L.event(document.visibilityState === 'visible' ? 'visible' : 'hidden')
    L.flush()
  })
  addEventListener('pagehide', () => L.flush())
  addEventListener('orientationchange', () => L.event('orientation', { type: screen.orientation?.type ?? null }))

  // Que el navegador no la borre si falta espacio (Chrome lo concede a las apps instaladas)
  navigator.storage?.persist?.().catch(() => {})
  L.recover()
  return L
}

export const logger = () => L

/** Apunta un evento en la telemetría (t en segundos, base de performance.now()). */
export function logEvent(type, data, t) {
  L?.event(type, data, t)
}
