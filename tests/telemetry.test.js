// Signos de la fuerza G y de la inclinación.
// Convenio de la app: el punto del círculo G marca hacia dónde acelera la moto
// (acelerar = arriba, frenar = abajo, curva a derecha = derecha) y la inclinación es positiva a la derecha.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const G = 9.80665
let tel
let push
let t

beforeEach(async () => {
  vi.resetModules()
  tel = await import('../src/core/telemetry.js')
  tel.useSource({ start: (fn) => (push = fn), stop() {} })
  t = 100
})

/** Una muestra de GPS un segundo después de la anterior. */
const gps = (v, heading) => push({ t: (t += 1), lat: 43.37, lon: -8.4, v, acc: 4, alt: 10, heading })

/** n eventos de movimiento iguales. grav = gravedad aparente; yawRate = rotationRate.gamma (°/s, eje y del móvil). */
function motion(n, grav, gamma = 0) {
  for (let i = 0; i < n; i++)
    tel.__test.onMotion({
      accelerationIncludingGravity: grav,
      acceleration: { x: 0, y: 0, z: 0 },
      rotationRate: { alpha: 0, beta: 0, gamma },
    })
}

// Móvil vertical mirando al piloto. Estándar W3C: en reposo la gravedad aparente apunta ARRIBA (+y).
const UP_STD = { x: 0, y: G, z: 0 }
// Algunos navegadores la dan con el signo contrario.
const UP_INV = { x: 0, y: -G, z: 0 }
// Curva a derecha = giro horario visto desde arriba = negativo alrededor de +y (regla de la mano derecha).
const RIGHT = -15

describe('G longitudinal', () => {
  it('es positiva al acelerar y negativa al frenar', () => {
    for (const v of [0, 5, 10, 15, 20]) gps(v, 0)
    expect(tel.T.gLong).toBeGreaterThan(0.3)
    for (const v of [15, 10, 5]) gps(v, 0)
    expect(tel.T.gLong).toBeLessThan(-0.3)
  })
})

describe('G lateral e inclinación solo con GPS', () => {
  it('curva a derecha (rumbo creciente) → positivas', () => {
    for (const h of [0, 15, 30, 45, 60]) gps(20, h)
    expect(tel.T.gLat).toBeGreaterThan(0.3)
    expect(tel.T.lean).toBeGreaterThan(0.2)
  })
  it('curva a izquierda (rumbo decreciente) → negativas', () => {
    for (const h of [60, 45, 30, 15, 0, 345]) gps(20, h)
    expect(tel.T.gLat).toBeLessThan(-0.3)
    expect(tel.T.lean).toBeLessThan(-0.2)
  })
})

describe('G lateral con giroscopio', () => {
  it('con el convenio estándar sale bien desde el primer momento', () => {
    gps(20, 0)
    gps(20, 0)
    motion(300, UP_STD, RIGHT)
    expect(tel.T.gLat).toBeGreaterThan(0.3)
    expect(tel.T.lean).toBeGreaterThan(0.2)
    motion(300, UP_STD, -RIGHT)
    expect(tel.T.gLat).toBeLessThan(-0.3)
    expect(tel.T.lean).toBeLessThan(-0.2)
  })

  it('si el móvil usa el signo contrario, se corrige en la primera curva y se guarda', async () => {
    const { settings } = await import('../src/core/store.js')
    gps(20, 0)
    gps(20, 0)
    motion(300, UP_INV, RIGHT)
    expect(tel.T.gLat).toBeLessThan(0) // invertido antes de ver ninguna curva por GPS
    // Un par de segundos de curva a derecha con GPS y giroscopio a la vez
    for (const h of [15, 30, 45]) {
      motion(60, UP_INV, RIGHT)
      gps(20, h)
    }
    motion(300, UP_INV, RIGHT)
    expect(tel.T.gLat).toBeGreaterThan(0.3)
    expect(tel.T.lean).toBeGreaterThan(0.2)
    expect(settings.gyroSign).toBe(1)
  })

  it('con el convenio estándar la alineación confirma el signo por defecto', async () => {
    const { settings } = await import('../src/core/store.js')
    gps(20, 0)
    for (const h of [15, 30, 45]) {
      motion(60, UP_STD, RIGHT)
      gps(20, h)
    }
    expect(tel.__test.M.sign).toBe(-1)
    expect(settings.gyroSign).toBe(-1)
  })
})

describe('inclinación parado (gravedad)', () => {
  const phi = (10 * Math.PI) / 180
  it('moto tumbada a la derecha → positiva, con cualquier convenio', () => {
    gps(0, null)
    // Tumbar a la derecha gira el móvil en sentido horario visto por el piloto
    motion(400, { x: -G * Math.sin(phi), y: G * Math.cos(phi), z: 0 })
    expect(tel.T.lean).toBeGreaterThan(0.12)
    expect(tel.T.lean).toBeLessThan(0.2)
  })
  it('lo mismo con la gravedad invertida', () => {
    gps(0, null)
    motion(400, { x: G * Math.sin(phi), y: -G * Math.cos(phi), z: 0 })
    expect(tel.T.lean).toBeGreaterThan(0.12)
    expect(tel.T.lean).toBeLessThan(0.2)
  })
})

describe('cero del inclinómetro', () => {
  const rot = (deg, base = 0) => {
    // Gravedad aparente de un móvil girado `deg` grados (sentido horario visto de frente) sobre la postura `base`
    const a = ((deg + base) * Math.PI) / 180
    return { x: -G * Math.sin(a), y: G * Math.cos(a), z: 0 }
  }
  it('el cero calibrado en vertical sigue valiendo en horizontal', () => {
    // Soporte torcido 5° y moto recta: se calibra
    motion(200, rot(5))
    expect(tel.zeroLean()).toBe(true)
    motion(200, rot(5))
    expect(Math.abs(tel.T.lean)).toBeLessThan(0.02)
    // Mismo soporte girado 90° (móvil en horizontal) y moto recta: sigue a cero
    motion(1500, rot(5, 90))
    expect(Math.abs(tel.T.lean)).toBeLessThan(0.02)
    // Moto tumbada 10° a la derecha con el móvil en horizontal
    motion(1500, rot(15, 90))
    expect(tel.T.lean).toBeGreaterThan(0.15)
  })
})
