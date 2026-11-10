// Tarjeta para compartir una salida: una imagen de 1080×1920 (historia de Instagram) con el recorrido
// en neón, las cifras grandes y lo mejor del día, con los colores de tu tema. La usan la app (al
// terminar una salida) y el Blackbox (en cada salida). Sin mapa de fondo: solo la forma del recorrido.

const W = 1080
const H = 1920
const PIXEL = '"Press Start 2P", monospace'

/**
 * @param {object} d
 * @param {number[][]} d.track   puntos [lat, lon] del recorrido
 * @param {string} d.title       «MAÑANA DEL 10 NOV» o similar
 * @param {[string, string][]} d.stats   hasta 6 [etiqueta, valor]
 * @param {string[]} [d.highlights]  hasta 3 frases
 * @param {string} [d.who]       piloto · moto
 * @param {object} colors        { bg, ink, dim, pink, cyan, yellow, green }
 * @returns {HTMLCanvasElement}
 */
export async function drawCard(d, colors) {
  try {
    await document.fonts?.load?.(`40px ${PIXEL}`)
  } catch {}
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  const C = { bg: '#0a0618', ink: '#efeaff', dim: '#8a80c4', pink: '#ff2e88', cyan: '#22e3ff', yellow: '#ffd23f', green: '#3dff7a', ...colors }
  // Fondo con rejilla de recreativa
  g.fillStyle = C.bg
  g.fillRect(0, 0, W, H)
  g.strokeStyle = C.dim
  g.globalAlpha = 0.08
  g.lineWidth = 2
  for (let x = 0; x <= W; x += 60) (g.beginPath(), g.moveTo(x, 0), g.lineTo(x, H), g.stroke())
  for (let y = 0; y <= H; y += 60) (g.beginPath(), g.moveTo(0, y), g.lineTo(W, y), g.stroke())
  g.globalAlpha = 1
  // Cabecera
  g.textBaseline = 'top'
  g.font = `56px ${PIXEL}`
  g.fillStyle = C.pink
  g.fillText('STREET', 80, 90)
  g.fillStyle = C.cyan
  g.fillText('CHAOS', 80 + g.measureText('STREET ').width, 90)
  g.font = `26px ${PIXEL}`
  g.fillStyle = C.yellow
  g.fillText(clean(d.title || ''), 80, 180)

  // Recorrido
  const box = { x: 90, y: 250, w: W - 180, h: 700 }
  drawTrack(g, d.track || [], box, C)

  // Cifras
  const stats = (d.stats || []).slice(0, 6)
  const col = 2
  const cw = (W - 160) / col
  stats.forEach(([label, value], k) => {
    const x = 80 + (k % col) * cw
    const y = 1010 + Math.floor(k / col) * 150
    g.font = `22px ${PIXEL}`
    g.fillStyle = C.dim
    g.fillText(clean(label), x, y)
    g.font = `${fit(g, clean(value), cw - 30, 58)}px ${PIXEL}`
    g.fillStyle = k === 0 ? C.cyan : C.ink
    g.fillText(clean(value), x, y + 42)
  })

  // Lo mejor del día
  let y = 1010 + Math.ceil(stats.length / col) * 150 + 20
  for (const h of (d.highlights || []).slice(0, 3)) {
    if (y > H - 200) break
    g.fillStyle = C.yellow
    g.fillRect(80, y + 6, 14, 14)
    g.font = `22px ${PIXEL}`
    g.fillStyle = C.ink
    y = wrap(g, clean(h), 116, y, W - 200, 36) + 18
  }
  // Pie
  g.font = `20px ${PIXEL}`
  g.fillStyle = C.dim
  if (d.who) g.fillText(clean(d.who), 80, H - 110)
  g.fillStyle = C.pink
  g.fillText('PEPE-A-D.GITHUB.IO/STREETCHAOS', 80, H - 70)
  return c
}

/** La letra de recreativa no tiene tildes ni eñes en mayúscula: se quitan. */
const clean = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[→]/g, '>').toUpperCase()

/** Tamaño de letra para que quepa en el ancho (como mucho `max`). */
function fit(g, text, width, max) {
  let size = max
  for (; size > 18; size -= 2) {
    g.font = `${size}px ${PIXEL}`
    if (g.measureText(text).width <= width) break
  }
  return size
}

/** Texto en varias líneas; devuelve la y de debajo. */
function wrap(g, text, x, y, width, lh) {
  let line = ''
  for (const w of text.split(' ')) {
    const t = line ? `${line} ${w}` : w
    if (g.measureText(t).width > width && line) {
      g.fillText(line, x, y)
      y += lh
      line = w
    } else line = t
  }
  if (line) (g.fillText(line, x, y), (y += lh))
  return y
}

function drawTrack(g, pts, box, C) {
  const P = pts.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (P.length < 2) return
  const lat0 = P[0][0]
  const kx = Math.cos((lat0 * Math.PI) / 180)
  const xs = P.map((p) => p[1] * kx)
  const ys = P.map((p) => -p[0])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const s = Math.min(box.w / Math.max(1e-9, x1 - x0), box.h / Math.max(1e-9, y1 - y0))
  const ox = box.x + (box.w - (x1 - x0) * s) / 2
  const oy = box.y + (box.h - (y1 - y0) * s) / 2
  const X = (i) => ox + (xs[i] - x0) * s
  const Y = (i) => oy + (ys[i] - y0) * s
  const path = () => {
    g.beginPath()
    g.moveTo(X(0), Y(0))
    for (let i = 1; i < P.length; i++) g.lineTo(X(i), Y(i))
  }
  g.lineJoin = 'round'
  g.lineCap = 'round'
  // Brillo de neón: varias pasadas cada vez más finas
  for (const [w, a] of [
    [34, 0.08],
    [20, 0.16],
    [10, 0.5],
  ]) {
    path()
    g.strokeStyle = C.cyan
    g.globalAlpha = a
    g.lineWidth = w
    g.stroke()
  }
  g.globalAlpha = 1
  path()
  g.strokeStyle = C.ink
  g.lineWidth = 4
  g.stroke()
  const dot = (i, col) => {
    g.fillStyle = col
    g.beginPath()
    g.arc(X(i), Y(i), 16, 0, Math.PI * 2)
    g.fill()
  }
  dot(0, C.green)
  dot(P.length - 1, C.pink)
}

/** Comparte la imagen (menú del móvil: Instagram, WhatsApp…) o, si no se puede, la descarga. */
export async function shareCanvas(canvas, name = 'salida.png') {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
  const file = new File([blob], name, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Mi salida en moto' })
      return 'shared'
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled'
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
  return 'downloaded'
}
