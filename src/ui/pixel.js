// Pixel art hecho a mano: iconos de la barra y la moto de los duelos.

/** Convierte un dibujo en texto a SVG de rectángulos nítidos. */
export function pixelSvg(rows, palette, { className = '', title = '' } = {}) {
  const h = rows.length
  const w = rows[0].length
  let rects = ''
  rows.forEach((row, y) => {
    let x = 0
    while (x < w) {
      const c = row[x]
      if (c === '.' || !palette[c]) {
        x++
        continue
      }
      let run = 1
      while (x + run < w && row[x + run] === c) run++
      rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${palette[c]}"/>`
      x += run
    }
  })
  return `<svg class="${className}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="${title ? 'false' : 'true'}">${title ? `<title>${title}</title>` : ''}${rects}</svg>`
}

const I = { X: 'currentColor' }

export const ICONS = {
  dash: pixelSvg(
    [
      '...XXXXXX...',
      '.XX......XX.',
      'X..X......X.',
      'X...X.....XX',
      'X....X....XX',
      'X.....XX..XX',
      'X.....XX...X',
      'X..........X',
      '.X........X.',
      '..XXXXXXXX..',
    ],
    I,
  ),
  crono: pixelSvg(
    [
      '....XXXX....',
      '.....XX.....',
      '..XXXXXXXX..',
      '.X....X...X.',
      'X.....X....X',
      'X.....X....X',
      'X.....XXX..X',
      'X..........X',
      '.X........X.',
      '..XXXXXXXX..',
    ],
    I,
  ),
  vs: pixelSvg(
    [
      'X.X.X.......',
      '.X.X.X......',
      'X.X.X.......',
      '.X.X.X..XXX.',
      'X.......X.X.',
      'X.......XXX.',
      'X......X.X.X',
      'X.......X.X.',
      'X......X.X.X',
      'X.......X.X.',
    ],
    I,
  ),
  garage: pixelSvg(
    [
      '.....XX.....',
      '...XX..XX...',
      '.XX......XX.',
      'X..........X',
      'XXXXXXXXXXXX',
      'X.X......X.X',
      'X.X.XXXX.X.X',
      'X.X.X..X.X.X',
      'X.X.XXXX.X.X',
      'X.X......X.X',
    ],
    I,
  ),
  gear: pixelSvg(
    [
      '....XX....',
      '.X.XXXX.X.',
      '..XXXXXX..',
      '.XXX..XXX.',
      'XXX....XXX',
      'XXX....XXX',
      '.XXX..XXX.',
      '..XXXXXX..',
      '.X.XXXX.X.',
      '....XX....',
    ],
    I,
  ),
}

// Moto deportiva de perfil (mira a la derecha). B = color del piloto.
const BIKE_ROWS = [
  '.................HHHH...........',
  '...............HHHHVVV..........',
  '...........SSSSHHHHVVV..........',
  '.........SSSSSSSSHHHH...........',
  '........SSSSSSSSSAA..VVV........',
  '.......TBSSSSDBBBBAAVVVV........',
  '......TBBBSSSSBBBBBBAABBB.......',
  '.....BBBBBBBSSSBBBBBBBBBBW......',
  '.......BBBBDDSSGGGGBBBBBBB......',
  '...KKKKK...SS.GGGGGBBBBB.KKKKK..',
  '..K.....K.....GGGGG..MKK.....K..',
  '.K..MMM..K...EEEEE...MK..MMM..K.',
  '.K.M...M.MMMMM......MK..M...M.K.',
  '.K.M.G.M.K.........MK...M.G.M.K.',
  '.K.M...M.K..........K...M...M.K.',
  '.K..MMM..K.............K.MMM..K.',
  '..K.....K...............K.....K.',
  '...KKKKK.................KKKKK..',
]

export const BIKE_W = BIKE_ROWS[0].length
export const BIKE_H = BIKE_ROWS.length

export function bikePalette(color) {
  return { H: '#f4f1ff', V: '#22e3ff', S: '#2a2050', A: '#3a2c70', B: color, T: '#ff3b3b', G: '#8a86a8', K: '#d8d2f4', M: '#6a6290', W: '#ffd23f', D: '#120c26', E: '#b0aacc' }
}

export const bikeSvg = (color, cls = 'sprite') => pixelSvg(BIKE_ROWS, bikePalette(color), { className: cls })

/** Dibuja la moto en un canvas (para la pista del duelo). */
export function drawBike(ctx, x, y, scale, color, wheelPhase = 0) {
  const pal = bikePalette(color)
  BIKE_ROWS.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      let c = row[rx]
      if (c === '.' || !pal[c]) continue
      // Llantas que giran: alterna los tramos de arriba/abajo y los laterales
      const inWheel = ry >= 11 && ry <= 15 && (rx <= 8 || rx >= 24)
      if (inWheel && c === 'M' && wheelPhase % 2) c = ry === 11 || ry === 15 ? 'G' : 'D'
      ctx.fillStyle = pal[c]
      ctx.fillRect(Math.round(x + rx * scale), Math.round(y + ry * scale), Math.ceil(scale), Math.ceil(scale))
    }
  })
}
