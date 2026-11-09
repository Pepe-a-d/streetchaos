// Sonidos chiptune generados con WebAudio (onda cuadrada, nada de archivos)
import { settings } from './store.js'
import { applyAudioSession } from './audiosession.js'

let ctx = null

export function unlockAudio() {
  // Antes de crear el sonido: que no le quite el audio a la música (ver voice.js)
  applyAudioSession()
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
  } catch {
    ctx = null
  }
}

/** El contexto de audio (lo usa también la voz de la app). Hasta el primer toque puede estar en pausa. */
export function audioContext() {
  if (!ctx) unlockAudio()
  return ctx
}

function tone(freq, dur, { type = 'square', vol = 0.12, at = 0, slide = null } = {}) {
  if (!ctx || !settings.sound) return
  const t = ctx.currentTime + at
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur)
  g.gain.setValueAtTime(vol, t)
  g.gain.setValueAtTime(vol, t + dur * 0.7)
  g.gain.linearRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(ctx.destination)
  o.start(t)
  o.stop(t + dur + 0.02)
}

const seq = (notes, step, opts) => notes.forEach((f, i) => f && tone(f, step * 0.9, { ...opts, at: i * step }))
const buzz = (ms) => navigator.vibrate?.(ms)

export const sfx = {
  click: () => tone(1200, 0.03, { vol: 0.06 }),
  armed: () => seq([523, 784], 0.09),
  launch: () => tone(180, 0.18, { slide: 720, vol: 0.1 }),
  mark: () => seq([988, 1319], 0.07),
  record: () => seq([523, 659, 784, 1047, 784, 1047], 0.09),
  done: () => seq([784, 659, 523], 0.08),
  stage: () => (tone(440, 0.08, { vol: 0.08 }), buzz(30)),
  amber: () => (tone(700, 0.16), buzz(60)),
  green: () => (tone(1400, 0.55, { vol: 0.16 }), buzz(250)),
  red: () => (tone(110, 0.8, { type: 'sawtooth', vol: 0.18 }), buzz([200, 80, 200])),
  win: () => seq([523, 659, 784, 1047, 0, 988, 1047, 1319], 0.11),
  lose: () => seq([392, 370, 349, 330, 0, 262], 0.16, { type: 'triangle', vol: 0.18 }),
  challenge: () => (seq([880, 660, 880, 660, 880, 660], 0.12), buzz([150, 80, 150, 80, 150])),
  error: () => tone(150, 0.25, { type: 'sawtooth', vol: 0.1 }),
}
