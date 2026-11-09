// Colores del Blackbox: los del tema de la app del móvil vinculado (ver theme.js). Lo que se dibuja en
// canvas o en el mapa no puede usar variables CSS, así que se leen aquí (y se vuelven a leer al cambiar
// de tema: resetPalette).

// Los del tema SYNTHWAVE, por si no hay documento (tests) o falta alguno
const FALLBACK = {
  bg: '#0a0618', bg2: '#140a30', panel: '#110a28', panel2: '#1a1040', line: '#3a2a7a', line2: '#3a2a7a', ink: '#efeaff', dim: '#8a80c4', faint: '#4a3f86',
  cyan: '#22e3ff', pink: '#ff2e88', yellow: '#ffd23f', orange: '#ff8a1f', green: '#3dff7a', red: '#ff3b3b', violet: '#9d8cff',
  grid: '#241a4d', bar: '#070412', deep: '#05020f', sep: '#1a1236',
}
const cache = {}

/** Color (#rrggbb) de una variable del tema. */
export function pal(name) {
  if (cache[name]) return cache[name]
  let v = ''
  try {
    if (typeof document !== 'undefined') v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
  } catch {}
  return (cache[name] = /^#[0-9a-f]{6}$/i.test(v) ? v : FALLBACK[name] || '#888888')
}
export const resetPalette = () => Object.keys(cache).forEach((k) => delete cache[k])
export const isLight = () => typeof document !== 'undefined' && document.documentElement.dataset.light === '1'
/** El color del texto sobre el que va encima (blanco en temas oscuros, negro en claros). */
export const contrast = () => (isLight() ? '#000000' : '#ffffff')
export const halo = () => (isLight() ? '#ffffff' : '#000000')
