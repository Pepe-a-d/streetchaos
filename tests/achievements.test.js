// Logros (cuándo salen y el nivel) y lo que la voz dice sola (velocidad, GPS, curvas).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const said = []
vi.mock('../src/core/voice.js', () => ({ say: (text, o) => said.push([text, o?.kind]), spoken: (x) => String(x) }))

// localStorage en memoria (en Node no hay)
const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }

const store = await import('../src/core/store.js')
const ach = await import('../src/core/achievements.js')
const { T } = await import('../src/core/telemetry.js')
const { watch } = await import('../src/core/announcer.js')

beforeEach(() => {
  ach.resetAchievements()
  Object.assign(store.totals, { odo: 0, maxV: 0, maxLeanL: 0, maxLeanR: 0, maxG: 0, time: 0, longTrip: 0, night: false, sessions: 0 })
  store.runs.length = 0
  store.races.length = 0
  said.length = 0
})

describe('logros', () => {
  it('la primera vez apunta sin fiesta lo que ya tenías; luego avisa de cada nuevo', () => {
    const events = []
    const off = ach.onAchievement((e) => events.push(e))
    store.totals.odo = 120000 // 120 km
    ach.checkAchievements()
    expect(events.map((e) => e.type)).toEqual(['catchup'])
    expect(events[0].list.map((a) => a.id)).toEqual(['km10', 'km100'])
    store.totals.maxLeanR = 36
    ach.checkAchievements()
    expect(events.slice(1).filter((e) => e.type === 'unlock').map((e) => e.a.id)).toEqual(['lean20', 'lean35'])
    ach.checkAchievements()
    expect(events.filter((e) => e.type === 'unlock')).toHaveLength(2) // no se repiten
    off()
  })

  it('los tiempos cuentan por debajo de la meta', () => {
    ach.checkAchievements()
    store.runs.push({ valid: true, date: 1, marks: { 'k0-100': { t: 3.9 }, '1/4': { t: 12.5 } } })
    const fresh = ach.checkAchievements().map((a) => a.id)
    expect(fresh).toEqual(expect.arrayContaining(['run1', 'k6', 'k4', 'q14']))
    expect(fresh).not.toContain('k32')
    expect(fresh).not.toContain('q11')
  })

  it('duelos: ganar al fantasma y a un piloto de verdad', () => {
    ach.checkAchievements()
    store.races.push({ win: true, opp: { kind: 'ghost' } }, { win: false, opp: { kind: 'online' } })
    expect(ach.checkAchievements().map((a) => a.id)).toEqual(['duel1', 'win1', 'ghost'])
    store.races.push({ win: true, opp: { kind: 'online' } })
    expect(ach.checkAchievements().map((a) => a.id)).toEqual(['online'])
  })

  it('el nivel sube con la experiencia y avisa', () => {
    const events = []
    const off = ach.onAchievement((e) => events.push(e))
    ach.checkAchievements()
    expect(ach.level().n).toBe(1)
    store.totals.odo = 160000 // 160 km → 160 XP + km10 y km100 (20) = 180 → nivel 3
    ach.checkAchievements()
    const lv = ach.level()
    expect(lv.n).toBe(3)
    expect(lv.rank).toBe('AFICIONADO')
    expect(events.some((e) => e.type === 'level' && e.lv.n === 3)).toBe(true)
    off()
  })
})

describe('voz automática', () => {
  const frame = (n, fn) => {
    for (let i = 0; i < n; i++) (fn?.(i), watch(0.05))
  }

  it('avisa al pasar de cada velocidad elegida, una vez, y se rearma al bajar', () => {
    store.settings.units = 'kmh'
    store.settings.speedAlerts = [50, 90]
    T.status = 'ok'
    T.vDisp = 40 / 3.6
    frame(5)
    T.vDisp = 55 / 3.6
    frame(5)
    T.vDisp = 95 / 3.6
    frame(5)
    T.vDisp = 92 / 3.6
    frame(5)
    expect(said.filter((s) => s[1] === 'speed').map((s) => s[0])).toEqual(['50', '90'])
    T.vDisp = 80 / 3.6 // 10 por debajo: se rearma
    frame(5)
    T.vDisp = 91 / 3.6
    frame(5)
    expect(said.filter((s) => s[1] === 'speed').map((s) => s[0])).toEqual(['50', '90', '90'])
  })

  it('GPS perdido y recuperado, pero no al arrancar', () => {
    T.status = 'waiting'
    frame(2)
    T.status = 'ok'
    frame(2)
    expect(said.filter((s) => s[1] === 'gps')).toHaveLength(0)
    T.status = 'lost'
    frame(100) // 5 s
    T.status = 'ok'
    frame(2)
    expect(said.filter((s) => s[1] === 'gps').map((s) => s[0])).toEqual(['GPS perdido', 'GPS de nuevo'])
  })

  it('la inclinación de una curva fuerte se dice al enderezar', () => {
    T.status = 'ok'
    T.v = 15
    const deg = (d) => (T.lean = (d * Math.PI) / 180)
    frame(20, (i) => deg(-10 - i * 2)) // hasta 48° a la izquierda
    expect(said.filter((s) => s[1] === 'lean')).toHaveLength(0)
    frame(10, () => deg(-5))
    expect(said.filter((s) => s[1] === 'lean').map((s) => s[0])).toEqual(['48 grados izquierda'])
    // Una curva suave no dice nada
    frame(20, (i) => deg(i))
    frame(10, () => deg(2))
    expect(said.filter((s) => s[1] === 'lean')).toHaveLength(1)
  })
})
