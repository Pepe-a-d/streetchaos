// Tramos y vueltas en directo, en el móvil. Las líneas de salida y de meta son «puertas»: una raya de 40 m
// cruzada al rumbo del tramo, como las de un circuito. Al cruzar la de salida empieza el tiempo; mientras
// vas, la diferencia con tu mejor pasada a la misma distancia (delta predictivo); al cruzar la de meta,
// el tiempo final y si es récord.
// - Tramos: los que guardas en el Blackbox llegan solos al móvil (nube, `kv` 'segments'): trazado y el
//   tiempo de tu mejor pasada en cada 1 % del recorrido.
// - Circuito (CRONO → VUELTAS): la meta la marcas tú al pasar por ella (o un circuito del Blackbox);
//   cada vuelta empieza donde acaba la otra y la referencia es tu mejor vuelta.
// Los tiempos son los del GPS ya corregidos (su retraso descontado) e interpolados al cruzar la raya.

const RAD = Math.PI / 180
const R = 6371008.8
const HALF = 20 // m a cada lado de la raya

/** Puerta: { lat, lon, hdg } (rumbo con el que se cruza). */
export function gateFrom(lat, lon, hdg) {
  return { lat, lon, hdg: ((hdg % 360) + 360) % 360 }
}
const local = (g, p) => [(p.lon - g.lon) * RAD * R * Math.cos(g.lat * RAD), (p.lat - g.lat) * RAD * R]

/**
 * Si el trozo a → b (posiciones {lat, lon}) cruza la puerta en el sentido bueno, la fracción del trozo
 * donde la cruza (0-1); si no, null.
 */
export function crossing(a, b, gate, half = HALF) {
  const n = [Math.sin(gate.hdg * RAD), Math.cos(gate.hdg * RAD)] // hacia donde se cruza
  const tdir = [n[1], -n[0]] // a lo largo de la raya
  const pa = local(gate, a)
  const pb = local(gate, b)
  const da = pa[0] * n[0] + pa[1] * n[1]
  const db = pb[0] * n[0] + pb[1] * n[1]
  if (!(da < 0 && db >= 0)) return null
  const f = da / (da - db)
  const x = pa[0] + (pb[0] - pa[0]) * f
  const y = pa[1] + (pb[1] - pa[1]) * f
  if (Math.abs(x * tdir[0] + y * tdir[1]) > half) return null
  return f
}

/** Rumbo de p0 a p1 ([lat, lon]). */
export function bearingOf(p0, p1) {
  const y = Math.sin((p1[1] - p0[1]) * RAD) * Math.cos(p1[0] * RAD)
  const x = Math.cos(p0[0] * RAD) * Math.sin(p1[0] * RAD) - Math.sin(p0[0] * RAD) * Math.cos(p1[0] * RAD) * Math.cos((p1[1] - p0[1]) * RAD)
  return (Math.atan2(y, x) / RAD + 360) % 360
}
const dist = (a, b) => Math.hypot((b[0] - a[0]) * RAD * R, (b[1] - a[1]) * RAD * R * Math.cos(a[0] * RAD))

/** Puertas de salida y meta de un trazado: la salida con el rumbo de sus primeros ~20 m, la meta con el de los últimos. */
export function gatesOf(points, closed = false) {
  const n = points.length
  let a = 1
  while (a < n - 1 && dist(points[0], points[a]) < 20) a++
  let b = n - 2
  while (b > 0 && dist(points[b], points[n - 1]) < 20) b--
  const start = gateFrom(points[0][0], points[0][1], bearingOf(points[0], points[a]))
  return { start, end: closed ? start : gateFrom(points[n - 1][0], points[n - 1][1], bearingOf(points[b], points[n - 1])) }
}

/** Tiempo de referencia a una distancia: de un perfil de 101 tiempos (cada 1 % de L) o de pares [d, t]. */
export function refAt(ref, d) {
  if (!ref) return NaN
  if (ref.prof) {
    const L = ref.length
    const q = Math.max(0, Math.min(100, (d / L) * 100))
    const i = Math.min(99, Math.floor(q))
    return ref.prof[i] + (ref.prof[i + 1] - ref.prof[i]) * (q - i)
  }
  const pts = ref.pts
  if (!pts?.length) return NaN
  if (d <= pts[0][0]) return pts[0][1]
  let lo = 0
  let hi = pts.length - 1
  if (d >= pts[hi][0]) return pts[hi][1]
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (pts[m][0] <= d) lo = m
    else hi = m
  }
  const f = (d - pts[lo][0]) / (pts[hi][0] - pts[lo][0] || 1)
  return pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f
}

/** Perfil de 101 tiempos (cada 1 % de la distancia) a partir de pares [d, t] de una pasada. */
export function profileFrom(pts, length) {
  const out = []
  for (let k = 0; k <= 100; k++) out.push(Math.round(refAt({ pts }, (length * k) / 100) * 1000) / 1000)
  return out
}

/**
 * Cronometrador de un tramo (abierto) o de un circuito (vueltas seguidas).
 * @param {{ id, name, start, end, length?, closed, ref?, best? }} def  puertas y referencia
 * @param {(e: object) => void} on  'start' | 'tick' | 'finish' | 'abort'
 */
export function createTimer(def, on) {
  let prev = null // última posición { t, lat, lon, v }
  let run = null // { t0, d, pts: [[d, t]] }
  let lap = 0
  const maxD = () => (def.length ? def.length * 1.5 + 200 : Infinity)

  function feed(s) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon) || !Number.isFinite(s.t)) return
    const p = prev
    prev = s
    if (!p || s.t - p.t > 5) {
      if (run && p && s.t - p.t > 5) abort('sin GPS')
      return
    }
    const dt = s.t - p.t
    // ¿Cruza la meta (o, en un circuito, la línea de salida y meta)?
    if (run) {
      const f = crossing(p, s, def.end)
      if (f != null && run.d > Math.min(60, (def.length || 300) * 0.3)) {
        const tx = p.t + f * dt
        const d = run.d + ((p.v + s.v) / 2) * dt * f
        run.pts.push([d, tx - run.t0])
        const time = tx - run.t0
        const best = def.best
        const record = !Number.isFinite(best) || time < best - 0.005
        const res = { id: def.id, name: def.name, kind: def.closed ? 'lap' : 'seg', n: lap, t: tx, time, best, record, length: d, pts: run.pts }
        if (record) {
          def.best = time
          def.ref = { pts: run.pts.slice(), length: d }
        }
        run = null
        on({ type: 'finish', ...res })
        if (def.closed) begin(tx, s, p, f)
        return
      }
      run.d += ((p.v + s.v) / 2) * dt
      const elapsed = s.t - run.t0
      run.pts.push([run.d, elapsed])
      if (run.d > maxD() || (Number.isFinite(def.best) && elapsed > def.best * 2.5 + 60)) return abort('se salió')
      const ref = refAt(def.ref, run.d)
      on({ type: 'tick', id: def.id, name: def.name, kind: def.closed ? 'lap' : 'seg', n: lap, t0: run.t0, elapsed, d: run.d, delta: Number.isFinite(ref) ? elapsed - ref : NaN })
      return
    }
    const f = crossing(p, s, def.start)
    if (f != null && s.v > 2) begin(p.t + f * dt, s, p, f)
  }

  function begin(t0, s, p, f) {
    lap++
    const d0 = ((p.v + s.v) / 2) * (s.t - p.t) * (1 - f)
    run = { t0, d: d0, pts: [[0, 0], [d0, s.t - t0]] }
    on({ type: 'start', id: def.id, name: def.name, kind: def.closed ? 'lap' : 'seg', n: lap, t0 })
  }

  function abort(why) {
    if (!run) return
    run = null
    on({ type: 'abort', id: def.id, name: def.name, kind: def.closed ? 'lap' : 'seg', why })
  }

  return {
    feed,
    abort,
    get running() {
      return !!run
    },
    get lap() {
      return lap
    },
    def,
  }
}
