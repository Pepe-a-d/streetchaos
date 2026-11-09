// Texto → palabras para la voz de la app (core/speech.js). La misma función parte las frases al generar
// los audios (scripts/voz.mjs) y al decirlas: así las claves coinciden siempre.
// Los números se pasan a palabras en español; la puntuación, a pausas ('|' corta, '||' larga).

const UNITS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve']
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const HUNDREDS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

/** 0-99 como se dice («noventa y dos»). */
export function under100(n) {
  if (n < 30) return UNITS[n]
  const t = Math.floor(n / 10)
  const u = n % 10
  return u ? `${TENS[t]} y ${UNITS[u]}` : TENS[t]
}

/** Un entero (0-999 999) en palabras. */
export function numWords(n) {
  n = Math.round(Math.abs(n))
  if (n < 100) return under100(n)
  if (n === 100) return 'cien'
  if (n < 1000) return `${HUNDREDS[Math.floor(n / 100)]}${n % 100 ? ` ${under100(n % 100)}` : ''}`
  if (n < 1000000) {
    const k = Math.floor(n / 1000)
    const r = n % 1000
    return `${k === 1 ? 'mil' : `${numWords(k)} mil`}${r ? ` ${numWords(r)}` : ''}`
  }
  return String(n)
    .split('')
    .map((d) => UNITS[+d])
    .join(' ')
}

/** Decimales («92» → noventa y dos; «05» → cero cinco). */
function decWords(s) {
  if (s.length === 1 || (s.length === 2 && s[0] !== '0')) return numWords(+s)
  return s
    .split('')
    .map((d) => UNITS[+d])
    .join(' ')
}

const plain = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/**
 * Palabras de una frase, con '|' (pausa corta: coma) y '||' (pausa larga: punto, exclamación…).
 * «Cero a cien en 3,92 segundos. ¡Récord!» → cero a cien en tres coma noventa y dos segundos || record
 */
export function words(text) {
  const s = String(text)
    // 1.000 → 1000 (separador de miles)
    .replace(/(\d)\.(?=\d{3}\b)/g, '$1')
    // 3,92 → tres coma noventa y dos
    .replace(/(\d+),(\d+)/g, (m, a, b) => ` ${numWords(+a)} coma ${decWords(b)} `)
    .replace(/\d+/g, (m) => ` ${numWords(+m)} `)
    .replace(/[.!?¡¿:;]+/g, ' || ')
    .replace(/,/g, ' | ')
  const out = []
  for (const w of plain(s).replace(/[^a-z0-9|\s]+/g, ' ').split(/\s+/)) {
    if (!w) continue
    if (w.startsWith('|')) {
      const last = out[out.length - 1]
      if (!out.length) continue
      if (last === '|' || last === '||') out[out.length - 1] = last === '||' || w === '||' ? '||' : '|'
      else out.push(w.length > 1 ? '||' : '|')
    } else out.push(w)
  }
  while (out.length && out[out.length - 1].startsWith('|')) out.pop()
  return out
}

/** Clave de una frase (sus palabras, sin pausas). */
export const keyOf = (text) => words(text).filter((w) => !w.startsWith('|')).join(' ')

/**
 * Parte las palabras en trozos que haya grabados (los más largos primero). Devuelve la lista de
 * claves y pausas, o null si alguna palabra no está.
 */
export function plan(text, has, maxLen = 14) {
  const w = words(text)
  const out = []
  let i = 0
  while (i < w.length) {
    if (w[i].startsWith('|')) {
      out.push(w[i])
      i++
      continue
    }
    let found = null
    for (let j = Math.min(w.length, i + maxLen); j > i; j--) {
      const seg = w.slice(i, j)
      if (seg.some((x) => x.startsWith('|'))) continue
      const k = seg.join(' ')
      if (has(k)) {
        found = [k, j]
        break
      }
    }
    if (!found) return null
    out.push(found[0])
    i = found[1]
  }
  return out
}
