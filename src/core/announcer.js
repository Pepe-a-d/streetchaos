// Lo que la voz dice por su cuenta mirando la telemetría: avisos de velocidad, GPS perdido y
// recuperado, e inclinación al salir de una curva fuerte. Se llama en cada frame.
import { T } from './telemetry.js'
import { settings } from './store.js'
import { say } from './voice.js'

const S = { over: new Set(), gps: null, lostAt: 0, peak: 0, side: 0, coolUntil: 0, t: 0 }

export function watch(dt) {
  S.t += dt
  // Velocidad: se avisa al pasar de cada umbral subiendo; se rearma al bajar 5 por debajo
  const v = settings.units === 'mph' ? T.vDisp / 0.44704 : T.vDisp * 3.6
  if (T.status === 'ok') {
    for (const th of settings.speedAlerts || []) {
      if (v >= th + 0.5 && !S.over.has(th)) {
        S.over.add(th)
        say(String(th), { kind: 'speed' })
      } else if (v < th - 5) S.over.delete(th)
    }
  }

  // GPS: solo tras haberlo tenido (no al arrancar), y si vuelve tras más de unos segundos
  if (T.status !== S.gps) {
    if (T.status === 'lost' && S.gps === 'ok') {
      S.lostAt = S.t
      say('GPS perdido', { kind: 'gps' })
    }
    if (T.status === 'ok' && S.gps === 'lost' && S.t - S.lostAt > 3) say('GPS de nuevo', { kind: 'gps' })
    S.gps = T.status
  }

  // Curvas: el pico de inclinación, dicho al enderezar (más de 30° y en marcha)
  const deg = (T.lean * 180) / Math.PI
  if (T.v > 8 && Math.abs(deg) > 30 && Math.abs(deg) > S.peak) {
    S.peak = Math.abs(deg)
    S.side = Math.sign(deg)
  }
  if (S.peak && Math.abs(deg) < 12) {
    if (S.t > S.coolUntil) {
      say(`${Math.round(S.peak)} grados ${S.side < 0 ? 'izquierda' : 'derecha'}`, { kind: 'lean' })
      S.coolUntil = S.t + 4
    }
    S.peak = 0
  }
}

// Nombres de los parciales para decirlos
const SPOKEN = {
  'k0-50': 'Cero a cincuenta',
  'k0-100': 'Cero a cien',
  'k0-150': 'Cero a ciento cincuenta',
  'k0-200': 'Cero a doscientos',
  'k100-200': 'Cien a doscientos',
  'm0-30': 'Cero a treinta millas',
  'm0-60': 'Cero a sesenta millas',
  'm0-100': 'Cero a cien millas',
  'm60-130': 'Sesenta a ciento treinta millas',
  '60ft': 'Sesenta pies',
  '330ft': 'Trescientos treinta pies',
  '1/8': 'Octavo de milla',
  '1000ft': 'Mil pies',
  '1/4': 'Cuarto de milla',
}
export const spokenMark = (id) => SPOKEN[id] || id
