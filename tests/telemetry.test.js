// Inclinación, G y GPS de la telemetría.
// Convenio de la app: el punto del círculo G marca hacia dónde acelera la moto
// (acelerar = arriba, frenar = abajo, curva a derecha = derecha) y la inclinación es positiva a la derecha.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cross, dot } from '../src/core/mount.js'

const G = 9.80665
const rad = (d) => (d * Math.PI) / 180
const deg = (r) => (r * 180) / Math.PI
let tel
let store
let push
let clock

beforeEach(async () => {
  vi.resetModules()
  clock = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => clock * 1000)
  globalThis.screen = { orientation: { angle: 0 } }
  store = await import('../src/core/store.js')
  for (const k of ['mount', 'leanSign', 'gyroAxes', 'yawSign', 'gravConv', 'gpsLag']) store.settings[k] = null
  tel = await import('../src/core/telemetry.js')
  tel.useSource({ start: (fn) => (push = fn), stop() {} })
})
afterEach(() => {
  vi.restoreAllMocks()
  delete globalThis.screen
})

// ---- Un móvil montado en la moto ----
// U, R, F: vertical, derecha y delante de la moto vistos por el móvil (F × U = R).
const mountOf = (U, R) => ({ U, R, F: cross(U, R) })
// Como el iPhone de la primera salida: casi plano (22° hacia el piloto) y en horizontal
const c22 = Math.cos(rad(22))
const s22 = Math.sin(rad(22))
const FLAT_LAND = mountOf([s22, 0, c22], [0, -1, 0])
// Vertical mirando al piloto
const UPRIGHT = mountOf([0, 1, 0], [1, 0, 0])

/** Vertical del mundo vista por el móvil con la moto tumbada φ grados (+ derecha). */
const worldUp = (m, phi) => {
  const c = Math.cos(rad(phi))
  const s = Math.sin(rad(phi))
  return [c * m.U[0] - s * m.R[0], c * m.U[1] - s * m.R[1], c * m.U[2] - s * m.R[2]]
}

/**
 * Un evento devicemotion. conv: -1 como el iPhone (gravedad hacia abajo). axes: cómo reparte el móvil
 * el giro (w3c o xyz). rot: giro en ejes del móvil (°/s). lin: aceleración física sin gravedad (m/s²).
 * sys: si da la aceleración sin gravedad (si no, wu hace de gravedad aparente).
 */
function ev({ wu, lin = [0, 0, 0], rot = [0, 0, 0], conv = 1, axes = 'w3c', sys = true }) {
  const ag = { x: conv * (G * wu[0] + lin[0]), y: conv * (G * wu[1] + lin[1]), z: conv * (G * wu[2] + lin[2]) }
  const rotationRate = axes === 'xyz' ? { alpha: rot[0], beta: rot[1], gamma: rot[2] } : { alpha: rot[2], beta: rot[0], gamma: rot[1] }
  return { accelerationIncludingGravity: ag, acceleration: sys ? { x: conv * lin[0], y: conv * lin[1], z: conv * lin[2] } : { x: null, y: null, z: null }, rotationRate }
}
/** `sec` segundos de sensores a 60 Hz. */
function imu(sec, make) {
  for (let i = 0; i < Math.round(sec * 60); i++) {
    clock += 1 / 60
    tel.__test.onMotion(make(i))
  }
}
const gps = (v, heading = null, extra = {}) => push({ t: clock, lat: 43.37, lon: -8.4, v, acc: 4, alt: 10, heading, ...extra })
/** `sec` segundos de marcha: 1 s de sensores y una muestra de GPS. heading(i) y make(i) por segundo. */
function ride(sec, v, heading, make) {
  for (let i = 0; i < sec; i++) {
    imu(1, () => make(i))
    gps(typeof v === 'function' ? v(i) : v, typeof heading === 'function' ? heading(i) : heading)
  }
}
const leanDeg = () => deg(tel.T.lean)

describe('solo con GPS (sin sensores)', () => {
  it('G longitudinal: positiva al acelerar y negativa al frenar', () => {
    for (const v of [0, 5, 10, 15, 20]) (clock++, gps(v, 0))
    expect(tel.T.gLong).toBeGreaterThan(0.3)
    for (const v of [15, 10, 5]) (clock++, gps(v, 0))
    expect(tel.T.gLong).toBeLessThan(-0.3)
  })
  it('curva a derecha → G lateral e inclinación positivas; a izquierda, negativas', () => {
    for (const h of [0, 15, 30, 45, 60]) (clock++, gps(20, h))
    expect(tel.T.gLat).toBeGreaterThan(0.3)
    expect(tel.T.lean).toBeGreaterThan(0.2)
    for (const h of [45, 30, 15, 0, 345, 330]) (clock++, gps(20, h))
    expect(tel.T.gLat).toBeLessThan(-0.3)
    expect(tel.T.lean).toBeLessThan(-0.2)
  })
  it('una velocidad que el GPS no da de verdad no cuenta para récords ni G', () => {
    clock++
    gps(5, 0)
    clock++
    gps(36, 0, { vOk: false })
    expect(tel.T.maxV).toBe(5)
    expect(Math.abs(tel.T.gLong)).toBeLessThan(0.05)
  })
})

describe('inclinación con la gravedad del móvil (iPhone casi plano en horizontal)', () => {
  beforeEach(() => {
    tel.__test.M.conv = -1
    tel.__test.M.axes = 'xyz'
    globalThis.screen.orientation.angle = 90
  })

  it('sale el ángulo real a cada lado, también pasados los 45° (antes daba la vuelta)', () => {
    imu(2, () => ev({ wu: worldUp(FLAT_LAND, 0), conv: -1, axes: 'xyz' }))
    expect(tel.zeroLean()).toBe(true)
    // Hasta que una curva del GPS confirma el sentido, la inclinación no hace récords
    ride(2, 15, 0, () => ev({ wu: worldUp(FLAT_LAND, 30), conv: -1, axes: 'xyz' }))
    expect(tel.T.leanMaxR).toBe(0)
    ride(6, 15, (i) => i * 12, () => ev({ wu: worldUp(FLAT_LAND, 25), conv: -1, axes: 'xyz' }))
    expect(store.settings.leanSign).toBe(1)
    for (const phi of [10, 30, 50, -35]) {
      ride(2, 15, 0, () => ev({ wu: worldUp(FLAT_LAND, phi), conv: -1, axes: 'xyz' }))
      expect(leanDeg()).toBeCloseTo(phi, 0)
    }
    expect(tel.T.leanMaxR).toBeGreaterThan(49)
    expect(tel.T.leanMaxL).toBeGreaterThan(34)
  })

  it('si la pantalla gira mientras tumbas, el inclinómetro no cambia de sentido', () => {
    imu(2, () => ev({ wu: worldUp(FLAT_LAND, 0), conv: -1, axes: 'xyz' }))
    tel.zeroLean()
    ride(2, 15, 0, () => ev({ wu: worldUp(FLAT_LAND, 25), conv: -1, axes: 'xyz' }))
    // Al tumbar, el iPhone pasa la pantalla a vertical
    globalThis.screen.orientation.angle = 0
    for (let i = 0; i < 6; i++) {
      ride(1, 15, 0, () => ev({ wu: worldUp(FLAT_LAND, 25 + i * 5), conv: -1, axes: 'xyz' }))
      expect(leanDeg()).toBeCloseTo(25 + i * 5, 0)
    }
  })

  it('aprende dónde es delante con acelerones y frenadas: G del acelerómetro y lateral bien aunque la pantalla engañe', () => {
    // La pantalla dice vertical (lateral = x), pero el móvil va en horizontal: el lateral de partida está mal
    globalThis.screen.orientation.angle = 0
    imu(2, () => ev({ wu: worldUp(FLAT_LAND, 0), conv: -1, axes: 'xyz' }))
    tel.zeroLean()
    let v = 5
    gps(v, 0)
    for (let i = 0; i < 24; i++) {
      const a = i % 4 < 2 ? 2.5 : -2 // m/s²
      const F = FLAT_LAND.F
      imu(1, () => ev({ wu: worldUp(FLAT_LAND, 0), lin: [a * F[0], a * F[1], a * F[2]], conv: -1, axes: 'xyz' }))
      v += a
      gps(v, 0)
    }
    const M = tel.__test.M
    expect(dot(M.fwd, FLAT_LAND.F)).toBeGreaterThan(0.98)
    expect(dot(M.right, FLAT_LAND.R)).toBeGreaterThan(0.98)
    // G longitudinal ya del acelerómetro, al momento
    imu(1, () => ev({ wu: worldUp(FLAT_LAND, 0), lin: FLAT_LAND.F.map((x) => x * 4.9), conv: -1, axes: 'xyz' }))
    expect(tel.T.gLong).toBeCloseTo(0.5, 1)
    // Y la inclinación sale bien
    ride(2, 15, 0, () => ev({ wu: worldUp(FLAT_LAND, 30), conv: -1, axes: 'xyz' }))
    expect(leanDeg()).toBeCloseTo(30, 0)
    // Se guarda
    expect(store.settings.mount.fwd).toBeTruthy()
  })

  it('si el sentido sale al revés, lo corrige con las curvas del GPS y lo guarda', () => {
    // La pantalla dice horizontal hacia el otro lado: el lateral de partida apunta a la izquierda
    globalThis.screen.orientation.angle = 270
    imu(2, () => ev({ wu: worldUp(FLAT_LAND, 0), conv: -1, axes: 'xyz' }))
    tel.zeroLean()
    // Curva a derecha (rumbo creciente) tumbado 25° a la derecha
    ride(8, 15, (i) => i * 12, () => ev({ wu: worldUp(FLAT_LAND, 25), conv: -1, axes: 'xyz' }))
    expect(store.settings.leanSign).toBe(-1)
    expect(leanDeg()).toBeCloseTo(25, 0)
  })

  it('sin poner a cero, la vertical se afina sola yendo en recta (empezó en la pata de cabra)', () => {
    imu(2, () => ev({ wu: worldUp(FLAT_LAND, -12), conv: -1, axes: 'xyz' }))
    expect(leanDeg()).toBeCloseTo(0, 0) // toma la postura de ahora como recta
    ride(3, 15, 0, () => ev({ wu: worldUp(FLAT_LAND, 0), conv: -1, axes: 'xyz' }))
    expect(leanDeg()).toBeGreaterThan(10) // aún cree que va tumbada
    ride(100, 15, 0, () => ev({ wu: worldUp(FLAT_LAND, 0), conv: -1, axes: 'xyz' }))
    expect(Math.abs(leanDeg())).toBeLessThan(2)
  })

  it('si mueves el móvil en el soporte con la moto parada, rehace la postura', () => {
    imu(2, () => ev({ wu: worldUp(FLAT_LAND, 0), conv: -1, axes: 'xyz' }))
    tel.zeroLean()
    gps(0, null)
    imu(4, () => ev({ wu: worldUp(UPRIGHT, 0), conv: -1, axes: 'xyz' }))
    expect(Math.abs(leanDeg())).toBeLessThan(1)
  })
})

describe('sin la gravedad del sistema: giroscopio', () => {
  it('móvil vertical, ejes estándar: la curva a derecha da inclinación positiva', () => {
    const phi = deg(Math.atan((20 * rad(15)) / G))
    // La gravedad aparente va con la moto; el giro es sobre la vertical del mundo
    const wuW = worldUp(UPRIGHT, phi)
    const rot = wuW.map((x) => -15 * x)
    ride(3, 20, (i) => i * 15, () => ev({ wu: UPRIGHT.U, rot, sys: false }))
    expect(leanDeg()).toBeCloseTo(phi, 0)
    expect(tel.T.gLat).toBeGreaterThan(0.4)
  })

  it('descubre que el móvil reparte los ejes como el iPhone y lo guarda', () => {
    const flat = mountOf([0, 0, 1], [1, 0, 0])
    expect(tel.__test.M.axes).toBe('w3c')
    // iPhone: el giro sobre z llega en gamma
    ride(8, 15, (i) => i * 10, () => ev({ wu: flat.U, rot: [0, 0, -10], axes: 'xyz' }))
    expect(store.settings.gyroAxes).toBe('xyz')
    expect(tel.__test.M.sign).toBe(-1)
  })
})

describe('posiciones del GPS', () => {
  const pos = (ts, speed, heading = 90) => ({ timestamp: ts, coords: { latitude: 43.37, longitude: -8.4, accuracy: 5, altitude: 10, altitudeAccuracy: 3, speed, heading } })

  it('resta el retraso del GPS a la hora', () => {
    const s = tel.fromPosition(pos(1000, 10), null, [], { recv: 5000, wall: 1000, lag: 1 })
    expect(s.t).toBeCloseTo(4, 6)
    expect(s.vOk).toBe(true)
  })

  it('sin velocidad del GPS no la inventa con las posiciones: mantiene la última un momento o 0', () => {
    const lags = []
    const a = tel.fromPosition(pos(1000, 20), null, lags, { recv: 1000, wall: 1000, lag: 0 })
    const b = tel.fromPosition(pos(2000, null, null), a, lags, { recv: 2000, wall: 2000, lag: 0 })
    expect(b.v).toBe(20)
    expect(b.vOk).toBe(false)
    expect(b.heading).toBe(null)
    const c = tel.fromPosition(pos(3000, null, null), b, lags, { recv: 3000, wall: 3000, lag: 0 })
    expect(c.v).toBe(0)
    const slow = tel.fromPosition(pos(4000, -1, null), { ...a, v: 1.5, ts: 3000, t: 3 }, lags, { recv: 4000, wall: 4000, lag: 0 })
    expect(slow.v).toBe(0)
  })

  it('descarta la posición vieja que llega al volver de segundo plano', () => {
    const lags = []
    const a = tel.fromPosition(pos(1000, 0), null, lags, { recv: 1000, wall: 1000, lag: 0 })
    expect(tel.fromPosition(pos(4000, 0), a, lags, { recv: 60000, wall: 20000, lag: 0 })).toBe(null)
    expect(tel.fromPosition(pos(1000, 0), a, lags, { recv: 2000, wall: 2000, lag: 0 })).toBe(null)
    const b = tel.fromPosition(pos(60000, 0), a, lags, { recv: 60010, wall: 60010, lag: 0 })
    expect(b.t).toBeCloseTo(60, 1)
  })
})
