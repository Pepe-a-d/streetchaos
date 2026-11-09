// Récords rehechos con la caja negra: los que se midieron mal (inclinación del iPhone, puntas por saltos
// de posición) se recalculan con el análisis nuevo y se quitan los logros que ya no se cumplen.
import { describe, it, expect, beforeEach } from 'vitest'

const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }

const store = await import('../src/core/store.js')
const ach = await import('../src/core/achievements.js')
const { recalcRecords, recalcMessage, CALC_VERSION } = await import('../src/core/recalc.js')
const { memoryStore } = await import('../src/core/blackbox.js')
const { synthRide } = await import('../src/blackbox/synth.js')
const { analyze } = await import('../src/blackbox/process.js')

const RAD = Math.PI / 180
/** Recta, curva a derecha y recta (en lat/lon) */
function path() {
  const pts = [[0, 0]]
  let x = 0
  let y = 0
  let h = 0
  const step = (len) => {
    for (let s = 0; s < len; s += 4) pts.push([(x += 4 * Math.sin(h)), (y += 4 * Math.cos(h))])
  }
  step(400)
  for (let k = 0; k < 20; k++) ((h += (90 * RAD) / 20), step(4))
  step(400)
  const kx = Math.cos(43.37 * RAD) * 6371008.8 * RAD
  const ky = 6371008.8 * RAD
  return pts.map(([px, py]) => [43.37 + py / ky, -8.4 + px / kx])
}

beforeEach(() => {
  ach.resetAchievements()
  Object.assign(store.totals, { odo: 50000, maxV: 35.9, maxLeanL: 71.4, maxLeanR: 72.1, maxG: 1.72, calcVersion: undefined })
})

describe('récords rehechos con la caja negra', () => {
  it('recalcula punta, inclinación y G, quita los logros falsos y no lo repite', async () => {
    const ride = synthRide({ path: path(), speedGaps: true, ios: true, gpsLag: 1, tilt: 22 })
    const db = memoryStore()
    await db.putChunk({ ...ride.meta, source: 'real' }, { id: ride.meta.id, seq: 0, gps: ride.gps, imu: ride.imu, calc: ride.calc, ev: ride.ev })
    ach.checkAchievements() // se apuntan los de antes (con los datos falsos)
    expect(ach.unlocked.lean45).toBeTruthy()
    expect(ach.unlocked.g1).toBeTruthy()

    const r = await recalcRecords({ store: db, analyze })
    expect(r.sessions).toBe(1)
    expect(Math.abs(store.totals.maxV - ride.truth.vmax) * 3.6).toBeLessThan(2)
    expect(Math.max(store.totals.maxLeanL, store.totals.maxLeanR)).toBeLessThan(45)
    expect(store.totals.maxG).toBeLessThan(1)
    expect(store.totals.calcVersion).toBe(CALC_VERSION)
    expect(r.removed.map((a) => a.id)).toEqual(expect.arrayContaining(['lean45', 'g1']))
    expect(ach.unlocked.lean45).toBeUndefined()
    expect(ach.unlocked.km10).toBeTruthy() // los demás no se tocan
    expect(recalcMessage(r)).toMatch(/^RECORDS RECALCULADOS/)
    expect(await recalcRecords({ store: db, analyze })).toBe(null)
  })

  it('sin salidas guardadas: la punta se queda e inclinación y G vuelven a cero', async () => {
    const r = await recalcRecords({ store: memoryStore(), analyze })
    expect(r.sessions).toBe(0)
    expect(store.totals.maxV).toBe(35.9)
    expect(store.totals.maxLeanR).toBe(0)
    expect(store.totals.maxG).toBe(0)
  })
})
