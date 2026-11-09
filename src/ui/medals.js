// Medallas pixel de los logros: cinta arriba y moneda con el dibujo de su categoría, en bronce, plata u
// oro (gris si aún no la tienes). Se generan en código, píxel a píxel, como el resto del pixel art.
import { pixelSvg } from './pixel.js'

// Dibujos de 7x7 de cada categoría
const GLYPHS = {
  km: ['...X...', '..X.X..', '..X.X..', '.X...X.', '.X.X.X.', 'X.....X', 'X..X..X'],
  time: ['..XXX..', '.X.X.X.', 'X..X..X', 'X..XX.X', 'X.....X', '.X...X.', '..XXX..'],
  night: ['..XXX..', '.XX....', 'XX.....', 'XX.....', 'XX.....', '.XX....', '..XXX..'],
  speed: ['....XX.', '...XX..', '..XX...', '.XXXXX.', '...XX..', '..XX...', '.XX....'],
  lean: ['X......', 'XX.....', 'X.X....', 'X..X...', 'X...X..', 'X....X.', 'XXXXXXX'],
  g: ['..XXX..', '.X...X.', 'X..X..X', 'X.XXX.X', 'X..X..X', '.X...X.', '..XXX..'],
  crono: ['..XXX..', '...X...', '.XXXXX.', 'X..X..X', 'X..XX.X', 'X.....X', '.XXXXX.'],
  duel: ['X.X.X..', 'XX.X.X.', 'X.X.X..', 'XX.X.X.', 'X......', 'X......', 'X......'],
  box: ['XXXXXXX', 'X.....X', 'X.XXX.X', 'X.XXX.X', 'X.XXX.X', 'X.....X', 'XXXXXXX'],
  star: ['...X...', '...X...', 'XXXXXXX', '.XXXXX.', '..XXX..', '.XX.XX.', '.X...X.'],
}

const PALETTES = {
  b: { R: '#ff2e88', B: '#22e3ff', O: '#6e3a12', M: '#cd7f32', L: '#e8a25e', G: '#2a1408' },
  s: { R: '#ff2e88', B: '#22e3ff', O: '#5f6672', M: '#c9d0da', L: '#f1f4f8', G: '#1e2430' },
  g: { R: '#ff2e88', B: '#22e3ff', O: '#8a5c00', M: '#ffcc33', L: '#fff0a0', G: '#3a2400' },
  off: { R: '#2e2460', B: '#2e2460', O: '#1a1236', M: '#2a2050', L: '#332a60', G: '#4a3f86' },
}

const W = 16
const H = 18
const cache = new Map()

/** SVG de la medalla. cat: km | time | night | speed | lean | g | crono | duel | box | star */
export function medalSvg(cat, tier, locked = false, cls = 'medal') {
  const key = `${cat}|${tier}|${locked}|${cls}`
  if (cache.has(key)) return cache.get(key)
  const rows = Array.from({ length: H }, () => new Array(W).fill('.'))
  // Cinta en V
  for (let y = 0; y < 5; y++) {
    for (let x = 2 + y; x < 5 + y; x++) rows[y][x] = 'R'
    for (let x = 11 - y; x < 14 - y; x++) rows[y][x] = 'B'
  }
  // Moneda: borde oscuro, cara, brillo arriba a la izquierda
  const cx = 8
  const cy = 11
  for (let y = 4; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      if (d <= 6.6) rows[y][x] = d > 5.6 ? 'O' : d > 4.9 && x + y < cx + cy - 2 ? 'L' : 'M'
    }
  const g = GLYPHS[cat] || GLYPHS.star
  g.forEach((r, y) => [...r].forEach((c, x) => c === 'X' && (rows[cy - 3 + y][cx - 4 + x] = 'G')))
  const svg = pixelSvg(
    rows.map((r) => r.join('')),
    PALETTES[locked ? 'off' : tier],
    { className: cls },
  )
  cache.set(key, svg)
  return svg
}
