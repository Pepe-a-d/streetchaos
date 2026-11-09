// Voz: la app habla con la voz en español del móvil (Web Speech), y suena por donde suene el móvil:
// el intercomunicador del casco si está conectado por Bluetooth. Así te enteras sin mirar.
// En iPhone la primera frase tiene que salir de un toque: unlockVoice() se llama en cada toque
// hasta que queda desbloqueada.
import { settings } from './store.js'

export const voiceAvailable = () => typeof window !== 'undefined' && 'speechSynthesis' in window

// Con la música del móvil. Por defecto, en cuanto una web suena (voz o pitidos), iOS le da el audio
// a ella y Apple Music se para. Con la Audio Session API (Safari/iOS 16.4+) la web dice qué clase de
// sonido es: 'transient' suena encima y baja la música un momento, 'transient-solo' la pausa y la
// reanuda al acabar, 'ambient' se mezcla sin bajarla. Ojo: con el móvil en silencio, iOS puede callar
// estos sonidos (son de los que respetan el interruptor).
export const MUSIC_MODES = {
  duck: ['transient', 'BAJARLA', 'Baja la música mientras habla'],
  pause: ['transient-solo', 'PAUSARLA', 'La para y la vuelve a poner al acabar'],
  mix: ['ambient', 'ENCIMA', 'Habla encima sin bajarla'],
}
export const audioSessionAvailable = () => typeof navigator !== 'undefined' && !!navigator.audioSession

/** Le dice al móvil cómo tiene que convivir el sonido de la app con la música. Llamar antes de sonar. */
export function applyAudioSession() {
  if (!audioSessionAvailable()) return false
  const type = (MUSIC_MODES[settings.voiceMusic] || MUSIC_MODES.duck)[0]
  try {
    if (navigator.audioSession.type !== type) navigator.audioSession.type = type
    return true
  } catch {
    return false
  }
}

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
  if (!voiceAvailable()) return []
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
