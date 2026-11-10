// Persistencia en localStorage (prefijo sc- porque el dominio de GitHub Pages se comparte con otras apps)

const P = 'sc-'

export function load(key, def) {
  try {
    const raw = localStorage.getItem(P + key)
    return raw == null ? def : JSON.parse(raw)
  } catch {
    return def
  }
}

export function save(key, val) {
  try {
    localStorage.setItem(P + key, JSON.stringify(val))
  } catch {
    /* sin almacenamiento: la app sigue funcionando en memoria */
  }
}

const DEFAULTS = {
  name: '',
  bike: '',
  color: '#ff2e88',
  units: 'kmh',
  sound: true,
  crt: true,
  rollout: false,
  source: 'real',
  simHz: 1,
  simBike: 'sport',
  radius: 1500,
  visible: true,
  timerMode: 'k0-100',
  raceMode: '1/4',
  // Calibración del inclinómetro (core/telemetry.js). leanZero y gyroSign son de antes y ya no se usan.
  leanZero: null,
  gyroSign: null,
  mount: null, // postura del móvil en el soporte: { up, right, angle, fwd, S, W, N }
  leanSign: null,
  gyroAxes: null, // 'w3c' | 'xyz'
  yawSign: null,
  gravConv: null,
  gpsLag: null, // s; si no, 1 en iPhone y 0 en el resto
  onboarded: false,
  logTelemetry: true,
  cloudSync: true,
  syncKey: null,
  theme: 'synth',
  digits: 'lcd',
  accentBike: false,
  dashPages: null,
  dashPage: 0,
  voice: true,
  voiceName: null,
  voiceRate: 1.05,
  voiceEvents: {},
  speedAlerts: [],
  voiceMusic: 'duck', // cómo convive con la música: duck | pause | mix (core/voice.js)
  voiceEngine: 'app', // app: audios propios (no paran la música) | system: la voz del móvil
  ignition: false, // contacto dado (core/ignition.js)
  ignitionAuto: true, // darlo solo si vas en moto con él quitado
  places: [], // sitios con nombre para tus trayectos: [{ lat, lon, name }]
  lapMode: false, // CRONO → VUELTAS: cronometrar vueltas al circuito marcado
  tires: null, // temperatura estimada de los neumáticos (core/tires.js): apagada hasta que la actives
}

export const settings = { ...DEFAULTS, ...load('settings', {}) }
const subs = new Set()

export function setSetting(key, val) {
  settings[key] = val
  save('settings', settings)
  for (const fn of subs) fn(key, val)
}
export const onSetting = (fn) => (subs.add(fn), () => subs.delete(fn))

// ---- Historial de pasadas ----
const MAX_RUNS = 120
export const runs = load('runs', [])

export function addRun(result) {
  const run = { ...result, id: Math.random().toString(36).slice(2, 10) }
  runs.unshift(run)
  if (runs.length > MAX_RUNS) runs.length = MAX_RUNS
  save('runs', runs)
  return run
}
export function deleteRun(id) {
  const i = runs.findIndex((r) => r.id === id)
  if (i >= 0) runs.splice(i, 1)
  save('runs', runs)
}

/** Mejor marca de cada parcial (tiempo mínimo) a partir del historial. */
export function bests() {
  const out = {}
  for (const r of runs) {
    if (!r.valid) continue
    for (const [id, m] of Object.entries(r.marks)) {
      if (!out[id] || m.t < out[id].t) out[id] = { ...m, date: r.date, runId: r.id }
    }
  }
  return out
}

export function bestRunFor(markId) {
  let best = null
  for (const r of runs) {
    const m = r.valid && r.marks[markId]
    if (m && (!best || m.t < best.marks[markId].t)) best = r
  }
  return best
}

// ---- Duelos ----
export const races = load('races', [])
export function addRace(race) {
  races.unshift({ ...race, date: Date.now() })
  if (races.length > 100) races.length = 100
  save('races', races)
}

// ---- Totales (cuentakilómetros y máximos de siempre) ----
export const totals = { odo: 0, maxV: 0, maxLeanL: 0, maxLeanR: 0, maxG: 0, ...load('totals', {}) }
let saveT = 0
export function saveTotals(force = false) {
  const now = Date.now()
  if (force || now - saveT > 5000) {
    saveT = now
    save('totals', totals)
  }
}

export function wipeAll() {
  for (const k of ['runs', 'races', 'totals']) localStorage.removeItem(P + k)
  runs.length = 0
  races.length = 0
  Object.assign(totals, { odo: 0, maxV: 0, maxLeanL: 0, maxLeanR: 0, maxG: 0, time: 0, longTrip: 0, night: false, sessions: 0 })
}

// Identificador de esta sesión en la red (distinto por pestaña para poder probar con dos)
export const netId = Math.random().toString(36).slice(2, 10)
