// Contacto: como la llave de la moto. Con el contacto dado, el DASH funciona y la caja negra puede grabar;
// apagado, el DASH se queda a oscuras, no se graba nada (aunque el GPS dé saltos o estés colocando el
// móvil en el soporte) y la salida en curso se cierra. Así eres tú quien dice cuándo empieza y acaba
// la ruta.
//
// Si se te olvida darlo, se da solo al ver que vas en moto de verdad (más de 200 m a más de 18 km/h en
// menos de un minuto): se puede quitar en Garaje → Ajustes.
import { settings, setSetting } from './store.js'
import { resetTrip } from './telemetry.js'
import { haversine } from './geo.js'

const subs = new Set()
export const ignitionOn = () => !!settings.ignition
/** fn(on, { auto }) cuando se da o se quita el contacto. */
export const onIgnition = (fn) => (subs.add(fn), () => subs.delete(fn))

export function setIgnition(on, { auto = false } = {}) {
  on = !!on
  if (ignitionOn() === on) return
  // Cada vez que das el contacto empieza un viaje: los datos del viaje (distancia, máximos) a cero
  if (on) resetTrip()
  setSetting('ignition', on)
  run = null
  for (const fn of subs) fn(on, { auto })
}

// ---- Contacto solo (si se te olvida) ----
const AUTO_DIST = 200 // m
const AUTO_V = 5 // m/s (18 km/h)
const AUTO_WINDOW = 60 // s
let run = null // { t, lat, lon } desde la primera posición rápida

/** Cada posición del GPS: si vas en moto con el contacto quitado, lo da solo. */
export function watchAutoOn(s) {
  if (ignitionOn() || settings.ignitionAuto === false || settings.source !== 'real') return false
  if (s.vOk === false || !(s.v >= AUTO_V) || !(s.acc < 30)) {
    if (run && s.t - run.t > AUTO_WINDOW) run = null
    return false
  }
  if (!run || s.t - run.t > AUTO_WINDOW) run = { t: s.t, lat: s.lat, lon: s.lon }
  if (haversine(run.lat, run.lon, s.lat, s.lon) >= AUTO_DIST) {
    setIgnition(true, { auto: true })
    return true
  }
  return false
}
