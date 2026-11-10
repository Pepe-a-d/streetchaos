// Nube del Blackbox: baja las salidas que sube el móvil (con su clave de sincronización) y lee y
// publica la clasificación de los circuitos compartidos.
import { unpackSession, gunzip } from '../core/blackbox.js'

const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_KEY
const LS = 'sc-bb-key'

export const cloudAvailable = () => Boolean(URL && KEY)

export function getKey() {
  try {
    return localStorage.getItem(LS) || ''
  } catch {
    return ''
  }
}
export function setKey(k) {
  try {
    if (k) localStorage.setItem(LS, k)
    else localStorage.removeItem(LS)
  } catch {}
}
export const validKey = (k) => /^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/.test(k)
export const normKey = (k) => String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-')

/** El enlace del móvil trae la clave tras #k=: se guarda y se quita de la barra. */
export function keyFromUrl() {
  const m = location.hash.match(/k=([A-Z0-9-]+)/i)
  if (!m) return null
  const k = normKey(m[1])
  history.replaceState(null, '', location.pathname + location.search)
  if (!validKey(k)) return null
  setKey(k)
  return k
}

async function call(body) {
  const r = await fetch(`${URL}/functions/v1/caja-negra`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: getKey(), ...body }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

export const listRemote = async () => (await call({ action: 'list' })).sessions || []

/** Baja y abre una salida de la nube: { meta, gps, imu, calc, ev }. */
export async function fetchRemote(id) {
  const { url } = await call({ action: 'get', id })
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const s = unpackSession(await gunzip(new Uint8Array(await r.arrayBuffer())))
  return { meta: s.meta, gps: s.gps, imu: s.imu, calc: s.calc, ev: s.ev }
}

export const deleteRemote = (id) => call({ action: 'del', id })

/** Perfil que sube el móvil: nombre, moto, tema, nivel y récords (o null si aún no ha subido ninguno). */
export const fetchProfile = async () => (await call({ action: 'profile-get' })).profile || null

/** Vincula con el código de 6 letras que da el móvil (Garaje → Datos → Vincular el ordenador). */
export async function claimCode(code) {
  const r = await fetch(`${URL}/functions/v1/caja-negra`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pair-claim', code }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !validKey(j.key || '')) throw new Error(j.error || `HTTP ${r.status}`)
  setKey(j.key)
  return j.key
}
export const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)

// ---------- Circuitos compartidos ----------

async function rest(path, { method = 'GET', body } = {}) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY, 'Content-Type': 'application/json', ...(method === 'POST' ? { Prefer: 'return=representation' } : {}) },
    body: body && JSON.stringify(body),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(j?.message || `HTTP ${r.status}`)
  return j
}

export const sharedCircuits = () => rest('bb_segments?select=id,name,author,length_m,closed,created_at&order=created_at.desc&limit=200')
export const sharedCircuit = async (id) => (await rest(`bb_segments?id=eq.${encodeURIComponent(id)}&select=*`))[0]
export const shareCircuit = async (seg, author) => (await rest('bb_segments', { method: 'POST', body: { name: seg.name, author, points: seg.points, length_m: seg.length, closed: seg.closed } }))[0]
export const ranking = (segmentId) => rest(`bb_efforts?segment_id=eq.${encodeURIComponent(segmentId)}&select=rider,bike,time_s,v_max,lean_max,ridden_at,device,ghost&order=time_s.asc&limit=100`)
export const publishEffort = (e) => rest('bb_efforts', { method: 'POST', body: e })

// ---------- Pasadas de amigos ----------
// Se guardan con la función (sin clave de móvil) y se bajan con su código de 8 letras: no se pueden listar.
export const normGhostCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
export const validGhostCode = (c) => /^[A-Z2-9]{8}$/.test(c)
/** Sube una pasada empaquetada (ghost.js) y devuelve su código. */
export const shareGhost = async (ghost) => (await call({ action: 'ghost-put', ghost })).code
export const fetchGhost = async (code) => (await call({ action: 'ghost-get', code: normGhostCode(code) })).ghost

// ---------- Datos para el móvil vinculado ----------
/** Guarda datos para el móvil (p. ej. los tramos, que cronometra en directo). */
export const kvPut = (kind, data) => call({ action: 'kv-put', kind, data })
