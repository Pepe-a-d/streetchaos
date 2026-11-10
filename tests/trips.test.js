// Trayectos de cada día y resumen al terminar una salida.
import { describe, it, expect } from 'vitest'
import { groupRoutes, routeOf, endpointsFromGps, placeAt } from '../src/core/routes.js'
import { summarize, durWords, gapWords, lapWords } from '../src/core/tripsum.js'

describe('Tus trayectos', () => {
  const casa = [43.37, -8.4]
  const curro = [43.36, -8.42]
  const otro = [43.4, -8.3]
  const day = (d, h, m) => Date.UTC(2026, 10, d, h - 1, m)
  const ride = (id, start, from, to, dur, extra = {}) => ({ id, start, from, to, dist: 4800, dur, stops: 10, stopped: 300, ...extra })
  const rides = [
    ride('a', day(3, 8, 10), casa, curro, 1200),
    ride('b', day(4, 8, 12), [43.3702, -8.4003], [43.3601, -8.4198], 1300),
    ride('c', day(5, 8, 40), casa, curro, 1500),
    ride('v1', day(5, 18, 0), curro, casa, 1100),
    ride('v2', day(6, 18, 5), curro, casa, 1050),
    ride('x', day(6, 11, 0), casa, otro, 900, { dist: 9000 }),
    ride('corto', day(6, 12, 0), casa, casa, 60, { dist: 150 }),
  ]

  it('agrupa las salidas con el mismo origen y destino, cada sentido por su lado', () => {
    const r = groupRoutes(rides, [{ lat: casa[0], lon: casa[1], name: 'Casa' }, { lat: curro[0], lon: curro[1], name: 'Trabajo' }])
    expect(r).toHaveLength(2)
    expect(r[0].name).toBe('Casa → Trabajo')
    expect(r[0].n).toBe(3)
    expect(r[0].best).toBe(1200)
    expect(r[0].avg).toBeCloseTo(1333.3, 0)
    expect(r[1].name).toBe('Trabajo → Casa')
    // A qué hora conviene salir
    // (en la hora local de quien lo ejecute: los servidores de GitHub van en UTC)
    expect(r[0].byHour.map((x) => x.h)).toEqual([...new Set([day(3, 8, 10), day(4, 8, 12), day(5, 8, 40)].map((t) => new Date(t).getHours()))])
    expect(placeAt([43.3702, -8.4003], [{ lat: casa[0], lon: casa[1], name: 'Casa' }]).name).toBe('Casa')
  })

  it('compara la salida de hoy con las demás veces de su trayecto', () => {
    const hoy = ride('hoy', day(10, 8, 12), casa, curro, 1264)
    const r = routeOf(hoy, [...rides, hoy])
    expect(r.n).toBe(3)
    expect(r.avg).toBeCloseTo(1333.3, 0)
    expect(routeOf(ride('nuevo', day(10, 9, 0), otro, curro, 900), rides)).toBe(null)
  })

  it('saca de dónde a dónde y las paradas de las posiciones de una salida vieja', () => {
    const W = 11
    const rows = []
    const push = (t, lat, v) => rows.push(t, 0, lat, -8.4, 5, 0, 0, v, 0, v, 0)
    push(0, 43.37, 0)
    push(1, 43.3701, 5)
    push(2, 43.3702, 5)
    for (let t = 3; t < 15; t++) push(t, 43.3702, 0) // semáforo de 12 s
    push(15, 43.3705, 6)
    push(16, 43.371, 6)
    const e = endpointsFromGps(Float64Array.from(rows), W)
    expect(e.from).toEqual([43.3701, -8.4])
    expect(e.to).toEqual([43.371, -8.4])
    expect(e.stops).toBe(1)
    expect(e.stopped).toBe(12)
  })
})

describe('Resumen al terminar', () => {
  it('cuenta lo importante de hoy en tres frases y lo dice con palabras grabadas', () => {
    const meta = { id: 's', start: 0, end: 1300000, dist: 4833, moving: 727, vmax: 21.2, firstMove: 1, lastMove: 1265, stops: 23, stopped: 474 }
    const s = summarize(meta, {
      trip: { maxV: 21.2, leanL: 32.3, leanR: 28.3, gMax: 0.66, brakeMax: 0.62 },
      before: { maxV: 25.2, maxLeanL: 35.7, maxLeanR: 31.8, maxG: 0.73 },
      after: { maxV: 25.2, maxLeanL: 35.7, maxLeanR: 31.8, maxG: 0.73 },
      route: { name: 'Casa → Trabajo', n: 5, avg: 1340, best: 1180 },
    })
    expect(s.highlights).toHaveLength(3)
    expect(s.highlights[0]).toMatch(/Casa → Trabajo: 21 min, 1 minuto 16 segundos menos que tu media/)
    expect(s.highlights[1]).toMatch(/32° a la izquierda/)
    expect(s.speech).toMatch(/^Salida guardada\. 4,8 kilómetros en 21 minutos\. Tu trayecto: 1 minuto 16 segundos más rápido que tu media\./)
    // Con un récord, va primero
    const r = summarize(meta, { trip: { maxV: 26 }, before: { maxV: 25.2 }, after: { maxV: 26 } })
    expect(r.highlights[0]).toBe('Récord de punta: 94 km/h')
    expect(r.speech).toMatch(/Récord de punta: 94 kilómetros por hora\./)
  })
  it('duraciones dichas', () => {
    expect(durWords(1264)).toBe('21 minutos')
    expect(durWords(3900)).toBe('1 hora 5 minutos')
    expect(gapWords(76)).toBe('1 minuto 16 segundos')
    expect(lapWords(92.4)).toBe('1 minuto 32,4 segundos')
    expect(lapWords(47)).toBe('47 segundos')
  })
})
