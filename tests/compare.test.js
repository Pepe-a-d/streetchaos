// Comparar recorridos, cronometrar tramos y vueltas, banco de potencia y el archivo de la nube.
import { describe, it, expect } from 'vitest'
import { synthRide } from '../src/blackbox/synth.js'
import { analyze, DT } from '../src/blackbox/process.js'
import { makePath, findPasses, compare, pathPoints, runPass, closeLoop, cutAt } from '../src/blackbox/align.js'
import { findPulls, pullCurve, DYNO } from '../src/blackbox/dyno.js'
import { packSession, unpackSession } from '../src/core/blackbox.js'

const RAD = Math.PI / 180
const O = [43.37, -8.4]
const kx = Math.cos(O[0] * RAD) * 6371008.8 * RAD
const ky = 6371008.8 * RAD
const toLL = (pts) => pts.map(([x, y]) => [O[0] + y / ky, O[1] + x / kx])

/** Recorrido de prueba en metros: recta, curvas y recta. */
function road() {
  const pts = [[0, 0]]
  let x = 0
  let y = 0
  let h = 0
  const go = (len) => {
    for (let s = 0; s < len; s += 4) pts.push([(x += 4 * Math.sin(h)), (y += 4 * Math.cos(h))])
  }
  const turn = (r, deg) => {
    const n = Math.ceil((Math.abs(deg) * RAD * r) / 4)
    for (let k = 0; k < n; k++) {
      h += (deg * RAD) / n
      pts.push([(x += ((Math.abs(deg) * RAD * r) / n) * Math.sin(h)), (y += ((Math.abs(deg) * RAD * r) / n) * Math.cos(h))])
    }
  }
  go(300)
  turn(60, 90)
  go(200)
  turn(40, -120)
  go(300)
  return toLL(pts)
}

/** Óvalo cerrado de unos 900 m, recorrido `laps` veces. */
function oval(laps) {
  const one = []
  for (let k = 0; k < 220; k++) {
    const a = (k / 220) * 2 * Math.PI
    one.push([Math.sin(a) * 220, (1 - Math.cos(a)) * 90])
  }
  const all = []
  for (let l = 0; l < laps; l++) all.push(...one)
  all.push(one[0])
  return { loop: toLL([...one, one[0]]), all: toLL(all) }
}

describe('comparar y cronometrar', () => {
  it('dos salidas por la misma carretera: la más rápida gana tiempo donde corresponde', () => {
    const path = road()
    const slow = analyze(synthRide({ path, drag: false, vRoad: 18, seed: 3 }))
    const fast = analyze(synthRide({ path, drag: false, vRoad: 24, seed: 5, start: Date.UTC(2026, 10, 10, 10) }))
    // Referencia: la lenta entera
    const first = slow.valid.indexOf(1)
    const last = slow.valid.lastIndexOf(1)
    const P = makePath(pathPoints(slow, first, last))
    const [ra] = findPasses(P, slow)
    const [rb] = findPasses(P, fast)
    expect(ra).toBeTruthy()
    expect(rb).toBeTruthy()
    expect(rb.time).toBeLessThan(ra.time)
    const C = compare(ra, slow, rb, fast, P.length)
    expect(C.delta[0]).toBeCloseTo(0, 5)
    expect(C.delta[C.n - 1]).toBeCloseTo(rb.time - ra.time, 1)
    // Gana sobre todo en las rectas (en las curvas los dos van al límite de agarre)
    expect(C.delta[Math.floor(C.n * 0.2)]).toBeLessThan(0)
    // Los índices apuntan a muestras de cada salida en el mismo sitio
    const k = Math.floor(C.n / 2)
    const dLat = (slow.lat[C.iA[k]] - fast.lat[C.iB[k]]) * ky
    const dLon = (slow.lon[C.iA[k]] - fast.lon[C.iB[k]]) * kx
    expect(Math.hypot(dLat, dLon)).toBeLessThan(15)
  })

  it('un tramo de la salida se encuentra en otra y en sentido contrario no', () => {
    const path = road()
    const A = analyze(synthRide({ path, drag: false, seed: 3 }))
    // Tramo: la curva a derecha y un poco de recta
    const i0 = A.corners[0].i0 - 30
    const i1 = A.corners[0].i1 + 30
    const P = makePath(pathPoints(A, i0, i1))
    const B = analyze(synthRide({ path, drag: false, seed: 9, vRoad: 20 }))
    expect(findPasses(P, B)).toHaveLength(1)
    const back = analyze(synthRide({ path: [...path].reverse(), drag: false, seed: 4 }))
    expect(findPasses(P, back)).toHaveLength(0)
  })

  it('vueltas a un circuito: cuenta todas y las lanzadas salen iguales', () => {
    const { loop, all } = oval(4)
    const A = analyze(synthRide({ path: all, drag: false, vRoad: 30, aLat: 0.8, seed: 2 }))
    const P = makePath(loop)
    expect(P.closed).toBe(true)
    const laps = findPasses(P, A)
    // La primera sale desde parado y la última acaba frenando: las del medio, lanzadas
    expect(laps.length).toBeGreaterThanOrEqual(3)
    const flying = laps.slice(1, -1).map((l) => l.time)
    expect(Math.max(...flying) - Math.min(...flying)).toBeLessThan(0.4)
    expect(laps[0].time).toBeGreaterThan(flying[0])
    // Vueltas seguidas: una empieza donde acaba la anterior
    expect(Math.abs(laps[1].t0 - laps[0].t1)).toBeLessThan(0.3)
  })

  it('pasadas del crono: comparadas por distancia desde la salida', () => {
    const path = road()
    const A = analyze(synthRide({ path, seed: 3 }))
    const r = runPass(A, A.runs[0])
    // Hasta que empieza a frenar (la recta de la pasada acaba en 300 m)
    expect(r.length).toBeGreaterThan(150)
    const C = compare(r, A, r, A, r.length, 1)
    expect(Math.abs(C.delta[C.n - 1])).toBeLessThan(1e-9)
    // 330 pies (100,6 m): el tiempo cuadra con la marca del crono
    expect(Math.abs(C.tA[101] - A.runs[0].marks['330ft'])).toBeLessThan(0.15)
  })
})

describe('banco de potencia', () => {
  it('saca la potencia del tirón de la pasada', () => {
    const A = analyze(synthRide({ path: road(), seed: 3 }))
    const pulls = findPulls(A)
    expect(pulls.length).toBeGreaterThanOrEqual(1)
    const p = pulls.reduce((a, b) => (b.v1 - b.v0 > a.v1 - a.v0 ? b : a))
    // Sin aire ni rodadura, la potencia es m·a·v, y la moto inventada acelera 9,5·(1 − v/70) m/s²
    const o = { ...DYNO, cda: 0, crr: 0, bike: 190, rider: 80 }
    const c = pullCurve(A, p, o)
    const m = 270
    let best = 0
    for (let j = 0; j < c.kmh.length; j++) {
      const v = c.kmh[j] / 3.6
      best = Math.max(best, (m * 9.5 * (1 - v / 70) * v * 1.04) / 735.5)
    }
    expect(Math.abs(c.peak.cv - best) / best).toBeLessThan(0.12)
  })
})

describe('archivo de la nube', () => {
  it('empaqueta y desempaqueta una sesión igual', () => {
    const ride = synthRide({ path: road(), seed: 1 })
    const back = unpackSession(packSession(ride, { rider: 'PEPE' }))
    expect(back.meta.id).toBe(ride.meta.id)
    expect(back.head.rider).toBe('PEPE')
    expect(Array.from(back.gps)).toEqual(Array.from(ride.gps))
    expect(back.imu.length).toBe(ride.imu.length)
    expect(back.imu[12345]).toBe(ride.imu[12345])
    expect(back.ev).toEqual(ride.ev)
  })
})

describe('arreglos de la revisión del Blackbox', () => {
  it('comparar una pasada del crono con la misma más corta: diferencia 0 (antes −0,90 s)', () => {
    const path = road()
    const A = analyze(synthRide({ path, seed: 3 }))
    const r = runPass(A, A.runs[0])
    const short = cutAt(r, r.length * 0.8)
    const L = Math.min(r.length, short.length)
    const C = compare(r, A, short, A, L, 1, { own: true })
    expect(Math.abs(C.delta[C.n - 1])).toBeLessThan(0.01)
    expect(Math.abs(C.delta[Math.floor(C.n / 2)])).toBeLessThan(0.01)
    expect(Math.abs(C.timeA - C.timeB)).toBeLessThan(0.01)
  })

  it('un tramo que empieza donde arranca la pasada desde parado no inventa segundos', () => {
    const path = road()
    const A = analyze(synthRide({ path, seed: 3 }))
    const run = A.runs[0]
    // Tramo que empieza 20 m antes de donde la moto sale parada: no cuenta como pasada entera
    const k0 = Math.max(0, run.i - 40)
    const P = makePath(pathPoints(A, k0, Math.min(A.n - 1, run.i + 200)))
    for (const p of findPasses(P, A)) expect(p.t0).toBeGreaterThanOrEqual(A.t[k0] - 2)
  })

  it('cierra el lazo de un circuito dibujado a mano', () => {
    const pts = oval(1).loop.slice(0, -1) // la vuelta sin repetir el punto de inicio
    const n = pts.length
    // Acaba ~30 m antes del inicio (falta un trozo) y con solape: los dos quedan cerrados en el inicio
    const under = closeLoop(pts.slice(0, n - 6))
    expect(under.at(-1)).toEqual(pts[0])
    const over = closeLoop([...pts, ...pts.slice(1, 7)])
    expect(over.at(-1)).toEqual(pts[0])
    expect(makePath(over).closed).toBe(true)
    // Un tramo abierto no se toca
    const open = road()
    expect(closeLoop(open)).toBe(open)
  })

  it('una salida con el GPS cada más de 5 s se marca vacía (antes salía con NaN)', () => {
    const ride = synthRide({ path: road(), seed: 4, imu: false })
    const g = ride.gps
    // Deja solo una muestra de cada 8 (GPS cada 8 s)
    const W = 11
    const out = []
    for (let k = 0; k < g.length / W; k += 8) out.push(...g.slice(k * W, k * W + W))
    const A = analyze({ ...ride, gps: Float64Array.from(out), meta: { ...ride.meta, rows: { ...ride.meta.rows, gps: out.length / W } } })
    expect(A.empty).toBe(true)
  })
})

