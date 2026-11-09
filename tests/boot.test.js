// La app tiene que arrancar con cualquier ajuste guardado. Con un cero de inclinómetro guardado, el
// módulo de telemetría usaba una función antes de definirla y la app entera no arrancaba (pantalla
// morada en el iPhone, 2026-11-09).
import { describe, it, expect, vi } from 'vitest'

const mem = new Map()
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }

describe('arranque con ajustes guardados', () => {
  it('carga la telemetría con calibraciones guardadas, nuevas y antiguas', async () => {
    const mount = { up: [0.375, 0, 0.927], right: [0, -1, 0], angle: 90, fwd: null, S: [0, 0, 0], W: 0, N: 0 }
    mem.set('sc-settings', JSON.stringify({ leanZero: Math.PI / 2 + 0.07, gyroSign: 1, mount, leanSign: -1, gyroAxes: 'xyz', onboarded: true }))
    vi.resetModules()
    const tel = await import('../src/core/telemetry.js')
    expect(tel.__test.M.up).toEqual(mount.up)
    expect(tel.__test.M.right).toEqual(mount.right)
    expect(tel.__test.M.leanSign).toBe(-1)
    expect(tel.__test.M.axes).toBe('xyz')
  })

  it('carga con ajustes raros o rotos sin romperse', async () => {
    for (const raw of ['{"leanZero":"x","gyroSign":null}', '{"mount":{"up":"x"},"leanSign":"y"}', '{"mount":{"up":[0,0,1]}}', 'no es json', '{"dashPages":[{"items":[{"w":"nada"}]}],"theme":"inventado"}']) {
      mem.set('sc-settings', raw)
      vi.resetModules()
      await expect(import('../src/core/telemetry.js')).resolves.toBeTruthy()
      await expect(import('../src/core/achievements.js')).resolves.toBeTruthy()
    }
  })
})
