// Genera public/demo/telemetria-demo.json: una salida inventada por carreteras reales de Oleiros
// (A Coruña), con una pasada a fondo al empezar, para enseñar /blackbox sin datos de verdad.
// Uso: node scripts/demo-telemetry.mjs  (pide el trazado a OSRM, una vez)
import { writeFileSync } from 'node:fs'
import { synthRide, exportJson } from '../src/blackbox/synth.js'

const WAYPOINTS = [[-8.3404, 43.3505], [-8.333, 43.3797], [-8.2875, 43.3936]]
const url = `https://router.project-osrm.org/route/v1/driving/${WAYPOINTS.map((p) => p.join(',')).join(';')}?overview=full&geometries=geojson`
const res = await fetch(url, { headers: { 'User-Agent': 'streetchaos-demo' } })
const route = (await res.json()).routes[0]
const path = route.geometry.coordinates.map(([lon, lat]) => [lat, lon])
// Dos salidas por la misma ruta, en días distintos y a otro ritmo, para poder comparar y cronometrar tramos
const rides = [
  synthRide({ path, seed: 11, start: Date.UTC(2026, 10, 9, 9, 30), vRoad: 25, aLat: 0.7 }),
  synthRide({ path, seed: 12, start: Date.UTC(2026, 10, 2, 17, 10), vRoad: 23, aLat: 0.6, tilt: 20 }),
]
const out = new URL('../public/demo/telemetria-demo.json', import.meta.url)
writeFileSync(out, exportJson(rides))
for (const r of rides) console.log(`${r.meta.id}: ${(route.distance / 1000).toFixed(1)} km, ${Math.round(r.truth.tEnd)} s, ${r.meta.rows.imu} muestras IMU`)
console.log('→', out.pathname)
