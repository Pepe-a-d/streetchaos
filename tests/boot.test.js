// La app tiene que arrancar con cualquier ajuste guardado. Con un cero de inclinómetro guardado, el
// módulo de telemetría usaba una función antes de definirla y la app entera no arrancaba (pantalla
// morada en el iPhone, 2026-11-09).
import { describe, it, expect, vi } from 'vitest'

const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }

describe('arranque con ajustes guardados', () => {
  it('carga la telemetría con el cero del inclinómetro y el signo del giroscopio guardados', async () => {
    mem.set('sc-settings', JSON.stringify({ leanZero: Math.PI / 2 + 0.07, gyroSign: 1, onboarded: true }))
    vi.resetModules()
    const tel = await import('../src/core/telemetry.js')
    // La desviación respecto a la orientación más cercana (0,07 rad), no el ángulo absoluto
    expect(tel.__test.M.offset).toBeCloseTo(0.07, 6)
    expect(tel.__test.M.sign).toBe(1)
  })

  it('carga con ajustes raros o rotos sin romperse', async () => {
    for (const raw of ['{"leanZero":"x","gyroSign":null}', 'no es json', '{"dashPages":[{"items":[{"w":"nada"}]}],"theme":"inventado"}']) {
      mem.set('sc-settings', raw)
      vi.resetModules()
      await expect(import('../src/core/telemetry.js')).resolves.toBeTruthy()
      await expect(import('../src/core/achievements.js')).resolves.toBeTruthy()
    }
  })
})
