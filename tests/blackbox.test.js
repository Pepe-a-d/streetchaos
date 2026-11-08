// Caja negra: cuándo empieza y acaba una sesión, qué guarda y que se puede leer igual que se grabó.
import { describe, it, expect, beforeEach } from 'vitest'
import { createLogger, memoryStore, readSession, toBase64, STREAMS, RULES } from '../src/core/blackbox.js'

let clock
let store
let L
const EPOCH0 = Date.UTC(2026, 10, 9, 10, 0, 0)

function make(opts = {}) {
  store = memoryStore()
  L = createLogger({
    store,
    now: () => ({ perf: clock, epoch: EPOCH0 + clock * 1000 }),
    context: () => ({ source: 'test' }),
    snapshot: () => [1, 0.1, -0.2, 12.5],
    ...opts,
  })
  return L
}

/** Avanza el reloj `secs` segundos con GPS a 1 Hz a velocidad v, sensores a 50 Hz y tick cada 0,1 s. */
function ride(secs, v, { acc = 4, imu = true } = {}) {
  const end = clock + secs
  let nextFix = Math.ceil(clock)
  while (clock < end - 1e-9) {
    clock = Math.round((clock + 0.02) * 1000) / 1000
    if (imu) L.motion({ accelerationIncludingGravity: { x: 0.1, y: 9.8, z: 0.3 }, acceleration: { x: 0, y: 0, z: 0 }, rotationRate: { alpha: 1, beta: 2, gamma: 3 }, interval: 20 }, clock)
    if (Math.abs(clock * 10 - Math.round(clock * 10)) < 1e-6) L.tick()
    if (clock >= nextFix) {
      L.gps({ t: clock, ts: EPOCH0 + clock * 1000, lat: 43.3712345678 + clock * 1e-5, lon: -8.4022123456, acc, alt: 18.5, altAcc: 3, speedRaw: v, headingRaw: 78, v, heading: v > 1 ? 78 : null })
      nextFix += 1
    }
  }
}

const sessions = async () => (await store.listMeta()).sort((a, b) => a.start - b.start)

beforeEach(async () => {
  clock = 100
  make()
  await L.recover()
})

describe('caja negra', () => {
  it('no graba parado, pero se queda con los últimos 30 s', async () => {
    ride(120, 0)
    await L.flush()
    expect(await sessions()).toHaveLength(0)
    const first = L.state.buf.gps[0]
    expect(clock - first).toBeLessThanOrEqual(RULES.preRoll + 1)
  })

  it('empieza al moverse con buen GPS e incluye la salida desde parado', async () => {
    ride(40, 0)
    ride(20, 15)
    await L.flush()
    const [m] = await sessions()
    expect(m.state).toBe('rec')
    expect(m.source).toBe('test')
    const s = await readSession(store, m)
    const W = STREAMS.gps.fields.length
    expect(s.gps.length % W).toBe(0)
    // la primera fila es de unos 30 s antes de arrancar y está parada
    expect(s.gps[0]).toBeGreaterThanOrEqual(0)
    expect(s.gps[STREAMS.gps.fields.indexOf('v')]).toBe(0)
    // inicio de la sesión = hora real de la primera muestra guardada
    const firstAbs = EPOCH0 + (140 - RULES.preRoll) * 1000
    expect(Math.abs(m.start - firstAbs)).toBeLessThan(1500)
    // posiciones exactas (float64)
    expect(s.gps[2]).toBeCloseTo(43.3712345678 + (L.state.t0 + s.gps[0]) * 1e-5, 9)
    expect(s.gps[3]).toBe(-8.4022123456)
    // sensores a 50 Hz y lo calculado a 10 Hz
    expect(s.imu.length / STREAMS.imu.fields.length).toBeGreaterThan(50 * 45)
    expect(s.calc.length / STREAMS.calc.fields.length).toBeGreaterThan(10 * 45)
    expect(m.imuInterval).toBe(20)
  })

  it('con GPS malo no empieza', async () => {
    ride(30, 20, { acc: 60 })
    await L.flush()
    expect(await sessions()).toHaveLength(0)
  })

  it('el tiempo de cada flujo crece siempre y la distancia cuadra', async () => {
    ride(10, 0)
    ride(60, 20)
    await L.flush()
    const [m] = await sessions()
    const s = await readSession(store, m)
    for (const k of ['gps', 'imu', 'calc']) {
      const w = STREAMS[k].fields.length
      for (let i = w; i < s[k].length; i += w) expect(s[k][i]).toBeGreaterThan(s[k][i - w])
    }
    expect(m.dist).toBeGreaterThan(20 * 58)
    expect(m.dist).toBeLessThan(20 * 61)
    expect(m.chunks).toBeGreaterThan(10)
  })

  it('termina tras 3 minutos parado y la siguiente salida es otra sesión', async () => {
    ride(30, 15)
    ride(RULES.endAfter + 5, 0)
    ride(20, 15)
    await L.flush()
    const [a, b] = await sessions()
    expect(a.state).toBe('done')
    expect(a.end).toBeGreaterThan(a.start)
    expect(b.state).toBe('rec')
    expect(b.id).not.toBe(a.id)
  })

  it('si la app se recarga a mitad, la sesión sigue con el mismo id', async () => {
    ride(30, 15)
    await L.flush()
    const [before] = await sessions()
    // Recarga: otro logger con el mismo almacén, 20 s después
    clock += 20
    const old = store
    L = createLogger({ store: old, now: () => ({ perf: clock, epoch: EPOCH0 + clock * 1000 }), snapshot: () => [0, 0, 0, 0] })
    await L.recover()
    expect(L.recording).toBe(true)
    ride(10, 15)
    await L.flush()
    const [after] = await sessions()
    expect(after.id).toBe(before.id)
    expect(after.resumed).toBe(1)
    const s = await readSession(store, after)
    const w = STREAMS.gps.fields.length
    const ts = []
    for (let i = 0; i < s.gps.length; i += w) ts.push(s.gps[i])
    expect(ts.every((t, i) => i === 0 || t > ts[i - 1])).toBe(true)
    // el hueco de la recarga se ve en los tiempos relativos
    expect(Math.max(...ts.map((t, i) => (i ? t - ts[i - 1] : 0)))).toBeGreaterThan(15)
    expect(s.ev.some((e) => e.type === 'resume')).toBe(true)
  })

  it('una sesión vieja que se quedó a medias se cierra al abrir', async () => {
    ride(30, 15)
    await L.flush()
    clock += 3600
    L = createLogger({ store, now: () => ({ perf: clock, epoch: EPOCH0 + clock * 1000 }) })
    await L.recover()
    expect(L.recording).toBe(false)
    const [m] = await sessions()
    expect(m.state).toBe('done')
  })

  it('apagada no graba', async () => {
    make({ enabled: () => false })
    await L.recover()
    ride(30, 20)
    await L.flush()
    expect(await sessions()).toHaveLength(0)
  })

  it('los eventos llevan su hora relativa', async () => {
    ride(5, 0)
    L.event('calib', { leanZero: 0.1 })
    ride(10, 15)
    L.event('run', { id: 'abc' }, clock - 2)
    await L.flush()
    const [m] = await sessions()
    const s = await readSession(store, m)
    const run = s.ev.find((e) => e.type === 'run')
    expect(run.id).toBe('abc')
    expect(run.t).toBeCloseTo(clock - 2 - L.state.t0, 3)
    expect(s.ev.find((e) => e.type === 'calib').t).toBeGreaterThanOrEqual(0)
  })

  it('borrar lo quita todo', async () => {
    ride(30, 15)
    await L.flush()
    await L.wipe()
    expect(await sessions()).toHaveLength(0)
    expect((await L.summary()).recording).toBe(false)
  })

  it('base64 se puede volver a leer igual', () => {
    const f = new Float32Array([1.5, -2.25, NaN, 3e5, 0.1])
    const back = new Float32Array(Uint8Array.from(Buffer.from(toBase64(f), 'base64')).buffer)
    expect([...back].map(String)).toEqual([...f].map(String))
    const big = new Float64Array(30000).map((_, i) => i * 0.5)
    const back2 = new Float64Array(Uint8Array.from(Buffer.from(toBase64(big), 'base64')).buffer)
    expect(back2[29999]).toBe(29999 * 0.5)
  })
})
