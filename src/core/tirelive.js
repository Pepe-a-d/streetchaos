// Temperatura de los neumáticos en directo (solo si la activas en Garaje → Opciones avanzadas). Va paso a
// paso con lo que mide la app (10 veces por segundo), con el tiempo de internet al dar el contacto (o tu
// temperatura a mano) y recordando cómo quedaron al aparcar: si sales al rato, aún están templados.
import { settings, load, save, onSetting } from './store.js'
import { T } from './telemetry.js'
import { onIgnition } from './ignition.js'
import { onSessionEnd } from './logger.js'
import { createTireModel, modelConfig, tireSettings, roadTemp } from './tires.js'
import { weatherAt } from './weather.js'

export const tires = { snap: null, env: null, on: false }
let model = null
let env = { tAir: 15 }
let lastWeather = 0

const enabled = () => tireSettings(settings.tires).enabled

/** De qué temperatura parten: la del aire, o lo que quedaba de la última vez (se enfrían en ~15 min). */
function startState(tAir) {
  const saved = load('tireState', null)
  if (!saved?.state || !Number.isFinite(saved.at)) return tAir
  const mins = (Date.now() - saved.at) / 60000
  const f = Math.exp(-mins / 15)
  const s = JSON.parse(JSON.stringify(saved.state))
  for (const w of ['f', 'r']) for (const z of ['L', 'C', 'R', 'core']) s[w][z] = tAir + (s[w][z] - tAir) * (z === 'core' ? Math.exp(-mins / 25) : f)
  return s
}

async function refreshWeather(force = false) {
  const st = tireSettings(settings.tires)
  if (!st.weather) return (env = { tAir: Number(st.airManual) || 15 })
  if (!force && Date.now() - lastWeather < 20 * 60000) return env
  const f = T.fix
  if (!f || !navigator.onLine) return (env = { tAir: env.tAir ?? (Number(st.airManual) || 15) })
  lastWeather = Date.now()
  const w = await weatherAt(f.lat, f.lon, Date.now())
  if (w) env = { ...w, tRoad: roadTemp(w) }
  tires.env = env
  return env
}

function rebuild() {
  if (!enabled()) {
    model = null
    tires.on = false
    tires.snap = null
    return
  }
  model = createTireModel(modelConfig(settings.tires), startState(env.tAir ?? 15))
  tires.on = true
}

function keep() {
  if (model) save('tireState', { at: Date.now(), state: model.state })
}

export function initTires() {
  env = { tAir: Number(tireSettings(settings.tires).airManual) || 15 }
  rebuild()
  onSetting((key) => key === 'tires' && (keep(), rebuild()))
  onIgnition((on) => {
    if (on && enabled()) refreshWeather(true).then(() => (keep(), rebuild()))
    if (!on) keep()
  })
  onSessionEnd(() => keep())
  addEventListener('pagehide', keep)
  let last = performance.now()
  setInterval(() => {
    const now = performance.now()
    const dt = Math.min(1, (now - last) / 1000)
    last = now
    if (!model) return
    const moving = T.status === 'ok' && T.vOk !== false
    model.step(dt, { v: moving ? T.v : 0, gLong: T.gLong, gLat: T.gLat, lean: (T.lean * 180) / Math.PI }, env)
    tires.snap = model.state
    tires.env = env
    if (settings.ignition) refreshWeather()
  }, 100)
  setInterval(keep, 30000)
}
