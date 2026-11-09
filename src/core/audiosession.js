// Cómo convive el sonido de la app con la música del móvil (Audio Session API, Safari/iOS 16.4+).
// Por defecto, en cuanto una web suena, iOS le da el audio a ella y Apple Music se para. Con esto la web
// dice qué clase de sonido es: 'transient' suena encima (y baja la música si hace falta),
// 'transient-solo' la pausa y la reanuda al acabar, 'ambient' se mezcla sin más.
// OJO: la voz del sistema (speechSynthesis) NO hace caso de esto en el iPhone: se queda el audio para
// ella sola y para la música. Por eso la app habla con sus propios audios (core/speech.js).
// Con el móvil en silencio, iOS puede callar estos sonidos (respetan el interruptor).
import { settings } from './store.js'

export const MUSIC_MODES = {
  duck: ['transient', 'BAJARLA', 'Habla encima de la música'],
  pause: ['transient-solo', 'PAUSARLA', 'La para mientras habla y la vuelve a poner'],
  mix: ['ambient', 'ENCIMA', 'Se mezcla con la música sin tocarla'],
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
