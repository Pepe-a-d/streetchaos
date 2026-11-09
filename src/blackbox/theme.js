// Tema y perfil del piloto en el Blackbox: los colores de la app del móvil vinculado (los mismos temas
// de src/ui/themes.js). El perfil se guarda en este navegador para pintar con su tema desde el primer
// momento, antes de que conteste la nube.
import { themeOf } from '../ui/themes.js'
import { resetPalette } from './palette.js'

const LS = 'sc-bb-profile'

export function savedProfile() {
  try {
    return JSON.parse(localStorage.getItem(LS) || 'null')
  } catch {
    return null
  }
}
export function saveProfile(p) {
  try {
    if (p) localStorage.setItem(LS, JSON.stringify(p))
    else localStorage.removeItem(LS)
  } catch {}
}

/** Pinta el Blackbox con el tema del perfil (o el de siempre si no hay). Devuelve si ha cambiado. */
export function applyProfileTheme(p) {
  const t = themeOf(p?.theme)
  const v = { ...t.vars }
  if (p?.accentBike && /^#[0-9a-f]{6}$/i.test(p.color || '')) v.pink = p.color
  const vars = {
    ...v,
    line2: v.line,
    // La rejilla de las gráficas, un poco por debajo de las líneas
    grid: v.dash || v.sep,
    onbright: t.light ? '#ffffff' : '#000000',
  }
  const root = document.documentElement
  const before = root.dataset.theme + (root.dataset.accent || '')
  for (const [k, val] of Object.entries(vars)) root.style.setProperty(`--${k}`, val)
  root.style.colorScheme = t.light ? 'light' : 'dark'
  root.dataset.theme = t.id
  root.dataset.light = t.light ? '1' : ''
  root.dataset.accent = vars.pink
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars.bg)
  resetPalette()
  return before !== t.id + vars.pink
}
