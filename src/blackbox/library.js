// Biblioteca del analizador: lee los archivos que exporta la app y guarda las sesiones en este
// navegador (IndexedDB «sc-blackbox») para no tener que volver a cargarlos. Si el analizador se abre
// en el mismo móvil que graba, también puede leer directamente su caja negra.
import { STREAMS, idbStore, readSession } from '../core/blackbox.js'

const TYPED = { float64: Float64Array, float32: Float32Array }

function fromBase64(b64) {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(b64)
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
}

/** Archivo del modo rescate (index.html de la app): localStorage tal cual y la caja negra en trozos. */
function parseRescue(j) {
  const ls = j.localStorage || {}
  const get = (k, d) => {
    try {
      return JSON.parse(ls['sc-' + k]) ?? d
    } catch {
      return d
    }
  }
  const t = j.telemetry || { sessions: [], chunks: [] }
  const byId = new Map()
  for (const c of t.chunks || []) byId.set(c.id, [...(byId.get(c.id) || []), c])
  const sessions = (t.sessions || [])
    .map((meta) => {
      const cs = (byId.get(meta.id) || []).sort((a, b) => a.seq - b.seq)
      const cat = (k, T) => {
        const parts = cs.map((c) => {
          const u = fromBase64(c[k] || '')
          return new T(u.buffer, u.byteOffset, u.byteLength / T.BYTES_PER_ELEMENT)
        })
        const out = new T(parts.reduce((s, p) => s + p.length, 0))
        let o = 0
        for (const p of parts) (out.set(p, o), (o += p.length))
        return out
      }
      return { meta, gps: cat('gps', Float64Array), imu: cat('imu', Float32Array), calc: cat('calc', Float32Array), ev: cs.flatMap((c) => c.ev || []) }
    })
    .filter((s) => s.gps.length)
  return { device: null, exportedAt: j.exportedAt, runs: get('runs', []), races: get('races', []), settings: get('settings', {}), sessions }
}

/** Texto de un archivo exportado (o del modo rescate) → sesiones con sus flujos como arrays tipados. */
export function parseExport(text) {
  const j = typeof text === 'string' ? JSON.parse(text) : text
  if (j?.format === 'streetchaos-rescue') return parseRescue(j)
  if (j?.format !== 'streetchaos-export' || !j.telemetry) throw new Error('No es un archivo exportado de Street Chaos')
  const streams = j.telemetry.streams || STREAMS
  const sessions = (j.telemetry.sessions || []).map(({ events, gps, imu, calc, ...meta }) => {
    const dec = (b64, k) => {
      const u8 = fromBase64(b64 || '')
      return new TYPED[streams[k].type](u8.buffer, u8.byteOffset, u8.byteLength / TYPED[streams[k].type].BYTES_PER_ELEMENT)
    }
    return { meta, gps: dec(gps, 'gps'), imu: dec(imu, 'imu'), calc: dec(calc, 'calc'), ev: events || [] }
  })
  return { device: j.id ?? null, exportedAt: j.exportedAt, runs: j.runs || [], races: j.races || [], settings: j.settings || {}, sessions }
}

// ---------- IndexedDB ----------

// La base se abre en la versión que tenga y solo se sube de versión si le falta alguna tienda.
// Mientras otra pestaña la tenga abierta con la versión vieja, el navegador no deja subirla: se avisa
// (onDbBlocked) y, en cuanto la otra se cierra, sigue sola. Las pestañas de ahora sueltan la base si
// otra más nueva la necesita (onversionchange), así esto no vuelve a atascarse.
const STORES = [
  ['meta', { keyPath: 'id' }],
  ['data', { keyPath: 'id' }],
  ['segments', { keyPath: 'id' }],
  ['efforts', { keyPath: ['seg', 'session'] }],
  // Análisis ya hechos (para no repetirlos cada vez que se abre la página): { id, size, v, A }
  ['analysis', { keyPath: 'id' }],
  // Vídeos de cada salida (solo nombre, tamaño y desfase; el vídeo se queda en el disco): { id, list }
  ['videos', { keyPath: 'id' }],
]
const blockedSubs = new Set()
export const onDbBlocked = (fn) => (blockedSubs.add(fn), () => blockedSubs.delete(fn))

function openDb(version) {
  return new Promise((res, rej) => {
    const r = version ? indexedDB.open('sc-blackbox', version) : indexedDB.open('sc-blackbox')
    r.onupgradeneeded = () => {
      for (const [name, opts] of STORES) if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name, opts)
    }
    r.onblocked = () => blockedSubs.forEach((fn) => fn(true))
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

let dbp = null
function db() {
  dbp ??= (async () => {
    let d = await openDb()
    if (STORES.some(([name]) => !d.objectStoreNames.contains(name))) {
      const v = d.version + 1
      d.close()
      d = await openDb(v)
    }
    blockedSubs.forEach((fn) => fn(false))
    d.onversionchange = () => {
      d.close()
      dbp = null
    }
    return d
  })().catch((e) => {
    dbp = null
    throw e
  })
  return dbp
}
async function run(stores, mode, fn) {
  const d = await db()
  return new Promise((res, rej) => {
    const tx = d.transaction(stores, mode)
    const req = fn(tx)
    tx.oncomplete = () => res(req?.result)
    tx.onerror = () => rej(tx.error)
    tx.onabort = () => rej(tx.error || new Error('Cancelado'))
  })
}

const size = (s) => s.gps.length + s.imu.length + s.calc.length

/** Caja [oeste, sur, este, norte] de los fixes de GPS (para saber rápido qué salidas pasan por un sitio). */
export function gpsBbox(gps) {
  const w = STREAMS.gps.fields.length
  let b = null
  for (let i = 0; i + w <= gps.length; i += w) {
    const la = gps[i + 2]
    const lo = gps[i + 3]
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue
    if (!b) b = [lo, la, lo, la]
    else (b[0] = Math.min(b[0], lo)), (b[1] = Math.min(b[1], la)), (b[2] = Math.max(b[2], lo)), (b[3] = Math.max(b[3], la))
  }
  return b
}

/** Lista de sesiones guardadas (solo la ficha), la más reciente primero. */
export async function listSessions() {
  const all = await run(['meta'], 'readonly', (tx) => tx.objectStore('meta').getAll())
  return all.sort((a, b) => b.start - a.start)
}

/**
 * Guarda sesiones; si ya estaba, se queda con la versión más larga (una sesión que se exportó a medias
 * vuelve más completa en la siguiente exportación). Devuelve cuántas son nuevas o se han ampliado.
 */
export async function addSessions(sessions, from) {
  const have = new Map((await listSessions()).map((m) => [m.id, m]))
  let added = 0
  let grown = 0
  const changed = []
  for (const s of sessions) {
    const old = have.get(s.meta.id)
    if (old && old.size >= size(s)) continue
    if (old) grown++
    else added++
    changed.push(s.meta.id)
    const meta = { ...s.meta, size: size(s), from, importedAt: Date.now(), nEv: s.ev.length, nRuns: s.ev.filter((e) => e.type === 'run').length, bbox: gpsBbox(s.gps) }
    await run(['meta', 'data'], 'readwrite', (tx) => {
      tx.objectStore('meta').put(meta)
      tx.objectStore('data').put({ id: s.meta.id, gps: s.gps, imu: s.imu, calc: s.calc, ev: s.ev })
    })
  }
  return { added, grown, changed, skipped: sessions.length - added - grown }
}

export async function loadSession(id) {
  const [meta, data] = await Promise.all([run(['meta'], 'readonly', (tx) => tx.objectStore('meta').get(id)), run(['data'], 'readonly', (tx) => tx.objectStore('data').get(id))])
  if (!meta || !data) return null
  return { meta, gps: data.gps, imu: data.imu, calc: data.calc, ev: data.ev }
}

export async function deleteSession(id) {
  await run(['meta', 'data', 'analysis', 'videos'], 'readwrite', (tx) => {
    tx.objectStore('meta').delete(id)
    tx.objectStore('data').delete(id)
    tx.objectStore('analysis').delete(id)
    tx.objectStore('videos').delete(id)
  })
}

/** Análisis guardado de una salida (o undefined). */
export const getAnalysis = (id) => run(['analysis'], 'readonly', (tx) => tx.objectStore('analysis').get(id)).catch(() => undefined)
export const putAnalysis = (rec) => run(['analysis'], 'readwrite', (tx) => tx.objectStore('analysis').put(rec)).catch(() => {})

/** Vídeos guardados de una salida: [{ name, size, lastModified, off, how, err, dur, handle? }]. */
export const getVideos = async (id) => (await run(['videos'], 'readonly', (tx) => tx.objectStore('videos').get(id)).catch(() => null))?.list || []
export const putVideos = (id, list) => run(['videos'], 'readwrite', (tx) => tx.objectStore('videos').put({ id, list })).catch(() => {})

// ---------- Tramos ----------

export const listSegments = async () => (await run(['segments'], 'readonly', (tx) => tx.objectStore('segments').getAll())).sort((a, b) => a.name.localeCompare(b.name, 'es'))
export const saveSegment = (seg) => run(['segments'], 'readwrite', (tx) => tx.objectStore('segments').put(seg))
export async function deleteSegment(id) {
  await run(['segments', 'efforts'], 'readwrite', (tx) => {
    tx.objectStore('segments').delete(id)
    tx.objectStore('efforts').delete(IDBKeyRange.bound([id, ''], [id, '\uffff']))
  })
}
/** Tiempos de un tramo ya buscados en una salida (se rehacen si la salida ha crecido). */
export const getEfforts = (seg, session) => run(['efforts'], 'readonly', (tx) => tx.objectStore('efforts').get([seg, session]))
export const putEfforts = (rec) => run(['efforts'], 'readwrite', (tx) => tx.objectStore('efforts').put(rec))
export const updateMeta = (meta) => run(['meta'], 'readwrite', (tx) => tx.objectStore('meta').put(meta))

/** Sesiones de la caja negra de este mismo dispositivo (si el analizador se abre en el móvil). */
export async function deviceSessions({ count = false } = {}) {
  try {
    if (!(await indexedDB.databases?.())?.some((d) => d.name === 'sc-telemetria')) return count ? 0 : []
    const store = idbStore('sc-telemetria')
    const metas = await store.listMeta()
    // Para enseñar el botón basta con contarlas: leerlas enteras solo al pulsarlo
    if (count) return metas.length
    const out = []
    for (const m of metas) out.push(await readSession(store, m))
    return out
  } catch {
    return count ? 0 : []
  }
}
