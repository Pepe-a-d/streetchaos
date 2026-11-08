// Analizador de /blackbox: con una salida inventada de la que se sabe la verdad (synth.js),
// comprueba que recupera la postura del móvil, la inclinación, las G, la distancia y las curvas.
import { describe, it, expect } from 'vitest'
import { synthRide, exportJson } from '../src/blackbox/synth.js'
import { analyze, rangeStats } from '../src/blackbox/process.js'
import { parseExport } from '../src/blackbox/library.js'

const RAD = Math.PI / 180
const ORIGIN = [43.37, -8.4]

/** Recta al norte, curva a derecha de 50 m (90°), recta, curva a izquierda de 35 m (180°), recta. */
function testPath() {
  const pts = []
  let x = 0
  let y = 0
  let h = 0 // rumbo en rad desde el norte
  const go = (len) => {
    for (let s = 0; s < len; s += 4) {
      x += 4 * Math.sin(h)
      y += 4 * Math.cos(h)
      pts.push([x, y])
    }
  }
  const turn = (r, deg) => {
    const steps = Math.ceil((Math.abs(deg) * RAD * r) / 4)
    const dh = (deg * RAD) / steps
    for (let k = 0; k < steps; k++) {
      h += dh
      x += ((Math.abs(deg) * RAD * r) / steps) * Math.sin(h)
      y += ((Math.abs(deg) * RAD * r) / steps) * Math.cos(h)
      pts.push([x, y])
    }
  }
  pts.push([0, 0])
  go(300)
  turn(50, 90)
  go(250)
  turn(35, -180)
  go(300)
  const kx = Math.cos(ORIGIN[0] * RAD) * 6371008.8 * RAD
  const ky = 6371008.8 * RAD
  return pts.map(([px, py]) => [ORIGIN[0] + py / ky, ORIGIN[1] + px / kx])
}

function compare(A, truth) {
  let se = 0
  let c = 0
  let maxT = 0
  for (let i = 0; i < A.n; i++) {
    const T = truth.at(A.t[i])
    if (!A.valid[i] || T.v < 8) continue
    const tl = T.lean / RAD
    se += (A.lean[i] - tl) ** 2
    c++
    maxT = Math.max(maxT, Math.abs(tl))
  }
  return { rms: Math.sqrt(se / c), maxT }
}

const path = testPath()

describe('analizador', () => {
  for (const [name, opts] of [
    ['móvil normal', {}],
    ['acelerómetro con el signo al revés', { invert: true }],
    ['móvil más tumbado en el soporte', { tilt: 40 }],
  ]) {
    it(`recupera postura, inclinación y G (${name})`, () => {
      const ride = synthRide({ path, ...opts })
      const A = analyze(ride)
      expect(A.info.longFrom).toBe('imu')
      expect(A.info.leanFrom).toBe('gyro+roll')
      // «Adelante» en ejes del móvil
      const th = (opts.tilt ?? 15) * RAD
      const trueFwd = [0, Math.sin(th), -Math.cos(th)]
      const f = A.info.mount.fwd
      expect(Math.abs(f[0] * trueFwd[0] + f[1] * trueFwd[1] + f[2] * trueFwd[2])).toBeGreaterThan(0.97)
      // Inclinación
      const { rms, maxT } = compare(A, ride.truth)
      expect(rms).toBeLessThan(2.5)
      const S = A.stats
      expect(Math.abs(Math.max(S.leanL, S.leanR) - maxT)).toBeLessThan(3)
      expect(S.leanL).toBeGreaterThan(20)
      expect(S.leanR).toBeGreaterThan(20)
      // Distancia y punta
      expect(Math.abs(A.d[A.n - 1] - ride.truth.dist) / ride.truth.dist).toBeLessThan(0.02)
      expect(Math.abs(S.vMax - ride.truth.vmax) * 3.6).toBeLessThan(2)
      // Frenada de la pasada: 7,5 m/s² (0,76 g) y un poco más justo al parar
      expect(S.brake).toBeGreaterThan(0.68)
      expect(S.brake).toBeLessThan(1.05)
    })
  }

  it('encuentra las dos curvas, a su lado, y las frenadas', () => {
    const A = analyze(synthRide({ path }))
    expect(A.corners.map((c) => c.dir)).toEqual(['R', 'L'])
    expect(A.corners[0].lean).toBeGreaterThan(25)
    expect(A.corners[1].vMin).toBeLessThan(A.corners[1].vIn)
    expect(A.brakes.length).toBeGreaterThanOrEqual(2)
    expect(A.runs).toHaveLength(1)
    expect(A.runs[0].marks['k0-100']).toBeGreaterThan(2)
  })

  it('sin sensores tira del GPS', () => {
    const ride = synthRide({ path, imu: false })
    const A = analyze(ride)
    expect(A.info.hasImu).toBe(false)
    expect(A.info.leanFrom).toBe('gps')
    const { rms } = compare(A, ride.truth)
    expect(rms).toBeLessThan(5)
    expect(A.corners.map((c) => c.dir)).toEqual(['R', 'L'])
  })

  it('las estadísticas de un tramo salen de ese tramo', () => {
    const A = analyze(synthRide({ path }))
    const c = A.corners[0]
    const S = rangeStats(A, c.i0, c.i1)
    expect(S.leanR).toBeCloseTo(c.lean, 5)
    expect(S.leanL).toBe(0)
    expect(S.dist).toBeCloseTo(c.len, 5)
  })

  it('lee el archivo exportado igual que la app lo escribe', () => {
    const ride = synthRide({ path })
    const file = parseExport(exportJson([ride]))
    expect(file.sessions).toHaveLength(1)
    const s = file.sessions[0]
    expect(s.meta.id).toBe(ride.meta.id)
    expect(Array.from(s.gps.slice(0, 22))).toEqual(Array.from(ride.gps.slice(0, 22)))
    expect(s.imu.length).toBe(ride.imu.length)
    expect(s.ev).toEqual(ride.ev)
  })
})
