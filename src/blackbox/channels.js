// Canales del analizador: nombre, unidad, color, formato y rampa de color para el mapa.

import { pal } from './palette.js'

export const units = { speed: 'kmh' }
const MPH = 0.44704

export const speedUnit = () => (units.speed === 'mph' ? 'mph' : 'km/h')
export const toSpeed = (ms) => (units.speed === 'mph' ? ms / MPH : ms * 3.6)
export const distUnit = () => (units.speed === 'mph' ? 'mi' : 'km')
export const toDist = (m) => (units.speed === 'mph' ? m / 1609.344 : m / 1000)

// Rampas: [posición 0..1, color]
// Rampas y colores con los del tema (se piden al usarlos: cambian si cambia el tema)
const SPEED = () => [[0, pal('line')], [0.2, pal('cyan')], [0.45, pal('green')], [0.7, pal('yellow')], [0.88, pal('orange')], [1, pal('pink')]]
const ABS = () => [[0, pal('line')], [0.25, pal('cyan')], [0.5, pal('green')], [0.72, pal('yellow')], [1, pal('red')]]
const DIVERGE = () => [[0, pal('red')], [0.35, pal('orange')], [0.5, pal('line')], [0.65, pal('cyan')], [1, pal('green')]]
const ALT = () => [[0, pal('cyan')], [0.5, pal('violet')], [1, pal('pink')]]

/**
 * get(A, i) → valor en unidades de pantalla. range(A) → [min, max] para colorear.
 * signed: la inclinación y la G lateral se muestran con IZQ/DER.
 */
export const CHANNELS = {
  v: { label: 'Velocidad', short: 'VEL', unit: speedUnit, get color() { return pal('cyan') }, dec: 0, get: (A, i) => toSpeed(A.v[i]), app: (A, i) => toSpeed(A.appV[i]), get ramp() { return SPEED() }, range: (A) => [0, Math.max(40, Math.ceil(toSpeed(A.stats.vMax) / 10) * 10)] },
  lean: { label: 'Inclinación', short: 'INCL', unit: () => '°', get color() { return pal('yellow') }, dec: 1, side: true, get: (A, i) => A.lean[i], app: (A, i) => A.appLean[i], get ramp() { return ABS() }, abs: true, range: () => [0, 50] },
  gLong: { label: 'G longitudinal', short: 'G LONG', unit: () => 'g', get color() { return pal('green') }, dec: 2, get: (A, i) => A.gLong[i], app: (A, i) => A.appGLong[i], get ramp() { return DIVERGE() }, range: () => [-0.8, 0.8], legend: ['FRENA', 'ACELERA'] },
  gLat: { label: 'G lateral', short: 'G LAT', unit: () => 'g', get color() { return pal('pink') }, dec: 2, side: true, get: (A, i) => A.gLat[i], app: (A, i) => A.appGLat[i], get ramp() { return ABS() }, abs: true, range: () => [0, 1] },
  alt: { label: 'Altitud', short: 'ALT', unit: () => 'm', get color() { return pal('violet') }, dec: 0, get: (A, i) => A.alt[i], get ramp() { return ALT() }, range: (A) => [A.stats.altMin, Math.max(A.stats.altMin + 5, A.stats.altMax)] },
  yaw: { label: 'Giro', short: 'GIRO', unit: () => '°/s', get color() { return pal('orange') }, dec: 1, side: true, get: (A, i) => A.yaw[i] },
  vib: { label: 'Vibración', short: 'VIB', unit: () => 'm/s²', get color() { return pal('dim') }, dec: 2, get: (A, i) => A.vib[i] },
  acc: { label: 'Precisión GPS', short: 'GPS ±', unit: () => 'm', get color() { return pal('red') }, dec: 1, get: (A, i) => A.acc[i] },
}

export const MAP_CHANNELS = ['v', 'lean', 'gLong', 'gLat', 'alt']
export const CHART_CHANNELS = ['v', 'lean', 'gLong', 'gLat', 'alt', 'yaw', 'vib', 'acc']

const hex = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16))
/** Color de la rampa en u (0..1). */
export function rampColor(ramp, u) {
  u = Math.max(0, Math.min(1, u))
  let k = 0
  while (k < ramp.length - 2 && ramp[k + 1][0] < u) k++
  const [p0, c0] = ramp[k]
  const [p1, c1] = ramp[k + 1]
  const f = p1 > p0 ? (u - p0) / (p1 - p0) : 0
  const a = hex(c0)
  const b = hex(c1)
  return '#' + a.map((x, j) => Math.round(x + (b[j] - x) * f).toString(16).padStart(2, '0')).join('')
}

export const gradientCss = (ramp) => `linear-gradient(90deg, ${ramp.map(([p, c]) => `${c} ${p * 100}%`).join(', ')})`

/** Valor con su unidad; con lado (IZQ/DER) si el canal lo tiene. */
export function fmt(id, val) {
  const c = CHANNELS[id]
  if (val == null || !Number.isFinite(val)) return '—'
  if (Math.abs(val) < 0.5 * 10 ** -c.dec) val = 0 // sin «-0.00»
  if (c.side) {
    const side = Math.abs(val) < 0.5 * 10 ** -c.dec ? '' : val < 0 ? ' IZQ' : ' DER'
    return `${Math.abs(val).toFixed(c.dec)} ${c.unit()}${side}`
  }
  return `${val.toFixed(c.dec)} ${c.unit()}`
}

export function fmtDur(s) {
  if (!Number.isFinite(s)) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

export function fmtElapsed(s) {
  const neg = s < 0
  s = Math.abs(s)
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return `${neg ? '-' : ''}${m}:${r.toFixed(1).padStart(4, '0')}`
}

export function fmtDateTime(ms) {
  const d = new Date(ms)
  const p = (x) => String(x).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export const fmtClock = (ms) => {
  const d = new Date(ms)
  const p = (x) => String(x).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
