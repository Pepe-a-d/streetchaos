// Voz: la app te habla por donde suene el móvil (el intercomunicador del casco si está conectado).
// Dos voces:
// - 'app' (por defecto): audios propios grabados con Piper (core/speech.js). Suenan con Web Audio y
//   dejan sonar la música a la vez (core/audiosession.js).
// - 'system': la voz en español del móvil (Web Speech). Es más natural y dice cualquier cosa, pero en
//   el iPhone se queda el audio y PARA la música.
// En iPhone el sonido tiene que arrancar en un toque: unlockVoice() se llama en cada toque.
import { settings } from './store.js'
import { speak as speakApp, warmUp } from './speech.js'
import { applyAudioSession } from './audiosession.js'
export { MUSIC_MODES, audioSessionAvailable, applyAudioSession } from './audiosession.js'

export const systemVoiceAvailable = () => typeof window !== 'undefined' && 'speechSynthesis' in window
const audioAvailable = () => typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext)
export const voiceAvailable = () => audioAvailable() || systemVoiceAvailable()
/** La voz que se usa: la de la app salvo que se elija la del móvil (o no haya Web Audio). */
export const voiceEngine = () => (settings.voiceEngine === 'system' && systemVoiceAvailable()) || !audioAvailable() ? 'system' : 'app'

// Qué dice (cada uno se puede apagar en Garaje → Voz)
export const VOICE_EVENTS = [
  ['crono', 'Pasadas del crono', 'El tiempo al terminar, y si es récord'],
  ['duel', 'Duelos', 'Si ganas o pierdes y por cuánto'],
  ['speed', 'Avisos de velocidad', 'Al pasar de las velocidades que elijas'],
  ['gps', 'GPS', 'Si se pierde la señal y cuando vuelve'],
  ['box', 'Caja negra', 'Cuando empieza a grabar y cuando guarda la salida'],
  ['ach', 'Logros', 'Cuando desbloqueas uno o subes de nivel'],
  ['lean', 'Inclinación en las curvas', 'Los grados al salir de una curva fuerte (más de 30°)'],
]
export const VOICE_DEFAULTS = { crono: true, duel: true, speed: true, gps: true, box: true, ach: true, lean: false }
export const SPEED_STEPS = { kmh: [50, 70, 90, 100, 120, 130], mph: [30, 45, 55, 65, 75, 80] }

// Voces «de juguete» de Apple (robóticas o con efectos): al final de la lista
const NOVELTY = /^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/i

/** Voces en español del móvil: las normales antes que las de juguete, y las de España primero. */
export function spanishVoices() {
  if (!systemVoiceAvailable()) return []
  const score = (v) => (NOVELTY.test(v.name) ? 0 : 4) + (/es[-_]ES/i.test(v.lang) ? 2 : 0) + (v.localService ? 1 : 0)
  return speechSynthesis
    .getVoices()
    .filter((v) => /^es([-_]|$)/i.test(v.lang))
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))
}
const pickVoice = () => {
  const list = spanishVoices()
  return list.find((v) => v.voiceURI === settings.voiceName) || list[0] || null
}

let unlocked = false
export function unlockVoice() {
  if (unlocked || !voiceAvailable()) return
  unlocked = true
  applyAudioSession()
  // Con la voz de la app no se toca la del sistema: solo con decir una frase en silencio, el iPhone ya
  // paraba la música al abrir la app
  if (voiceEngine() === 'app') return warmUp()
  const u = new SpeechSynthesisUtterance(' ')
  u.volume = 0
  speechSynthesis.speak(u)
}

/**
 * Dice una frase. kind: el tipo de aviso (se respeta si está apagado). urgent: corta lo que esté
 * diciendo (para resultados), si no, se pone a la cola.
 */
export function say(text, { kind = null, urgent = false, force = false } = {}) {
  if (!voiceAvailable() || (!settings.voice && !force)) return false
  if (kind && !force && (settings.voiceEvents?.[kind] ?? VOICE_DEFAULTS[kind]) === false) return false
  applyAudioSession()
  if (voiceEngine() === 'app') {
    // Si alguna palabra no está grabada, la dice la voz del sistema (no debería pasar)
    speakApp(text, { urgent }).then((ok) => ok || sayWithSystem(text, urgent))
    return true
  }
  return sayWithSystem(text, urgent)
}

function sayWithSystem(text, urgent) {
  if (!systemVoiceAvailable()) return false
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'es-ES'
  const v = pickVoice()
  if (v) u.voice = v
  u.rate = settings.voiceRate || 1.05
  u.volume = 1
  if (urgent && speechSynthesis.speaking) {
    speechSynthesis.cancel()
    // Safari se traga a veces lo que se dice justo después de cancelar
    setTimeout(() => speechSynthesis.speak(u), 60)
  } else speechSynthesis.speak(u)
  return true
}

/** Número para decirlo: 3.92 → «3,92». */
export const spoken = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d).replace('.', ',') : '')
