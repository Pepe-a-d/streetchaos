import { describe, it, expect } from 'vitest'
import { RunRecorder, launchOnset, buildTrace, crossSpeed, crossDist, scoreRace, KMH, MILE } from '../src/core/perf.js'
import { BIKES, fullThrottleTrace } from '../src/core/physics.js'
import { geohash, geohashNeighborhood, haversine } from '../src/core/geo.js'

/** Muestras GPS a `hz` de una traza fina, empezando parado 3 s antes de la salida (t=10). */
function gpsFrom(fine, { hz = 1, phase = 0.4, noise = 0, seed = 1, until = 25 } = {}) {
  let r = seed
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647 - 0.5) * 2
  const out = []
  const T0 = 10
  for (let t = T0 - 3 + phase; t < T0 + until; t += 1 / hz) {
    const rel = t - T0
    let v = 0
    if (rel > 0) {
      const i = fine.findIndex((p) => p.t >= rel)
      if (i < 0) break
      const a = fine[i - 1] || fine[0]
      const b = fine[i]
      v = a.v + ((b.v - a.v) * (rel - a.t)) / (b.t - a.t || 1)
    }
    out.push({ t, v: Math.max(0, v + (rel > 0 ? noise * rnd() : 0)), acc: 4 })
  }
  return out
}

describe('cálculo de parciales', () => {
  it('es exacto con aceleración constante', () => {
    const a = 8
    const fine = []
    for (let t = 0; t <= 30; t += 0.01) fine.push({ t, v: a * t })
    const rec = new RunRecorder()
    for (const s of gpsFrom(fine, { phase: 0.37 })) rec.feed(s)
    rec.finish()
    const r = rec.result
    expect(r.t0).toBeCloseTo(10, 6)
    expect(r.marks['k0-100'].t).toBeCloseTo(100 * KMH / a, 4)
    expect(r.marks['1/8'].t).toBeCloseTo(Math.sqrt((2 * MILE) / 8 / a), 4)
    expect(r.marks['k100-200'].t).toBeCloseTo((100 * KMH) / a, 4)
  })

  it('interpola bien una moto real muestreada a 1 Hz', () => {
    const fine = fullThrottleTrace(BIKES.sport, 30)
    const truth = {
      k100: crossSpeed(fine, 100 * KMH),
      q: crossDist(fine, MILE / 4),
      e: crossDist(fine, MILE / 8),
    }
    let worst = { k100: 0, q: 0, e: 0, trap: 0 }
    for (let k = 0; k < 20; k++) {
      const rec = new RunRecorder()
      for (const s of gpsFrom(fine, { phase: k / 20, noise: 0.12, seed: k + 3 })) rec.feed(s)
      rec.finish()
      const m = rec.result.marks
      worst.k100 = Math.max(worst.k100, Math.abs(m['k0-100'].t - truth.k100))
      worst.q = Math.max(worst.q, Math.abs(m['1/4'].t - truth.q.t))
      worst.e = Math.max(worst.e, Math.abs(m['1/8'].t - truth.e.t))
      worst.trap = Math.max(worst.trap, Math.abs(m['1/4'].v - truth.q.v) * 3.6)
    }
    console.log('SPORT 600 real →', { '0-100': truth.k100.toFixed(2), '1/8': truth.e.t.toFixed(2), '1/4': truth.q.t.toFixed(2), trap: (truth.q.v * 3.6).toFixed(0) }, 'peor error a 1 Hz →', worst)
    expect(worst.k100).toBeLessThan(0.15)
    expect(worst.e).toBeLessThan(0.15)
    expect(worst.q).toBeLessThan(0.15)
    expect(worst.trap).toBeLessThan(3)
  })

  it('termina la pasada al cortar gas y no arma con mala señal', () => {
    const rec = new RunRecorder()
    rec.feed({ t: 0, v: 0, acc: 80 })
    rec.feed({ t: 1, v: 0, acc: 80 })
    expect(rec.state).toBe('idle')
    rec.feed({ t: 2, v: 0, acc: 5 })
    rec.feed({ t: 3, v: 0, acc: 5 })
    expect(rec.state).toBe('armed')
    rec.feed({ t: 4, v: 6, acc: 5 })
    rec.feed({ t: 5, v: 14, acc: 5 })
    rec.feed({ t: 6, v: 20, acc: 5 })
    expect(rec.state).toBe('running')
    rec.feed({ t: 7, v: 16, acc: 5 })
    expect(rec.state).toBe('done')
    expect(rec.result.reason).toBe('lift')
    expect(rec.result.marks['k0-50']).toBeTruthy()
  })

  it('la traza integra la distancia con trapecios', () => {
    const pts = buildTrace(0, [{ t: 1, v: 10 }, { t: 2, v: 20 }])
    expect(pts[2].d).toBeCloseTo(5 + 15, 6)
  })
})

describe('duelos', () => {
  it('gana quien llega antes desde el verde', () => {
    expect(scoreRace({ rt: 0.3, et: 10 }, { rt: 0.1, et: 10.1 }).win).toBe(false)
    expect(scoreRace({ rt: 0.1, et: 10 }, { rt: 0.3, et: 9.9 }).win).toBe(true)
  })
  it('salir antes de tiempo pierde', () => {
    expect(scoreRace({ rt: -0.05, et: 9, foul: true }, { rt: 0.5, et: 12 }).win).toBe(false)
    expect(scoreRace({ rt: 0.5, et: 12 }, { rt: 0, et: 0, dnf: true }).win).toBe(true)
  })
})

describe('geo', () => {
  it('geohash conocido y vecinas', () => {
    expect(geohash(57.64911, 10.40744, 11)).toBe('u4pruydqqvj')
    const n = geohashNeighborhood('ezs42e')
    expect(n).toHaveLength(9)
    expect(n).toContain('ezs42e')
    expect(n).toContain('ezs42s')
  })
  it('haversine', () => {
    expect(haversine(0, 0, 0, 1)).toBeCloseTo(111195, -2)
  })
})

describe('traza con el acelerómetro entre muestras', () => {
  // Salida real con cambio de marcha: 4 m/s² hasta 1,5 s y luego 1 m/s². El GPS a 1 Hz no lo ve.
  const vTrue = (t) => (t < 1.5 ? 4 * t : 6 + (t - 1.5))
  const samples = [1, 2, 3, 4].map((t) => ({ t, v: vTrue(t) }))
  const accel = []
  for (let t = 0; t <= 4.001; t += 0.1) accel.push([t, t < 1.5 ? 4 : 1])

  it('sin acelerómetro, la recta entre muestras llega tarde a los 6 m/s', () => {
    expect(crossSpeed(buildTrace(0, samples), 6)).toBeCloseTo(1.8, 2)
  })
  it('con acelerómetro cae donde toca y pasa justo por las muestras del GPS', () => {
    const pts = buildTrace(0, samples, accel)
    expect(Math.abs(crossSpeed(pts, 6) - 1.5)).toBeLessThan(0.1) // la recta daba 1,8
    for (const s of samples) expect(pts.find((p) => p.t === s.t).v).toBeCloseTo(s.v, 6)
    // Distancia a los 4 s: 4,5 m hasta 1,5 s y 6·2,5 + 2,5²/2 después
    expect(pts.at(-1).d).toBeCloseTo(4.5 + 15 + 3.125, 0)
  })
  it('con un hueco en el acelerómetro, ese tramo va en recta', () => {
    const holed = accel.filter(([t]) => t < 1.2 || t > 2.6)
    const pts = buildTrace(0, samples, holed)
    expect(pts.some((p) => p.t > 1 && p.t < 2)).toBe(false)
  })
})

describe('arranque con el acelerómetro', () => {
  it('busca hacia atrás dónde empezó a acelerar, sin pasar de 1 s', () => {
    // Quieto, embrague suave desde 10,0 s, tirón detectado a 10,4 s
    const acc = []
    for (let t = 8; t <= 11; t += 0.1) acc.push([Math.round(t * 10) / 10, t < 9.95 ? 0.1 : t < 10.35 ? 1 : 3])
    expect(launchOnset(10.4, acc)).toBeCloseTo(10, 6)
    expect(launchOnset(10.4, [])).toBe(10.4)
    const long = acc.map(([t]) => [t, 2])
    expect(launchOnset(10.4, long)).toBeCloseTo(9.4, 6)
  })
})

