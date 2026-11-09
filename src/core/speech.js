// Voz de la app con audios propios (public/voz, generados con scripts/voz.mjs). Se reproducen con
// Web Audio, que en el iPhone sí respeta la sesión de audio (core/audiosession.js) y deja sonar la
// música a la vez; la voz del sistema la paraba. Cada frase se monta con los trozos grabados más
// largos que encajen (frases enteras, números, nombres de parciales, logros) y pausas en comas y puntos.
import { plan } from './speech-text.js'
import { audioContext } from './audio.js'
import { applyAudioSession } from './audiosession.js'

const BASE = `${import.meta.env?.BASE_URL ?? '/'}voz/`
const GAP = { word: 0.04, '|': 0.18, '||': 0.38 }

let index = null
let indexing = null
/** Carga la lista de frases grabadas (una vez). */
export function loadIndex() {
  indexing ??= fetch(`${BASE}frases.json`)
    .then((r) => (r.ok ? r.json() : { clips: {} }))
    .then((j) => (index = new Map(Object.entries(j.clips || {}))))
    .catch(() => {
      indexing = null
      return (index = index || new Map())
    })
  return indexing
}

const buffers = new Map()
function clip(file) {
  if (!buffers.has(file))
    buffers.set(
      file,
      fetch(`${BASE}${file}.m4a`)
        .then((r) => r.arrayBuffer())
        .then((ab) => audioContext().decodeAudioData(ab))
        .catch((e) => {
          buffers.delete(file)
          throw e
        }),
    )
  return buffers.get(file)
}

/** ¿Se puede decir con los audios? (lista de trozos y pausas, o null) */
export async function planFor(text) {
  await loadIndex()
  return plan(text, (k) => index.has(k))
}

const queue = []
let playing = null // { sources, until }
let timer = null

function stopAll() {
  if (playing) for (const s of playing.sources) {
    try {
      s.stop()
    } catch {}
  }
  playing = null
  clearTimeout(timer)
}

async function next() {
  if (playing || !queue.length) return
  const parts = queue.shift()
  const ctx = audioContext()
  if (!ctx) return
  playing = { sources: [], until: 0 }
  const mine = playing
  try {
    applyAudioSession()
    if (ctx.state !== 'running') await ctx.resume().catch(() => {})
    const bufs = await Promise.all(parts.map((p) => (p.startsWith('|') ? null : clip(index.get(p)))))
    if (playing !== mine) return // cortada mientras cargaba
    let t = ctx.currentTime + 0.06
    parts.forEach((p, i) => {
      if (p.startsWith('|')) return (t += GAP[p])
      const src = ctx.createBufferSource()
      src.buffer = bufs[i]
      src.connect(ctx.destination)
      src.start(t)
      mine.sources.push(src)
      t += bufs[i].duration + GAP.word
    })
    mine.until = t
    timer = setTimeout(() => {
      if (playing === mine) playing = null
      next()
    }, (t - ctx.currentTime) * 1000 + 50)
  } catch {
    if (playing === mine) playing = null
    next()
  }
}

/**
 * Dice una frase con los audios de la app. urgent: corta lo que esté diciendo. Devuelve una promesa
 * con false si no se puede montar (alguna palabra sin grabar): entonces que hable la voz del sistema.
 */
export async function speak(text, { urgent = false } = {}) {
  const parts = await planFor(text)
  if (!parts || !audioContext()) return false
  if (urgent) {
    queue.length = 0
    stopAll()
  }
  queue.push(parts)
  next()
  return true
}

/** Precarga la lista y los trozos más usados (tras el primer toque). */
export function warmUp() {
  loadIndex().then(() => {
    for (const k of ['grabando la salida', 'salida guardada', 'crono listo', 'segundos', 'coma', 'record']) if (index.has(k)) clip(index.get(k)).catch(() => {})
  })
}

export const __test = { queue, get index() { return index } }
