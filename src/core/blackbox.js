// Caja negra: guarda en el móvil la telemetría en bruto de cada salida en moto, sin enseñarla.
// La app solo graba; el análisis lo hará una app de escritorio con el archivo que se exporta
// desde Garaje → Datos. El formato está en docs/telemetria.md: si cambias campos, sube FORMAT.
//
// - Una sesión empieza sola al pasar de ~9 km/h con buen GPS y se queda con los 30 s anteriores,
//   así entra también la salida desde parado.
// - Termina tras 3 minutos parado o sin datos (pantalla apagada, app cerrada).
// - Se escribe en IndexedDB cada 5 s: si la app se cierra o se recarga se pierden como mucho esos 5 s,
//   y al volver a abrirla la sesión sigue si han pasado menos de 3 minutos.
//
// Este módulo no toca el navegador salvo en idbStore(): el reloj, el almacén y los datos de la app
// se le pasan desde fuera (src/core/logger.js), y así se puede probar con un reloj falso.

export const FORMAT = 1

/** Columnas de cada flujo. `t` son segundos desde el inicio de la sesión. */
export const STREAMS = {
  gps: { type: 'float64', fields: ['t', 'ts', 'lat', 'lon', 'acc', 'alt', 'altAcc', 'speed', 'heading', 'v', 'hdg'] },
  imu: { type: 'float32', fields: ['t', 'ax', 'ay', 'az', 'lx', 'ly', 'lz', 'ra', 'rb', 'rg'] },
  calc: { type: 'float32', fields: ['t', 'v', 'gLong', 'gLat', 'lean'] },
}
const KEYS = ['gps', 'imu', 'calc']
const WIDTH = { gps: 11, imu: 10, calc: 5 }
const TYPED = { gps: Float64Array, imu: Float32Array, calc: Float32Array }

export const RULES = {
  startV: 2.5, // m/s (9 km/h) para empezar una sesión
  startAcc: 30, // m de precisión como mucho para fiarse de esa velocidad
  preRoll: 30, // s que se guardan de antes de empezar
  stopV: 1, // m/s: por debajo cuenta como parado
  endAfter: 180, // s parado o sin datos para cerrar la sesión
  flushEvery: 5, // s entre escrituras
  calcDt: 0.1, // s entre muestras de lo que calcula la app (10 Hz)
}

const num = (x) => (x == null || !Number.isFinite(x) ? NaN : x)
const round3 = (x) => Math.round(x * 1000) / 1000
const newBuf = () => ({ gps: [], imu: [], calc: [], ev: [] })
const newId = (epoch) => epoch.toString(36) + Math.random().toString(36).slice(2, 6)

/**
 * @param {object} o
 * @param {object} o.store    almacén (idbStore() o memoryStore())
 * @param {() => {perf: number, epoch: number}} o.now  reloj: perf en segundos (base de performance.now()), epoch en ms
 * @param {() => boolean} [o.enabled]  si se puede empezar una sesión
 * @param {() => object} [o.context]   datos fijos de la sesión (móvil, calibración, fuente...)
 * @param {() => number[] | null} [o.snapshot]  [v, gLong, gLat, lean°] que calcula la app ahora mismo
 */
export function createLogger({ store, now, enabled = () => true, context = () => ({}), snapshot = () => null, onEnd = () => {}, rules = RULES }) {
  const S = {
    ready: false,
    on: false,
    sess: null,
    t0: 0,
    buf: newBuf(),
    lastMove: 0,
    lastData: 0,
    lastCalc: -Infinity,
    lastFlush: 0,
    prev: null,
    imuInterval: null,
    chain: Promise.resolve(),
    error: '',
  }

  // Las escrituras van en fila para que los trozos lleguen en orden
  const queue = (fn) =>
    (S.chain = S.chain.then(fn).catch((e) => {
      S.error = String(e?.message || e)
    }))

  const stale = (t) => S.on && t - S.lastMove > rules.endAfter

  function gps(s) {
    const t = s.t
    if (stale(t)) end()
    S.buf.gps.push(t, num(s.ts), num(s.lat), num(s.lon), num(s.acc), num(s.alt), num(s.altAcc), num(s.speedRaw), num(s.headingRaw), num(s.v), num(s.heading))
    if (!S.on && S.ready && enabled() && s.v >= rules.startV && (s.acc ?? Infinity) <= rules.startAcc) start(t)
    if (S.on) {
      S.lastData = Math.max(S.lastData, t)
      if (s.v > rules.stopV) S.lastMove = t
      addStats(s)
    }
    S.prev = { t, v: s.v }
  }

  function addStats(s) {
    const p = S.prev
    const m = S.sess
    const dt = p ? s.t - p.t : 0
    if (dt > 0 && dt < 5 && s.v > 1 && (s.acc ?? Infinity) < 40) {
      m.dist += ((p.v + s.v) / 2) * dt
      m.moving += dt
    }
    if ((s.acc ?? Infinity) < 25) m.vmax = Math.max(m.vmax, s.v)
  }

  /** Un evento devicemotion tal cual llega (t en segundos, base de performance.now()). */
  function motion(e, t) {
    if (stale(t)) end()
    const ag = e.accelerationIncludingGravity || {}
    const a = e.acceleration || {}
    const r = e.rotationRate || {}
    S.buf.imu.push(t, num(ag.x), num(ag.y), num(ag.z), num(a.x), num(a.y), num(a.z), num(r.alpha), num(r.beta), num(r.gamma))
    if (S.on) S.lastData = Math.max(S.lastData, t)
    if (S.imuInterval == null && Number.isFinite(e.interval)) S.imuInterval = e.interval
  }

  /** Llamar cada ~100 ms: muestrea lo calculado, escribe a trozos y cierra sesiones paradas. */
  function tick() {
    const t = now().perf
    if (stale(t)) end()
    if (t - S.lastCalc >= rules.calcDt * 0.9) {
      const v = snapshot()
      if (v) {
        S.buf.calc.push(t, ...v.map(num))
        S.lastCalc = t
      }
    }
    if (S.on) {
      if (t - S.lastFlush >= rules.flushEvery) flush()
    } else trim(t - rules.preRoll)
  }

  /** Evento suelto (pasada, calibración, app en segundo plano...). */
  function event(type, data = {}, t = now().perf) {
    S.buf.ev.push({ ...data, type, t })
  }

  // Sin sesión solo se guardan los últimos segundos
  function trim(cut) {
    for (const k of KEYS) {
      const a = S.buf[k]
      const w = WIDTH[k]
      let i = 0
      while (i < a.length && a[i] < cut) i += w
      if (i) a.splice(0, i)
    }
    if (S.buf.ev.length && S.buf.ev[0].t < cut) S.buf.ev = S.buf.ev.filter((e) => e.t >= cut)
  }

  function start(t) {
    const { perf, epoch } = now()
    let first = t
    for (const k of KEYS) if (S.buf[k].length) first = Math.min(first, S.buf[k][0])
    for (const e of S.buf.ev) first = Math.min(first, e.t)
    S.t0 = first
    S.sess = {
      id: newId(epoch),
      format: FORMAT,
      state: 'rec',
      start: Math.round(epoch - (perf - first) * 1000),
      end: null,
      updated: epoch,
      ...context(),
      chunks: 0,
      bytes: 0,
      rows: { gps: 0, imu: 0, calc: 0, ev: 0 },
      dist: 0,
      moving: 0,
      vmax: 0,
      imuInterval: S.imuInterval,
      resumed: 0,
    }
    S.on = true
    S.lastMove = t
    S.lastData = t
    S.lastFlush = perf
    const m = { ...S.sess, rows: { ...S.sess.rows } }
    queue(() => store.putMeta(m))
  }

  function pack(k, flat) {
    const out = new TYPED[k](flat.length)
    const w = WIDTH[k]
    for (let i = 0; i < flat.length; i++) out[i] = i % w === 0 ? flat[i] - S.t0 : flat[i]
    return out
  }

  /** Escribe lo pendiente de la sesión en curso. */
  function flush() {
    if (!S.on) return S.chain
    const m = S.sess
    const b = S.buf
    S.buf = newBuf()
    S.lastFlush = now().perf
    m.updated = now().epoch
    if (m.imuInterval == null && S.imuInterval != null) m.imuInterval = S.imuInterval
    const empty = !b.gps.length && !b.imu.length && !b.calc.length && !b.ev.length
    let chunk = null
    if (!empty) {
      chunk = { id: m.id, seq: m.chunks, gps: pack('gps', b.gps), imu: pack('imu', b.imu), calc: pack('calc', b.calc), ev: b.ev.map((e) => ({ ...e, t: round3(e.t - S.t0) })) }
      m.chunks++
      m.bytes += chunk.gps.byteLength + chunk.imu.byteLength + chunk.calc.byteLength + JSON.stringify(chunk.ev).length
      for (const k of KEYS) m.rows[k] += b[k].length / WIDTH[k]
      m.rows.ev += b.ev.length
    }
    const snap = { ...m, rows: { ...m.rows } }
    return queue(() => (chunk ? store.putChunk(snap, chunk) : store.putMeta(snap)))
  }

  /** Cierra la sesión en curso (si la hay). */
  function end() {
    if (!S.on) return S.chain
    const m = S.sess
    flush()
    S.on = false
    S.sess = null
    m.state = 'done'
    m.end = m.start + Math.round((S.lastData - S.t0) * 1000)
    const snap = { ...m, rows: { ...m.rows } }
    return queue(async () => {
      await store.putMeta(snap)
      onEnd(snap)
    })
  }

  /** Al abrir la app: sigue la sesión que se cortó hace poco y cierra las viejas. */
  async function recover() {
    try {
      const metas = await store.listMeta()
      const { perf, epoch } = now()
      for (const m of metas) {
        if (m.state !== 'rec') continue
        if (!S.on && enabled() && epoch - m.updated < rules.endAfter * 1000) {
          S.sess = m
          S.on = true
          S.t0 = perf - (epoch - m.start) / 1000
          S.lastMove = perf - (epoch - m.updated) / 1000
          S.lastData = S.lastMove
          S.lastFlush = perf
          S.prev = null
          m.resumed = (m.resumed || 0) + 1
          event('resume', { gap: round3((epoch - m.updated) / 1000) })
        } else {
          m.state = 'done'
          m.end ??= m.updated
          await queue(() => store.putMeta(m))
        }
      }
    } catch (e) {
      S.error = String(e?.message || e)
    }
    S.ready = true
  }

  async function summary() {
    const metas = await store.listMeta()
    const sum = (k) => metas.reduce((s, m) => s + (m[k] || 0), 0)
    const pending = metas.filter((m) => m.state === 'done' && m.uploadedBytes !== m.bytes).length
    return { sessions: metas.length, bytes: sum('bytes'), dist: sum('dist'), moving: sum('moving'), recording: S.on, error: S.error, pending }
  }

  /** Apunta que una sesión cerrada ya está en la nube (con su tamaño de entonces). */
  async function markUploaded(id, bytes) {
    const m = (await store.listMeta()).find((x) => x.id === id)
    if (!m || m.state !== 'done') return
    m.uploadedBytes = bytes
    m.uploadedAt = now().epoch
    await queue(() => store.putMeta(m))
  }

  /** Borra toda la telemetría (y la sesión en curso, sin guardarla). */
  function wipe() {
    S.on = false
    S.sess = null
    S.buf = newBuf()
    S.prev = null
    return queue(() => store.clear())
  }

  return {
    gps,
    motion,
    tick,
    event,
    flush,
    end,
    recover,
    summary,
    markUploaded,
    wipe,
    list: () => store.listMeta(),
    read: (meta) => readSession(store, meta),
    get recording() {
      return S.on
    },
    state: S,
  }
}

/** Une los trozos de una sesión: un array tipado por flujo, en orden. */
export async function readSession(store, meta) {
  const chunks = (await store.getChunks(meta.id)).sort((a, b) => a.seq - b.seq)
  const cat = (k) => {
    const out = new TYPED[k](chunks.reduce((s, c) => s + c[k].length, 0))
    let o = 0
    for (const c of chunks) {
      out.set(c[k], o)
      o += c[k].length
    }
    return out
  }
  return { meta, gps: cat('gps'), imu: cat('imu'), calc: cat('calc'), ev: chunks.flatMap((c) => c.ev) }
}

/** Bytes de un array tipado en base64 (little-endian, como los guarda el móvil). */
export function toBase64(typed) {
  const u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength)
  const STEP = 3 * 0x4000 // múltiplo de 3: los trozos se pueden pegar sin relleno en medio
  let out = ''
  for (let i = 0; i < u8.length; i += STEP) out += btoa(String.fromCharCode.apply(null, u8.subarray(i, i + STEP)))
  return out
}

// ---------- Almacenes ----------

/** IndexedDB: una tienda con la ficha de cada sesión y otra con sus trozos. */
export function idbStore(name = 'sc-telemetria') {
  let dbp = null
  const open = () =>
    (dbp ??= new Promise((res, rej) => {
      const r = indexedDB.open(name, 1)
      r.onupgradeneeded = () => {
        const db = r.result
        db.createObjectStore('sessions', { keyPath: 'id' })
        db.createObjectStore('chunks', { keyPath: ['id', 'seq'] })
      }
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    }))
  async function run(stores, mode, fn) {
    const db = await open()
    return new Promise((res, rej) => {
      const tx = db.transaction(stores, mode)
      const req = fn(tx)
      tx.oncomplete = () => res(req?.result)
      tx.onerror = () => rej(tx.error)
      tx.onabort = () => rej(tx.error || new Error('Escritura cancelada'))
    })
  }
  const chunkRange = (id) => IDBKeyRange.bound([id, 0], [id, Infinity])
  return {
    putMeta: (m) => run(['sessions'], 'readwrite', (tx) => tx.objectStore('sessions').put(m)),
    putChunk: (m, c) =>
      run(['sessions', 'chunks'], 'readwrite', (tx) => {
        tx.objectStore('chunks').put(c)
        tx.objectStore('sessions').put(m)
      }),
    listMeta: () => run(['sessions'], 'readonly', (tx) => tx.objectStore('sessions').getAll()),
    getChunks: (id) => run(['chunks'], 'readonly', (tx) => tx.objectStore('chunks').getAll(chunkRange(id))),
    clear: () =>
      run(['sessions', 'chunks'], 'readwrite', (tx) => {
        tx.objectStore('sessions').clear()
        tx.objectStore('chunks').clear()
      }),
  }
}

/** En memoria, para los tests. */
export function memoryStore() {
  const sessions = new Map()
  const chunks = new Map()
  const copy = (x) => structuredClone(x)
  return {
    async putMeta(m) {
      sessions.set(m.id, copy(m))
    },
    async putChunk(m, c) {
      chunks.set(`${c.id}:${c.seq}`, copy(c))
      sessions.set(m.id, copy(m))
    },
    async listMeta() {
      return [...sessions.values()].map(copy)
    },
    async getChunks(id) {
      return [...chunks.values()].filter((c) => c.id === id).map(copy)
    },
    async clear() {
      sessions.clear()
      chunks.clear()
    },
  }
}

// ---------- Archivo binario de una sesión (subida a la nube) ----------
// «SCB1» + longitud de la cabecera (uint32 LE) + cabecera JSON (rellena con espacios hasta múltiplo
// de 8) + bytes de gps, imu y calc tal cual (little-endian). Se sube comprimido con gzip.

const MAGIC = [0x53, 0x43, 0x42, 0x31]

/** Sesión → bytes. `extra` va en la cabecera (móvil, piloto...). */
export function packSession(s, extra = {}) {
  const head = { format: FORMAT, streams: STREAMS, meta: s.meta, events: s.ev || [], bytes: { gps: s.gps.byteLength, imu: s.imu.byteLength, calc: s.calc.byteLength }, ...extra }
  const h = new TextEncoder().encode(JSON.stringify(head))
  const padded = Math.ceil((8 + h.length) / 8) * 8 - 8
  const total = 8 + padded + head.bytes.gps + head.bytes.imu + head.bytes.calc
  const u8 = new Uint8Array(total)
  u8.set(MAGIC, 0)
  new DataView(u8.buffer).setUint32(4, padded, true)
  u8.fill(0x20, 8, 8 + padded)
  u8.set(h, 8)
  let o = 8 + padded
  for (const k of ['gps', 'imu', 'calc']) {
    u8.set(new Uint8Array(s[k].buffer, s[k].byteOffset, s[k].byteLength), o)
    o += s[k].byteLength
  }
  return u8
}

/** Bytes → { meta, gps, imu, calc, ev, head }. */
export function unpackSession(u8) {
  if (!MAGIC.every((b, i) => u8[i] === b)) throw new Error('No es una sesión de la caja negra')
  const H = new DataView(u8.buffer, u8.byteOffset).getUint32(4, true)
  const head = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + H)))
  let o = 8 + H
  const take = (k, T) => {
    const n = head.bytes[k]
    const out = new T(u8.slice(o, o + n).buffer)
    o += n
    return out
  }
  return { head, meta: head.meta, gps: take('gps', Float64Array), imu: take('imu', Float32Array), calc: take('calc', Float32Array), ev: head.events || [] }
}

const stream = async (u8, S) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new S('gzip'))).arrayBuffer())
/** gzip si el navegador sabe (si no, tal cual). */
export const gzip = (u8) => (typeof CompressionStream === 'function' ? stream(u8, CompressionStream) : Promise.resolve(u8))
/** Deshace gzip si lo es. */
export const gunzip = (u8) => (u8[0] === 0x1f && u8[1] === 0x8b ? stream(u8, DecompressionStream) : Promise.resolve(u8))
