// Modelo físico sencillo de una moto en recta: tracción limitada por agarre/caballito,
// potencia, cambios de marcha con corte breve, aerodinámica y rodadura.
// Lo usan el simulador de GPS y los rivales de la CPU.

import { G } from './perf.js'

const RHO = 1.2

/** Clases de moto inventadas (no son modelos reales). */
export const BIKES = {
  scoot: { id: 'scoot', name: 'SCOOT 125', kw: 11, mass: 215, cda: 0.6, mu: 0.42, gears: 0, color: '#3dff7a' },
  naked: { id: 'naked', name: 'NAKED 700', kw: 55, mass: 270, cda: 0.55, mu: 0.8, gears: 6, color: '#ffd23f' },
  sport: { id: 'sport', name: 'SPORT 600', kw: 85, mass: 268, cda: 0.38, mu: 0.95, gears: 6, color: '#22e3ff' },
  hyper: { id: 'hyper', name: 'HYPER 1000', kw: 150, mass: 285, cda: 0.36, mu: 1.05, gears: 6, color: '#ff2e88' },
}

export function topSpeed(bike) {
  // Potencia útil = arrastre aerodinámico a velocidad punta
  return Math.cbrt((bike.kw * 1000 * 0.85) / (0.5 * RHO * bike.cda))
}

/** Crea el estado de una moto parada. */
export function createBike(bike) {
  const vmax = topSpeed(bike)
  // Velocidad de corte de cada marcha (más juntas abajo)
  const shifts = []
  for (let g = 1; g < bike.gears; g++) shifts.push(vmax * (0.28 + 0.72 * Math.pow(g / bike.gears, 0.85)))
  return { bike, v: 0, d: 0, gear: 1, shifts, cut: 0, vmax }
}

/** Avanza la física dt segundos. throttle y brake en [0, 1]. */
export function stepBike(s, dt, throttle, brake = 0) {
  const { bike } = s
  if (s.gear <= s.shifts.length && s.v >= s.shifts[s.gear - 1]) {
    s.gear++
    s.cut = 0.11 // corte de encendido del cambio
  }
  if (s.v < 1 && throttle === 0) s.gear = 1
  let drive = 0
  if (throttle > 0 && s.cut <= 0) {
    const grip = bike.mu * G
    const power = (bike.kw * 1000 * 0.85) / (bike.mass * Math.max(s.v, 2.5))
    // En primera el embrague patina al principio: subida suave en los primeros 0,2 s
    drive = throttle * Math.min(grip, power)
  }
  s.cut = Math.max(0, s.cut - dt)
  const drag = (0.5 * RHO * bike.cda * s.v * s.v) / bike.mass + (s.v > 0 ? 0.015 * G : 0)
  const brk = brake * 0.95 * G
  const a = drive - drag - brk
  const v2 = Math.max(0, s.v + a * dt)
  s.d += ((s.v + v2) / 2) * dt
  s.a = (v2 - s.v) / dt
  s.v = v2
  return s
}

/**
 * Trayectoria completa a gas fondo para un rival de la CPU.
 * Devuelve puntos {t, v, d} cada 50 ms desde la salida (t = 0).
 */
export function fullThrottleTrace(bike, seconds = 40) {
  const s = createBike(bike)
  const dt = 0.002
  const out = [{ t: 0, v: 0, d: 0 }]
  let t = 0
  let next = 0.05
  // Rampa de embrague: 0,25 s hasta gas a fondo
  while (t < seconds) {
    const thr = Math.min(1, 0.35 + t / 0.25)
    stepBike(s, dt, thr)
    t += dt
    if (t >= next - 1e-9) {
      out.push({ t: Math.round(t * 1000) / 1000, v: s.v, d: s.d })
      next += 0.05
    }
  }
  return out
}
