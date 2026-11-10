// Las salidas de la caja negra de este móvil como trayectos (core/routes.js), y el resumen de cada una al
// terminar (core/tripsum.js).
import { logger } from './logger.js'
import { rideOf, endpointsFromGps, routeOf, groupRoutes } from './routes.js'
import { summarize } from './tripsum.js'
import { settings, totals, load, save } from './store.js'
import { T } from './telemetry.js'

/** Las salidas guardadas (las de antes de apuntar de dónde a dónde se completan una vez, leyendo sus posiciones). */
export async function loadRides() {
  const L = logger()
  if (!L) return []
  const out = []
  for (const m of await L.list()) {
    if (m.state !== 'done' || (m.source || 'real') !== 'real') continue
    if (!m.from && !m.noEnds) {
      try {
        const e = endpointsFromGps((await L.read(m)).gps)
        Object.assign(m, e || { noEnds: true })
        L.updateMeta(m)
      } catch {
        /* una salida rota no para las demás */
      }
    }
    const r = rideOf(m)
    if (r) out.push(r)
  }
  return out
}

export async function myRoutes() {
  return groupRoutes(await loadRides(), settings.places || [])
}

// ---- Resumen de cada salida ----
let before = { ...totals }
let results = [] // tramos y vueltas de esta salida (core/live.js)

/** Al empezar a grabar: los récords de ahora (para saber cuáles se baten) y los datos del viaje a cero. */
export function tripStarted() {
  before = { ...totals }
  results = []
}
/** Un tramo o una vuelta terminada en esta salida. */
export const addResult = (r) => results.push(r)

/** Al cerrarse la salida: su resumen (y se guarda como «última salida»). */
export async function tripEnded(meta) {
  let route = null
  try {
    const rides = await loadRides()
    const me = rideOf(meta) || rides.find((r) => r.id === meta.id)
    route = me ? routeOf(me, rides, settings.places || []) : null
  } catch {}
  const sum = summarize(meta, {
    trip: { maxV: T.maxV, leanL: T.leanMaxL, leanR: T.leanMaxR, gMax: T.gMax, brakeMax: T.brakeMax },
    before,
    after: { ...totals },
    results,
    route,
    units: settings.units,
  })
  results = []
  save('lastTrip', sum)
  return sum
}
export const lastTrip = () => load('lastTrip', null)
