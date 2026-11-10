// Tus trayectos: las salidas que empiezan y acaban en los mismos sitios (casa → trabajo, trabajo → casa)
// se agrupan solas y se ve cómo evolucionan: el tiempo de puerta a puerta (desde que arrancas hasta que
// llegas, con las paradas), cuántas veces paras y cuánto rato, y a qué hora te conviene salir.
// Lo usan la app (Garaje → Trayectos y el resumen al terminar) y el Blackbox.

const NEAR = 300 // m: mismo sitio
const MIN_DIST = 400 // m: más corto no es un trayecto

const RAD = Math.PI / 180
export const meters = (a, b) => Math.hypot((b[0] - a[0]) * RAD, (b[1] - a[1]) * RAD * Math.cos(((a[0] + b[0]) / 2) * RAD)) * 6371008.8

/** El sitio con nombre que hay en ese punto (a menos de 300 m), o null. */
export function placeAt(ll, places = []) {
  let best = null
  for (const p of places) {
    const d = meters(ll, [p.lat, p.lon])
    if (d < NEAR && (!best || d < best.d)) best = { ...p, d }
  }
  return best
}

/**
 * @param {{id, start, from: number[], to: number[], dist, dur, stops?, stopped?}[]} rides  salidas (start en ms)
 * @param {{lat, lon, name}[]} places  sitios con nombre
 * @returns {{id, from, to, name, rides, n, avg, best, last, stops, stopped, byHour}[]}  los que se repiten (2 o más), el más habitual primero
 */
export function groupRoutes(rides, places = []) {
  const groups = []
  const ok = rides.filter((r) => Array.isArray(r.from) && Array.isArray(r.to) && r.dist >= MIN_DIST && r.dur > 30).sort((a, b) => a.start - b.start)
  for (const r of ok) {
    // El mismo origen y el mismo destino; la distancia, parecida (otra carretera entre los mismos sitios cuenta igual)
    const g = groups.find((x) => meters(r.from, x.from) < NEAR && meters(r.to, x.to) < NEAR && r.dist > x.dist * 0.6 && r.dist < x.dist * 1.6)
    if (g) g.rides.push(r)
    else groups.push({ from: r.from, to: r.to, dist: r.dist, rides: [r] })
  }
  return groups
    .filter((g) => g.rides.length >= 2)
    .map((g, k) => stats(g, k, places))
    .sort((a, b) => b.n - a.n || b.last.start - a.last.start)
}

function stats(g, k, places) {
  const rides = g.rides
  const durs = rides.map((r) => r.dur)
  const avg = durs.reduce((a, b) => a + b, 0) / durs.length
  const a = placeAt(g.from, places)
  const b = placeAt(g.to, places)
  // Media por hora de salida (para saber cuándo te conviene salir)
  const hours = new Map()
  for (const r of rides) {
    const h = new Date(r.start).getHours()
    const x = hours.get(h) || { h, n: 0, sum: 0 }
    x.n++
    x.sum += r.dur
    hours.set(h, x)
  }
  const byHour = [...hours.values()].map((x) => ({ h: x.h, n: x.n, avg: x.sum / x.n })).sort((p, q) => p.h - q.h)
  const typical = new Date(rides.at(-1).start)
  return {
    id: `${g.from.join(',')}>${g.to.join(',')}`,
    from: g.from,
    to: g.to,
    fromName: a?.name || null,
    toName: b?.name || null,
    name: a || b ? `${a?.name || 'Salida'} → ${b?.name || 'Llegada'}` : `Trayecto de las ${String(typical.getHours()).padStart(2, '0')}:${String(typical.getMinutes()).padStart(2, '0')}`,
    rides,
    n: rides.length,
    avg,
    best: Math.min(...durs),
    last: rides.at(-1),
    stops: rides.reduce((s, r) => s + (r.stops || 0), 0) / rides.length,
    stopped: rides.reduce((s, r) => s + (r.stopped || 0), 0) / rides.length,
    byHour,
    k,
  }
}

/**
 * El trayecto de una salida comparado con las demás veces (sin contarla a ella): { name, n, avg, best } o null.
 */
export function routeOf(ride, rides, places = []) {
  if (!Array.isArray(ride?.from) || !Array.isArray(ride?.to)) return null
  const others = rides.filter((r) => r.id !== ride.id)
  const routes = groupRoutes([...others, ride], places)
  const r = routes.find((x) => x.rides.some((y) => y.id === ride.id))
  if (!r) return null
  const prev = r.rides.filter((y) => y.id !== ride.id)
  if (!prev.length) return null
  const avg = prev.reduce((s, y) => s + y.dur, 0) / prev.length
  return { name: r.name, n: prev.length, avg, best: Math.min(...prev.map((y) => y.dur)) }
}

/** De la ficha de la caja negra a una salida para agrupar. */
export function rideOf(meta) {
  if (!meta?.from || !meta?.to) return null
  const dur = Number.isFinite(meta.lastMove) && Number.isFinite(meta.firstMove) ? meta.lastMove - meta.firstMove : (meta.end - meta.start) / 1000
  return { id: meta.id, start: meta.start + (meta.firstMove || 0) * 1000, from: meta.from, to: meta.to, dist: meta.dist || 0, dur, stops: meta.stops || 0, stopped: meta.stopped || 0 }
}

/**
 * Para las salidas de antes de que la caja negra apuntara de dónde a dónde: lo saca de sus posiciones.
 * gps: el flujo plano (t, ts, lat, lon, acc, alt, altAcc, speed, heading, v, hdg). Devuelve lo que hay que
 * añadir a la ficha.
 */
export function endpointsFromGps(gps, width = 11) {
  let from = null
  let to = null
  let first = NaN
  let lastT = NaN
  let still = null
  let stops = 0
  let stopped = 0
  for (let i = 0; i + width <= gps.length; i += width) {
    const t = gps[i]
    const lat = gps[i + 2]
    const lon = gps[i + 3]
    const v = gps[i + 9]
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    if (v > 1) {
      const here = [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]
      if (!from) (from = here), (first = t)
      to = here
      lastT = t
      if (still != null && t - still >= 5) (stops++, (stopped += t - still))
      still = null
    } else if (from && still == null) still = t
  }
  return from ? { from, to, firstMove: first, lastMove: lastT, stops, stopped: Math.round(stopped * 1000) / 1000 } : null
}
