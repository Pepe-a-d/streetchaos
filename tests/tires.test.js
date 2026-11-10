// Temperatura estimada de los neumáticos: que el modelo haga lo que tiene que hacer (calienta rodando,
// frenando y en curva, cada zona con su inclinación; se enfría parado y con lluvia) y que la calibración
// encuentre el factor con unas medidas de termómetro.
import { describe, it, expect } from 'vitest'
import { createTireModel, modelConfig, runSeries, calibrate, combinedK, treadUsage, parseSize, tireState, roadTemp, defaultTireSettings } from '../src/core/tires.js'

const cfg = modelConfig(defaultTireSettings())
const ride = (m, secs, inp, env = { tAir: 15 }) => {
  for (let t = 0; t < secs; t += 0.1) m.step(0.1, typeof inp === 'function' ? inp(t) : inp, env)
  return m.state
}
/** Una salida de ciudad: acelera, va, frena fuerte y para; con curvas a los dos lados. */
function city(n = 6000) {
  const s = { n, dt: 0.1, v: new Float32Array(n), gLong: new Float32Array(n), gLat: new Float32Array(n), lean: new Float32Array(n) }
  for (let i = 0; i < n; i++) {
    const c = i % 400 // ciclos de 40 s
    const v = c < 60 ? c * 0.25 : c < 300 ? 15 : c < 340 ? 15 - (c - 300) * 0.375 : 0
    s.v[i] = v
    s.gLong[i] = c < 60 ? 0.25 : c >= 300 && c < 340 ? -0.38 : 0
    const lean = c >= 120 && c < 180 ? 25 : c >= 200 && c < 260 ? -25 : 0
    s.lean[i] = v > 3 ? lean : 0
    s.gLat[i] = Math.tan((s.lean[i] * Math.PI) / 180)
  }
  return s
}

describe('modelo térmico', () => {
  it('parado no cambia; rodando se calienta unos grados por encima del aire', () => {
    const m = createTireModel(cfg, 15)
    ride(m, 600, { v: 0 })
    expect(m.state.r.core).toBeCloseTo(15, 3)
    ride(m, 20 * 60, { v: 14 })
    const s = m.state
    expect(s.r.core).toBeGreaterThan(19)
    expect(s.r.core).toBeLessThan(45)
    expect(s.r.C).toBeGreaterThan(s.r.L) // en recta trabaja el centro
  })

  it('frenar calienta sobre todo la delantera; tumbar a la derecha, el hombro derecho', () => {
    const a = createTireModel(cfg, 15)
    ride(a, 120, (t) => ({ v: 18, gLong: t % 10 < 3 ? -0.7 : 0.15 }))
    expect(a.state.f.C - 15).toBeGreaterThan(a.state.r.C - 15)
    const b = createTireModel(cfg, 15)
    ride(b, 120, { v: 15, lean: 35, gLat: Math.tan((35 * Math.PI) / 180) })
    expect(b.state.r.R).toBeGreaterThan(b.state.r.L + 3)
    expect(b.state.r.R).toBeGreaterThan(b.state.r.C)
  })

  it('al parar se enfría; con lluvia se calienta mucho menos', () => {
    const m = createTireModel(cfg, 15)
    ride(m, 600, { v: 18, gLong: 0.1 })
    const hot = m.state.r.C
    ride(m, 600, { v: 0 })
    expect(m.state.r.C).toBeLessThan(hot - 2)
    const dry = runSeries(city(), cfg, { tAir: 12 })
    const wet = runSeries(city(), cfg, { tAir: 12, wet: true })
    expect(wet.rC.at(-1)).toBeLessThan(dry.rC.at(-1))
    expect(roadTemp({ tAir: 20, sun: 700 })).toBeGreaterThan(30)
  })

  it('cuanta menos presión, más calor', () => {
    const lo = runSeries(city(), modelConfig({ ...defaultTireSettings(), pRear: 1.6 }), { tAir: 15 })
    const hi = runSeries(city(), modelConfig({ ...defaultTireSettings(), pRear: 2.6 }), { tAir: 15 })
    expect(lo.rcore.at(-1)).toBeGreaterThan(hi.rcore.at(-1))
  })

  it('la calibración encuentra el factor con unas medidas de termómetro', () => {
    const series = city()
    const env = { tAir: 14, sun: 200 }
    // «La verdad»: un neumático que se calienta el doble de lo que dice el modelo sin calibrar
    const truth = runSeries(series, { ...cfg, k: 2.2 }, env)
    const m = createTireModel({ ...cfg, k: 2.2 }, truth.end)
    for (let t = 0; t < 60; t++) m.step(1, { v: 0 }, env)
    const meas = { fC: m.state.f.C, rC: m.state.r.C, rL: m.state.r.L, rR: m.state.r.R }
    const r = calibrate(series, defaultTireSettings(), env, meas, { after: 1 })
    expect(r.k).toBeGreaterThan(1.9)
    expect(r.k).toBeLessThan(2.5)
    expect(r.after).toBeLessThan(r.before)
    expect(combinedK([{ k: 2, mins: 1 }, { k: 2.4, mins: 1 }])).toBeGreaterThan(2)
  })

  it('el estado según el tipo de neumático', () => {
    expect(tireState(18, 'calle')).toBe('frio')
    expect(tireState(25, 'calle')).toBe('templado')
    expect(tireState(45, 'calle')).toBe('ok')
    expect(tireState(45, 'circuito')).toBe('frio')
    expect(parseSize('130/70-17').D).toBeCloseTo(0.614, 2)
    expect(parseSize('120/70 ZR17').W).toBeCloseTo(0.12, 3)
  })
})

describe('uso de la banda', () => {
  it('tiempo por zona, máximo a cada lado y la tira sin estrenar', () => {
    const lean = [...Array(100).fill(0), ...Array(50).fill(32), ...Array(50).fill(-20)]
    const u = treadUsage({ i0: 0, i1: lean.length - 1, lean: (i) => lean[i], valid: () => true, v: () => 10 }, 0.13)
    expect(u.maxR).toBe(32)
    expect(u.maxL).toBe(20)
    expect(u.share.C).toBeGreaterThan(0.5)
    expect(u.share.R).toBeGreaterThan(u.share.L)
    // A 32° queda casi media banda de ese lado sin usar; a 20°, más
    expect(u.unusedR).toBeGreaterThan(15)
    expect(u.unusedL).toBeGreaterThan(u.unusedR)
  })
})

describe('el tiempo de Open-Meteo', () => {
  it('coge la hora de la salida, el sol y si llovía; manda la posición redondeada', async () => {
    const { weatherAt, __test } = await import('../src/core/weather.js')
    const json = { hourly: { time: Array.from({ length: 24 }, (_, h) => `2026-11-10T${String(h).padStart(2, '0')}:00`), temperature_2m: Array.from({ length: 24 }, (_, h) => 8 + h * 0.5), shortwave_radiation: Array(24).fill(100), precipitation: Array.from({ length: 24 }, (_, h) => (h === 7 ? 1.2 : 0)) } }
    let asked = ''
    const w = await weatherAt(43.37123, -8.40456, Date.UTC(2026, 10, 10, 7, 30), async (url) => ((asked = url), { ok: true, json: async () => json }))
    expect(asked).toMatch(/latitude=43\.37&longitude=-8\.4&/)
    expect(asked).toMatch(/start_date=2026-11-10/)
    expect(w.tAir).toBe(11.8)
    expect(w.wet).toBe(true)
    expect(__test.url(43.37123, -8.40456, 0)).toBe('43.37,-8.4,1970-01-01')
    expect(await weatherAt(43, -8, Date.now(), async () => ({ ok: false }))).toBe(null)
  })
})

describe('la caja negra del móvil como serie', () => {
  it('pone las muestras en su sitio, rellena huecos cortos y cuenta lo parado al final', async () => {
    const { seriesFromCalc, trailingStop } = await import('../src/core/tires.js')
    const rows = []
    for (let k = 0; k <= 100; k++) if (k !== 50 && k !== 51) rows.push(k * 0.1, k < 80 ? 10 : 0, 0.1, 0, 5)
    const s = seriesFromCalc(new Float32Array(rows))
    expect(s.n).toBe(101)
    expect(s.v[50]).toBe(10)
    expect(s.lean[51]).toBe(5)
    expect(trailingStop(s)).toBeCloseTo(2.1, 5)
  })
})
