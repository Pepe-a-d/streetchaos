// Genera la voz de la app: un audio corto por frase o trozo (números, nombres de parciales, logros...)
// en public/voz/, y public/voz/frases.json con qué clave va en qué archivo. La app la reproduce ella
// misma (core/speech.js) en vez de usar la voz del sistema, que en el iPhone para la música.
//
//   node scripts/voz.mjs RUTA/AL/venv/bin/python RUTA/es_ES-davefx-medium.onnx
//
// (Piper: pip install piper-tts en un entorno de Python 3.12; en macOS hay que pasarle sus datos de
// espeak con ESPEAK_DATA_PATH, ver docs/voz.md). Si cambias frases en la app, añádelas aquí.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }
const { keyOf, under100 } = await import('../src/core/speech-text.js')
const { ACHIEVEMENTS, RANKS } = await import('../src/core/achievements.js')
const { spokenMark } = await import('../src/core/announcer.js')
const { MARKS } = await import('../src/core/perf.js')

// [texto, cómo se le dice a Piper si no es igual]
const FIXED = [
  ['Grabando la salida'],
  ['Salida guardada'],
  ['Crono listo'],
  ['Pasada cancelada'],
  ['GPS perdido', 'Ge pe ese perdido'],
  ['GPS de nuevo', 'Ge pe ese de nuevo'],
  ['¡Récord!'],
  ['Victoria por'],
  ['Derrota por'],
  ['Salida nula'],
  ['No llegaste a meta'],
  ['Ganas'],
  ['El rival salió antes de tiempo'],
  ['El rival no llegó'],
  ['Logro'],
  ['Subes a nivel'],
  ['Así suena esta voz'],
  ['segundos'],
  ['segundo'],
  ['grados'],
  ['grados izquierda'],
  ['grados derecha'],
  ['izquierda'],
  ['derecha'],
  ['kilómetros'],
  ['kilómetro'],
  ['millas'],
  ['milla'],
  ['en'],
  ['a'],
  ['coma'],
  ['y'],
  ['por'],
  ['de'],
  ['mil'],
  ['cien'],
  ...['ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'].map((w) => [w]),
  // Resumen al terminar la salida (core/tripsum.js), tramos y vueltas (core/segments.js)
  ['minutos'],
  ['minuto'],
  ['horas'],
  ['hora'],
  ['kilómetros por hora'],
  ['millas por hora'],
  ['Récord de punta'],
  ['Récord de inclinación'],
  ['Récord de G', 'Récord de ge'],
  ['G', 'ge'],
  ['Punta'],
  ['Más tumbada'],
  ['Frenada más fuerte'],
  ['Tu trayecto'],
  ['más rápido que tu media'],
  ['más lento que tu media'],
  ['Tramo'],
  ['Vuelta'],
  ['Mejor vuelta'],
  ['Nuevo récord'],
  ['más rápido que tu mejor'],
  ['más lento que tu mejor'],
]

const items = new Map()
const add = (text, say = text) => {
  const key = keyOf(text)
  if (key && !items.has(key)) items.set(key, { key, text: say })
}
for (const [t, s] of FIXED) add(t, s)
for (let n = 0; n < 100; n++) add(under100(n))
for (const id of Object.keys(MARKS)) add(spokenMark(id))
// Lo que dice al desbloquear un logro (ui/unlock.js)
for (const a of ACHIEVEMENTS) add(/\d/.test(a.title) ? a.desc : a.title.toLowerCase())
for (const r of new Set(RANKS)) add(r.toLowerCase())

const list = [...items.values()].map((it, i) => ({ ...it, file: `v${String(i).padStart(3, '0')}` }))
const [python, model] = process.argv.slice(2)
if (!python || !model) {
  console.log(`${list.length} frases. Uso: node scripts/voz.mjs PYTHON MODELO.onnx`)
  process.exit(0)
}
const out = join(import.meta.dirname, '..', 'public', 'voz')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const tmp = join(tmpdir(), 'sc-voz.json')
writeFileSync(tmp, JSON.stringify(list))
execFileSync(python, [join(import.meta.dirname, 'voz', 'generar.py'), tmp, out, model], { stdio: 'inherit' })
writeFileSync(join(out, 'frases.json'), JSON.stringify({ v: 1, voz: 'es_ES-davefx-medium (Piper, CC0)', clips: Object.fromEntries(list.map((x) => [x.key, x.file])) }))
console.log(`${list.length} frases en public/voz`)
process.exit(0)
