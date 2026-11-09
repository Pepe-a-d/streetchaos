// La voz de la app: cada cosa que dice se tiene que poder montar con los audios grabados (public/voz).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { words, plan, numWords } from '../src/core/speech-text.js'

globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} }
const { ACHIEVEMENTS, RANKS, LEVELS } = await import('../src/core/achievements.js')
const { spokenMark } = await import('../src/core/announcer.js')
const { MARKS } = await import('../src/core/perf.js')

const clips = JSON.parse(readFileSync(new URL('../public/voz/frases.json', import.meta.url), 'utf8')).clips
const has = (k) => k in clips
const ok = (text) => expect(plan(text, has), text).not.toBe(null)

describe('números y pausas', () => {
  it('pasa números a palabras', () => {
    expect(numWords(0)).toBe('cero')
    expect(numWords(21)).toBe('veintiuno')
    expect(numWords(92)).toBe('noventa y dos')
    expect(numWords(100)).toBe('cien')
    expect(numWords(129)).toBe('ciento veintinueve')
    expect(numWords(1000)).toBe('mil')
    expect(numWords(5000)).toBe('cinco mil')
  })
  it('decimales con coma y pausas en la puntuación', () => {
    expect(words('Cero a cien en 3,92 segundos. ¡Récord!').join(' ')).toBe('cero a cien en tres coma noventa y dos segundos || record')
    expect(words('3,05').join(' ')).toBe('tres coma cero cinco')
    expect(words('Cuarto de milla en 13,51 segundos, a 98.').join(' ')).toBe('cuarto de milla en trece coma cincuenta y uno segundos | a noventa y ocho')
    expect(words('Recorre 1.000 km').join(' ')).toBe('recorre mil km')
  })
  it('usa los trozos más largos que haya', () => {
    expect(plan('Cero a cien en 3,92 segundos. ¡Récord!', has)).toEqual(['cero a cien', 'en', 'tres', 'coma', 'noventa y dos', 'segundos', '||', 'record'])
    expect(plan('una palabra que no existe', has)).toBe(null)
  })
})

describe('todo lo que dice la app está grabado', () => {
  it('frases fijas, velocidad, GPS, curvas y caja negra', () => {
    for (const t of ['Grabando la salida', 'Crono listo', 'Pasada cancelada', 'GPS perdido', 'GPS de nuevo', 'Así suena esta voz', 'Salida guardada. 9,9 kilómetros', 'Salida guardada. 0,3 millas', 'Salida guardada. 123,4 kilómetros']) ok(t)
    for (const v of [30, 45, 50, 55, 65, 70, 75, 80, 90, 100, 120, 130]) ok(String(v))
    for (const d of [31, 48, 55]) for (const s of ['izquierda', 'derecha']) ok(`${d} grados ${s}`)
  })
  it('pasadas del crono y duelos', () => {
    for (const id of Object.keys(MARKS)) {
      ok(`${spokenMark(id)} en 4,39 segundos.`)
      ok(`${spokenMark(id)} en 13,51 segundos, a 245. ¡Récord!`)
    }
    for (const t of ['Victoria por 0,23 segundos', 'Derrota por 1,05 segundos', 'Ganas. El rival salió antes de tiempo', 'Ganas. El rival no llegó', 'Salida nula', 'No llegaste a meta', 'Cero a cien en tres coma nueve segundos. ¡Récord!']) ok(t)
  })
  it('logros y niveles', () => {
    for (const a of ACHIEVEMENTS) ok(`Logro: ${/\d/.test(a.title) ? a.desc : a.title.toLowerCase()}`)
    for (let n = 1; n <= LEVELS.length; n++) ok(`Subes a nivel ${n}. ${RANKS[n - 1].toLowerCase()}`)
  })
})
