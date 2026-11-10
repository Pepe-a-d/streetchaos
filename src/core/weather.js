// El tiempo que hacía (o hace) donde ibas: temperatura del aire, sol y lluvia, de Open-Meteo (gratis, sin
// clave). Se usa para la temperatura estimada de los neumáticos. Solo se manda la posición redondeada a
// unos 1 km y la fecha; nada más.
const r2 = (x) => Math.round(x * 100) / 100
const day = (ms) => new Date(ms).toISOString().slice(0, 10)

function pick(j, ms) {
  const h = j?.hourly
  if (!h?.time?.length) return null
  const t = new Date(ms)
  const at = t.getUTCHours() + t.getUTCMinutes() / 60
  const i = Math.min(h.time.length - 2, Math.max(0, Math.floor(at)))
  const f = Math.max(0, Math.min(1, at - i))
  const lerp = (a) => (Number.isFinite(a?.[i]) ? a[i] + ((a[i + 1] ?? a[i]) - a[i]) * f : NaN)
  const rain = Math.max(h.precipitation?.[i] ?? 0, h.precipitation?.[Math.max(0, i - 1)] ?? 0)
  const tAir = lerp(h.temperature_2m)
  if (!Number.isFinite(tAir)) return null
  return { tAir: Math.round(tAir * 10) / 10, sun: Math.round(lerp(h.shortwave_radiation) || 0), rain, wet: rain >= 0.2, src: 'open-meteo' }
}

/** El tiempo a esa hora (ms) en ese sitio; null si no se puede. */
export async function weatherAt(lat, lon, ms, fetcher = fetch) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(ms)) return null
  const old = Date.now() - ms > 80 * 864e5
  const base = old ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast'
  const url = `${base}?latitude=${r2(lat)}&longitude=${r2(lon)}&hourly=temperature_2m,shortwave_radiation,precipitation&timezone=GMT&start_date=${day(ms)}&end_date=${day(ms)}`
  try {
    const r = await fetcher(url)
    if (!r.ok) return null
    return pick(await r.json(), ms)
  } catch {
    return null
  }
}

export const __test = { pick, url: (lat, lon, ms) => `${r2(lat)},${r2(lon)},${day(ms)}` }
