// Utilidades geográficas: distancias, rumbos y geohash (para buscar rivales cercanos)

const R = 6371008.8
const rad = (d) => (d * Math.PI) / 180

export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function bearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2))
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Desplaza un punto `dist` metros con rumbo `brg` (grados). */
export function destination(lat, lon, brg, dist) {
  const d = dist / R
  const b = rad(brg)
  const la1 = rad(lat)
  const lo1 = rad(lon)
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b))
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2))
  return [(la2 * 180) / Math.PI, (((lo2 * 180) / Math.PI + 540) % 360) - 180]
}

/** Diferencia de rumbo con signo en (-180, 180]: positivo = giro a la derecha. */
export function headingDelta(from, to) {
  let d = (to - from) % 360
  if (d > 180) d -= 360
  if (d <= -180) d += 360
  return d
}

const B32 = '0123456789bcdefghjkmnpqrstuvwxyz'

export function geohash(lat, lon, precision = 6) {
  let latR = [-90, 90]
  let lonR = [-180, 180]
  let hash = ''
  let bit = 0
  let ch = 0
  let even = true
  while (hash.length < precision) {
    const r = even ? lonR : latR
    const v = even ? lon : lat
    const mid = (r[0] + r[1]) / 2
    if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid } else { ch <<= 1; r[1] = mid }
    even = !even
    if (++bit === 5) { hash += B32[ch]; bit = 0; ch = 0 }
  }
  return hash
}

function decodeBox(hash) {
  const latR = [-90, 90]
  const lonR = [-180, 180]
  let even = true
  for (const c of hash) {
    const v = B32.indexOf(c)
    for (let i = 4; i >= 0; i--) {
      const r = even ? lonR : latR
      const mid = (r[0] + r[1]) / 2
      if ((v >> i) & 1) r[0] = mid
      else r[1] = mid
      even = !even
    }
  }
  return { latR, lonR }
}

/** La celda y sus 8 vecinas (sin repetir). */
export function geohashNeighborhood(hash) {
  const { latR, lonR } = decodeBox(hash)
  const dLat = latR[1] - latR[0]
  const dLon = lonR[1] - lonR[0]
  const cLat = (latR[0] + latR[1]) / 2
  const cLon = (lonR[0] + lonR[1]) / 2
  const out = new Set()
  for (const i of [-1, 0, 1]) {
    for (const j of [-1, 0, 1]) {
      const la = Math.max(-89.999, Math.min(89.999, cLat + i * dLat))
      const lo = ((cLon + j * dLon + 540) % 360) - 180
      out.add(geohash(la, lo, hash.length))
    }
  }
  return [...out]
}

export const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']
export const compassPoint = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
