// Analizador de /blackbox: con una salida inventada de la que se sabe la verdad (synth.js),
// comprueba que recupera la postura del móvil, la inclinación, las G, la distancia y las curvas.
import { describe, it, expect } from 'vitest'
import { synthRide, exportJson } from '../src/blackbox/synth.js'
import { analyze, rangeStats } from '../src/blackbox/process.js'
import { parseExport } from '../src/blackbox/library.js'
import { toBase64 } from '../src/core/blackbox.js'

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
  for (const [name, opts, leanFrom] of [
    ['móvil normal', {}, 'gravity'],
    ['acelerómetro con el signo al revés', { invert: true }, 'gravity'],
    ['móvil más tumbado en el soporte', { tilt: 40 }, 'gravity'],
    ['sin la gravedad del sistema', { sys: false }, 'gyro+roll'],
    // Como el de la primera salida real: casi plano, gravedad al revés, alpha = x, beta = y, gamma = z, GPS 1 s tarde
    ['iPhone', { ios: true, gpsLag: 1, tilt: 22 }, 'gravity'],
  ]) {
    it(`recupera postura, inclinación y G (${name})`, () => {
      const ride = synthRide({ path, ...opts })
      const A = analyze(ride)
      expect(A.info.longFrom).toBe('imu')
      expect(A.info.leanFrom).toBe(leanFrom)
      expect(A.info.gyroAxes).toBe(opts.ios ? 'xyz' : 'w3c')
      expect(Math.abs(A.info.gpsLag - (opts.gpsLag ?? 0))).toBeLessThan(0.25)
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

  it('parado sin velocidad del GPS y con saltos de posición no salen puntas falsas', () => {
    const ride = synthRide({ path, speedGaps: true })
    const A = analyze(ride)
    expect(A.info.doppler).toBeLessThan(1)
    expect(Math.abs(A.stats.vMax - ride.truth.vmax) * 3.6).toBeLessThan(2)
    expect(Math.max(A.stats.leanL, A.stats.leanR)).toBeLessThan(45)
  })

  it('encuentra las dos curvas, a su lado, y las frenadas', () => {
    const A = analyze(synthRide({ path }))
    expect(A.corners.map((c) => c.dir)).toEqual(['R', 'L'])
    expect(A.corners[0].lean).toBeGreaterThan(25)
    expect(A.corners[1].vMin).toBeLessThan(A.corners[1].vIn)
    expect(A.brakes.length).toBeGreaterThanOrEqual(2)
    expect(A.runs).toHaveLength(1)
    expect(A.runs[0].marks['k0-100']).toBeGreaterThan(2)
  })

  it('si el móvil se mueve en marcha (al colocarlo, en la mano), no salen curvas ni inclinaciones imposibles (9-11-2026)', () => {
    const ride = synthRide({ path, ios: true, gpsLag: 1, tilt: 22 })
    // Una recta a más de 30 km/h: ahí la moto va derecha
    let t0 = 0
    for (let t = 5; t < ride.truth.tEnd - 5; t += 0.5) {
      let ok = true
      for (let q = 0; q <= 4; q += 0.25) if (ride.truth.at(t + q).v < 9 || Math.abs(ride.truth.at(t + q).lean) > 2 * RAD) ok = false
      if (ok) {
        t0 = t
        break
      }
    }
    expect(t0).toBeGreaterThan(0)
    // 3 s con el móvil girado 50° sobre su eje x y otros 50° sobre el y (en la mano) y dando vueltas
    const W = 10
    const imu = Float32Array.from(ride.imu)
    const c = Math.cos(50 * RAD)
    const sn = Math.sin(50 * RAD)
    for (let k = 0; k < imu.length; k += W) {
      const t = imu[k]
      if (t < t0 + 0.5 || t > t0 + 3.5) continue
      for (const o of [1, 4]) {
        let [x, y, z] = [imu[k + o], imu[k + o + 1], imu[k + o + 2]]
        ;[y, z] = [c * y - sn * z, sn * y + c * z]
        ;[x, z] = [c * x + sn * z, -sn * x + c * z]
        imu[k + o] = x
        imu[k + o + 1] = y
        imu[k + o + 2] = z
      }
      imu[k + 7] = 140
      imu[k + 8] = -90
    }
    const A = analyze({ ...ride, imu })
    expect(A.info.leanFrom).toBe('gravity')
    expect(A.info.leanFixed).toBeGreaterThan(1)
    const truthMax = Math.max(...A.corners.map((x) => 0), compare(A, ride.truth).maxT)
    expect(Math.max(A.stats.leanL, A.stats.leanR)).toBeLessThan(truthMax + 6)
    // Ninguna curva en esa recta
    const i0 = Math.round((t0 - A.T0) / 0.1)
    expect(A.corners.some((x) => x.i1 >= i0 && x.i0 <= i0 + 40)).toBe(false)
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

  it('lee el archivo del modo rescate (caja negra en trozos y localStorage)', () => {
    const ride = synthRide({ path })
    // Dos trozos por flujo, partiendo por filas enteras
    const half = (arr, w) => {
      const rows = arr.length / w
      const cut = Math.floor(rows / 2) * w
      return [arr.slice(0, cut), arr.slice(cut)]
    }
    const [g1, g2] = half(ride.gps, 11)
    const [i1, i2] = half(ride.imu, 10)
    const [c1, c2] = half(ride.calc, 5)
    const rescue = {
      format: 'streetchaos-rescue',
      localStorage: { 'sc-runs': JSON.stringify([{ id: 'r1' }]), 'sc-races': '[]', 'sc-settings': '{"units":"kmh"}' },
      telemetry: {
        sessions: [ride.meta],
        chunks: [
          { id: ride.meta.id, seq: 1, gps: toBase64(g2), imu: toBase64(i2), calc: toBase64(c2), ev: [] },
          { id: ride.meta.id, seq: 0, gps: toBase64(g1), imu: toBase64(i1), calc: toBase64(c1), ev: ride.ev },
        ],
      },
    }
    const file = parseExport(JSON.stringify(rescue))
    expect(file.runs).toEqual([{ id: 'r1' }])
    expect(file.sessions).toHaveLength(1)
    const s = file.sessions[0]
    expect(Array.from(s.gps)).toEqual(Array.from(ride.gps))
    expect(s.imu.length).toBe(ride.imu.length)
    expect(s.imu[1234]).toBe(ride.imu[1234])
    expect(s.ev).toEqual(ride.ev)
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
