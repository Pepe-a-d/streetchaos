// Tramos y vueltas en directo: puertas de salida y meta, tiempo interpolado al cruzar, delta con la mejor.
import { describe, it, expect } from 'vitest'
import { crossing, gateFrom, gatesOf, createTimer, refAt, profileFrom } from '../src/core/live.js'

const RAD = Math.PI / 180
const O = [43.37, -8.4]
const kx = Math.cos(O[0] * RAD) * 6371008.8 * RAD
const ky = 6371008.8 * RAD
const ll = (x, y) => ({ lat: O[0] + y / ky, lon: O[1] + x / kx })

/** Óvalo de ~600 m: rectas de 200 m al norte y al sur y dos curvas de 31,8 m de radio. */
function oval(s) {
  const L1 = 200
  const r = 31.83
  const C = Math.PI * r
  const per = 2 * L1 + 2 * C
  s = ((s % per) + per) % per
  if (s < L1) return [0, s]
  if (s < L1 + C) {
    const a = (s - L1) / r
    return [r - r * Math.cos(a), L1 + r * Math.sin(a)]
  }
  if (s < 2 * L1 + C) return [2 * r, L1 - (s - L1 - C)]
  const a = (s - 2 * L1 - C) / r
  return [r + r * Math.cos(a), -r * Math.sin(a)]
}
const PER = 2 * 200 + 2 * Math.PI * 31.83

describe('puertas', () => {
  it('cruzar hacia delante da dónde; hacia atrás o lejos, nada', () => {
    const g = gateFrom(O[0], O[1], 0) // se cruza yendo al norte
    expect(crossing(ll(0, -5), ll(0, 5), g)).toBeCloseTo(0.5, 3)
    expect(crossing(ll(0, 5), ll(0, -5), g)).toBe(null)
    expect(crossing(ll(30, -5), ll(30, 5), g)).toBe(null)
    expect(crossing(ll(3, -2), ll(3, 8), g)).toBeCloseTo(0.2, 3)
  })
  it('las puertas de un trazado van con su rumbo', () => {
    const pts = Array.from({ length: 50 }, (_, k) => [O[0] + (k * 10) / ky, O[1]])
    const g = gatesOf(pts)
    expect(g.start.hdg).toBeCloseTo(0, 0)
    expect(g.end.lat).toBeCloseTo(pts[49][0], 9)
  })
})

describe('vueltas en directo', () => {
  /** Vueltas a 1 posición por segundo empezando 3,4 s antes de la meta; velocidad v(vuelta). */
  function ride(timer, laps, speed) {
    let s = -3.4 * speed(0)
    let t = 0
    let k = 0
    while (k < laps) {
      const v = speed(k)
      const [x, y] = oval(s)
      timer.feed({ t, v, ...ll(x, y) })
      t += 1
      s += v
      if (s > (k + 1) * PER) k++
    }
  }

  it('cronometra cada vuelta al cruzar la meta, con el delta contra la mejor', () => {
    const events = []
    const gate = gateFrom(O[0], O[1], 0)
    const timer = createTimer({ id: 'c', name: 'Óvalo', start: gate, end: gate, closed: true }, (e) => events.push(e))
    // Vueltas a 20, 21 y 19 m/s
    ride(timer, 3, (k) => [20, 21, 19][k] ?? 19)
    const laps = events.filter((e) => e.type === 'finish')
    expect(laps.length).toBeGreaterThanOrEqual(2)
    // La primera vuelta a 20 m/s (empieza al cruzar, interpolando entre posiciones de 1 s)
    expect(laps[0].time).toBeCloseTo(PER / 20, 0)
    expect(Math.abs(laps[0].time - PER / 20)).toBeLessThan(0.4)
    expect(laps[0].record).toBe(true)
    // La segunda, más rápida: récord; durante ella el delta va bajando
    expect(laps[1].record).toBe(true)
    const ticks = events.filter((e) => e.type === 'tick' && e.n === 2)
    expect(ticks.at(-1).delta).toBeLessThan(-0.8)
  })

  it('un tramo con su referencia (perfil cada 1 %): tiempo y delta; si te sales, se anula', () => {
    const pts = Array.from({ length: 101 }, (_, k) => [O[0] + (k * 10) / ky, O[1]]) // 1 km al norte
    const { start, end } = gatesOf(pts)
    const prof = profileFrom([[0, 0], [1000, 50]], 1000) // la mejor: 50 s (20 m/s)
    const events = []
    const timer = createTimer({ id: 's', name: 'Recta', start, end, length: 1000, closed: false, best: 50, ref: { prof, length: 1000 } }, (e) => events.push(e))
    for (let t = 0; t < 60; t++) timer.feed({ t, v: 22, ...ll(0, -15 + t * 22) })
    const fin = events.find((e) => e.type === 'finish')
    expect(fin.time).toBeCloseTo(1000 / 22, 1)
    expect(fin.record).toBe(true)
    const mid = events.filter((e) => e.type === 'tick').find((e) => e.d > 480)
    expect(mid.delta).toBeCloseTo(mid.elapsed - (mid.d / 1000) * 50, 1)
    expect(refAt({ prof, length: 1000 }, 500)).toBeCloseTo(25, 5)
    // Otra vez, pero se va por otro lado a mitad (no cruza la meta y se pasa de distancia)
    const ev2 = []
    const t2 = createTimer({ id: 's', name: 'Recta', start, end, length: 1000, closed: false, best: 50 }, (e) => ev2.push(e))
    for (let t = 0; t < 120; t++) t2.feed({ t, v: 22, ...(t < 20 ? ll(0, -15 + t * 22) : ll((t - 20) * 22, 425)) })
    expect(ev2.some((e) => e.type === 'abort')).toBe(true)
    expect(ev2.some((e) => e.type === 'finish')).toBe(false)
  })
})
