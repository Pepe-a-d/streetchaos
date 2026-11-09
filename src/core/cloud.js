// Subida automática de la caja negra para el Blackbox: cada salida cerrada se sube comprimida a la
// nube (Supabase), a una carpeta que solo abre la clave de sincronización de este móvil.
// El servidor no ve la clave: la función «caja-negra» guarda cada móvil en la carpeta de su huella.
import { settings, setSetting, onSetting, totals, runs, bests, load, save } from './store.js'
import { logger } from './logger.js'
import { packSession, gzip } from './blackbox.js'
import { deviceId } from './device.js'
import { level, unlocked, ACHIEVEMENTS, onAchievement } from './achievements.js'

const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_KEY
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // sin I, L, O, 0 ni 1 para que no haya dudas al copiarla

export const cloudAvailable = () => Boolean(URL && KEY)

/** Clave de este móvil (se crea la primera vez): 5 grupos de 4, ~99 bits. */
export function syncKey() {
  if (!settings.syncKey) {
    const r = crypto.getRandomValues(new Uint8Array(20))
    const chars = [...r].map((b) => ALPHA[b % ALPHA.length]).join('')
    setSetting('syncKey', chars.match(/.{4}/g).join('-'))
  }
  return settings.syncKey
}

/** Enlace que abre el Blackbox ya vinculado (la clave va tras #, no llega a ningún servidor). */
export const blackboxLink = () => `${location.origin}${import.meta.env.BASE_URL}blackbox/#k=${syncKey()}`

async function call(body) {
  const r = await fetch(`${URL}/functions/v1/caja-negra`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: syncKey(), ...body }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

export const cloud = { busy: false, last: null, error: '', pending: 0 }
const subs = new Set()
export const onCloud = (fn) => (subs.add(fn), () => subs.delete(fn))
const changed = () => subs.forEach((fn) => fn(cloud))

let running = null
/** Sube lo que falte. Se puede llamar cuantas veces se quiera: no se solapa. */
export function syncNow() {
  // Después de las salidas, el perfil (si ha cambiado)
  running ??= run()
    .then(() => pushProfile().catch(() => {}))
    .finally(() => (running = null))
  return running
}

async function run() {
  const L = logger()
  if (!L || !settings.cloudSync || !cloudAvailable() || !navigator.onLine) return
  const todo = (await L.list()).filter((m) => m.state === 'done' && m.uploadedBytes !== m.bytes).sort((a, b) => a.start - b.start)
  cloud.pending = todo.length
  if (!todo.length) return changed()
  cloud.busy = true
  cloud.error = ''
  changed()
  try {
    for (const m of todo) {
      const s = await L.read(m)
      const body = await gzip(packSession({ meta: m, gps: s.gps, imu: s.imu, calc: s.calc, ev: s.ev }, { device: deviceId(), rider: settings.name, bike: settings.bike }))
      const { url } = await call({ action: 'put', id: m.id })
      const r = await fetch(url, { method: 'PUT', headers: { apikey: KEY, 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }, body })
      if (!r.ok) throw new Error(`subida HTTP ${r.status}`)
      const { uploadedBytes, uploadedAt, ...meta } = m
      await call({ action: 'commit', id: m.id, meta: { ...meta, rider: { ...meta.rider, name: settings.name } } })
      await L.markUploaded(m.id, m.bytes)
      cloud.pending--
      cloud.last = Date.now()
      changed()
    }
  } catch (e) {
    cloud.error = String(e?.message || e)
  } finally {
    cloud.busy = false
    changed()
  }
}

// ---------- Perfil del piloto (para el Blackbox del ordenador) ----------
// Lo que enseña el ordenador vinculado: quién eres, tu moto, tu tema de colores, tu nivel y tus
// récords. Va a la misma carpeta que las salidas (la de la clave de este móvil).

/** El perfil tal cual se sube. */
export function profileData() {
  const lv = level()
  const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null)
  return {
    v: 1,
    name: settings.name || '',
    bike: settings.bike || '',
    color: settings.color,
    units: settings.units,
    theme: settings.theme,
    digits: settings.digits,
    accentBike: !!settings.accentBike,
    level: { n: lv.n, rank: lv.rank, xp: lv.xp, frac: r3(lv.frac) },
    achievements: { got: Object.keys(unlocked).filter((id) => ACHIEVEMENTS.some((a) => a.id === id)).length, total: ACHIEVEMENTS.length },
    totals: { odo: r3(totals.odo), maxV: r3(totals.maxV), maxLeanL: r3(totals.maxLeanL), maxLeanR: r3(totals.maxLeanR), maxG: r3(totals.maxG), time: r3(totals.time), sessions: totals.sessions || 0 },
    bests: Object.fromEntries(Object.entries(bests()).map(([id, m]) => [id, { t: r3(m.t), date: m.date }])),
    runs: runs.slice(0, 40).map((r) => ({ id: r.id, date: r.date, valid: !!r.valid, maxV: r3(r.maxV), marks: Object.fromEntries(Object.entries(r.marks || {}).map(([id, m]) => [id, r3(m.t)])) })),
    device: { ios: /iPhone|iPad/.test(navigator.userAgent), standalone: matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true },
  }
}

let lastProfile = load('profileSent', '')
let profileTimer = null
/** Sube el perfil si ha cambiado desde la última vez. */
export async function pushProfile() {
  if (!settings.cloudSync || !cloudAvailable() || !navigator.onLine) return false
  const p = profileData()
  const sig = JSON.stringify(p)
  if (sig === lastProfile) return false
  await call({ action: 'profile-put', profile: { ...p, updatedAt: Date.now() } })
  lastProfile = sig
  save('profileSent', sig)
  return true
}
/** Lo sube al rato (para no subirlo con cada toque en los ajustes). */
export function pushProfileSoon(ms = 4000) {
  clearTimeout(profileTimer)
  profileTimer = setTimeout(() => pushProfile().catch(() => {}), ms)
}
const PROFILE_KEYS = ['name', 'bike', 'color', 'units', 'theme', 'digits', 'accentBike', 'cloudSync']
onSetting((key) => PROFILE_KEYS.includes(key) && pushProfileSoon())
onAchievement(() => pushProfileSoon(10000))

/** Código de 6 letras para vincular un ordenador (vale 10 minutos y una vez). Sube antes el perfil. */
export async function pairCode() {
  const r = await call({ action: 'pair-new' })
  pushProfile().catch(() => {})
  return r
}
