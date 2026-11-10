// Vídeo con los datos encima: reproduce el trozo elegido del vídeo, pinta en cada fotograma la velocidad,
// la inclinación, la G y un mapa pequeño con dónde vas, y lo graba (con su sonido) en un MP4 o, si el
// navegador no sabe, en WebM. Va a tiempo real: un trozo de 2 minutos tarda 2 minutos, y la ventana
// tiene que estar a la vista (si no, el navegador para el vídeo).
import { DT } from './process.js'

const PIXEL = '"Press Start 2P", monospace'
const TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
export const recorderType = () => (typeof MediaRecorder === 'undefined' ? null : TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || null)
export const canExport = () => !!recorderType() && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype

/**
 * @param {object} o
 * @param {string} o.url   el vídeo (object URL)
 * @param {number} o.off   desfase: tiempo de la salida = tiempo del vídeo + off
 * @param {object} o.A     análisis de la salida
 * @param {number} o.t0    desde (s de la salida)
 * @param {number} o.t1    hasta
 * @param {object} o.colors  { ink, cyan, pink, yellow, green, red, dim }
 * @param {(s: number) => number} o.speed  m/s → unidad elegida
 * @param {string} o.unit
 * @param {(f: number) => void} [o.onProgress]
 * @param {AbortSignal} [o.signal]
 * @returns {Promise<{ blob: Blob, type: string }>}
 */
export async function renderOverlay({ url, off, A, t0, t1, colors, speed, unit, onProgress, signal }) {
  const type = recorderType()
  if (!type) throw new Error('Este navegador no sabe grabar vídeo (prueba en Chrome, Edge, Safari o la app de Windows)')
  // El sonido: el vídeo pasa por Web Audio a la grabación (y no por los altavoces)
  const AC = window.AudioContext || window.webkitAudioContext
  const ac = AC ? new AC() : null
  const v = document.createElement('video')
  v.src = url
  v.playsInline = true
  v.preload = 'auto'
  await new Promise((res, rej) => {
    v.onloadedmetadata = res
    v.onerror = () => rej(new Error('No se pudo abrir el vídeo'))
  })
  try {
    await document.fonts?.load?.(`40px ${PIXEL}`)
  } catch {}
  const k = Math.min(1, 1920 / v.videoWidth, 1920 / v.videoHeight)
  const W = Math.round((v.videoWidth * k) / 2) * 2
  const H = Math.round((v.videoHeight * k) / 2) * 2
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')
  const tracks = [...canvas.captureStream(30).getVideoTracks()]
  if (ac) {
    try {
      const src = ac.createMediaElementSource(v)
      const dest = ac.createMediaStreamDestination()
      src.connect(dest)
      tracks.push(...dest.stream.getAudioTracks())
      await ac.resume()
    } catch {
      /* sin sonido */
    }
  }
  const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: type, videoBitsPerSecond: 12e6, audioBitsPerSecond: 160e3 })
  const chunks = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const stopped = new Promise((r) => (rec.onstop = r))

  const vt0 = Math.max(0, t0 - off)
  const vt1 = Math.min(v.duration, t1 - off)
  if (!(vt1 > vt0 + 0.5)) throw new Error('Ese trozo no está en el vídeo')
  v.currentTime = vt0
  await new Promise((r) => (v.onseeked = r))
  const map = mapOf(A, t0, t1)
  const draw = () => {
    g.drawImage(v, 0, 0, W, H)
    paint(g, W, H, A, v.currentTime + off, map, colors, speed, unit)
  }
  draw()
  rec.start(1000)
  await v.play()
  await new Promise((resolve) => {
    let done = false
    let shown = -1
    let pending = false
    const step = (fromFrame = false) => {
      if (fromFrame) pending = false
      if (done) return
      // Cada fotograma nuevo una vez (llega por requestVideoFrameCallback o, si el navegador no lo da, por el reloj)
      if (v.currentTime !== shown) {
        shown = v.currentTime
        draw()
        onProgress?.(Math.min(1, (v.currentTime - vt0) / (vt1 - vt0)))
      }
      if (v.currentTime >= vt1 || v.ended || signal?.aborted) {
        done = true
        clearInterval(clock)
        return resolve()
      }
      if (v.requestVideoFrameCallback && !pending) {
        pending = true
        v.requestVideoFrameCallback(() => step(true))
      }
    }
    const clock = setInterval(() => step(), 1000 / 30)
    step()
  })
  v.pause()
  rec.stop()
  await stopped
  ac?.close()
  v.removeAttribute('src')
  v.load()
  if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError')
  return { blob: new Blob(chunks, { type: type.split(';')[0] }), type }
}

/** El recorrido del trozo, ya en coordenadas 0-1 para el mapa pequeño. */
function mapOf(A, t0, t1) {
  const i0 = Math.max(0, Math.round((t0 - A.T0) / DT) - 50)
  const i1 = Math.min(A.n - 1, Math.round((t1 - A.T0) / DT) + 50)
  const pts = []
  for (let i = i0; i <= i1; i += 3) if (A.valid[i]) pts.push([A.lon[i] * Math.cos((A.lat[i] * Math.PI) / 180), -A.lat[i], i])
  if (pts.length < 2) return null
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const s = 1 / Math.max(x1 - x0, y1 - y0, 1e-9)
  const cx = (1 - (x1 - x0) * s) / 2
  const cy = (1 - (y1 - y0) * s) / 2
  return { pts: pts.map(([x, y, i]) => [cx + (x - x0) * s, cy + (y - y0) * s, i]), pos: (i) => (A.valid[i] ? [cx + (A.lon[i] * Math.cos((A.lat[i] * Math.PI) / 180) - x0) * s, cy + (-A.lat[i] - y0) * s] : null) }
}

/** Los datos de ese instante encima del fotograma. */
export function paint(g, W, H, A, t, map, C, speed, unit) {
  const u = H / 1080
  const i = Math.round((t - A.T0) / DT)
  if (i < 0 || i >= A.n || !A.valid[i]) return
  const v = A.v[i]
  const lean = A.lean[i]
  const gl = A.gLong[i]
  const ga = A.gLat[i]
  const box = (x, y, w, h) => {
    g.fillStyle = 'rgba(0,0,0,0.55)'
    g.fillRect(x, y, w, h)
  }
  g.textBaseline = 'alphabetic'
  // Velocidad (abajo a la izquierda)
  box(40 * u, H - 210 * u, 330 * u, 170 * u)
  g.fillStyle = C.cyan
  g.font = `${96 * u}px ${PIXEL}`
  g.fillText(String(Math.round(speed(v))), 64 * u, H - 90 * u)
  g.fillStyle = C.ink
  g.font = `${22 * u}px ${PIXEL}`
  g.fillText(unit.toUpperCase(), 66 * u, H - 56 * u)
  // Inclinación (abajo en el centro): arco con la moto
  const cx = W / 2
  const cy = H - 70 * u
  const R = 150 * u
  box(cx - R - 30 * u, cy - R - 40 * u, 2 * R + 60 * u, R + 70 * u)
  g.lineWidth = 14 * u
  g.strokeStyle = 'rgba(255,255,255,0.18)'
  g.beginPath()
  g.arc(cx, cy, R, Math.PI * 1.17, Math.PI * 1.83)
  g.stroke()
  const a = Math.max(-60, Math.min(60, Number.isFinite(lean) ? lean : 0))
  g.strokeStyle = Math.abs(a) < 20 ? C.green : Math.abs(a) < 40 ? C.yellow : C.red
  g.beginPath()
  const mid = Math.PI * 1.5
  const to = mid + (a / 60) * (Math.PI * 0.33)
  g.arc(cx, cy, R, Math.min(mid, to), Math.max(mid, to))
  g.stroke()
  g.save()
  g.translate(cx, cy)
  g.rotate((a * Math.PI) / 180)
  g.fillStyle = C.ink
  g.fillRect(-10 * u, -R * 0.78, 20 * u, R * 0.62)
  g.restore()
  g.fillStyle = C.ink
  g.font = `${34 * u}px ${PIXEL}`
  g.textAlign = 'center'
  g.fillText(`${Math.abs(Math.round(a))}°${a < -1 ? ' I' : a > 1 ? ' D' : ''}`, cx, cy - 4 * u)
  g.textAlign = 'left'
  // Círculo G (abajo a la derecha): el punto va hacia donde empuja la moto
  const gx = W - 170 * u
  const gy = H - 150 * u
  const gr = 100 * u
  box(gx - gr - 20 * u, gy - gr - 20 * u, 2 * gr + 40 * u, 2 * gr + 40 * u)
  g.strokeStyle = 'rgba(255,255,255,0.35)'
  g.lineWidth = 2 * u
  for (const q of [0.5, 1]) (g.beginPath(), g.arc(gx, gy, gr * q, 0, Math.PI * 2), g.stroke())
  const px = Math.max(-1.2, Math.min(1.2, Number.isFinite(ga) ? ga : 0))
  const py = Math.max(-1.2, Math.min(1.2, Number.isFinite(gl) ? gl : 0))
  g.fillStyle = C.pink
  g.beginPath()
  g.arc(gx + px * gr, gy - py * gr, 14 * u, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = C.ink
  g.font = `${18 * u}px ${PIXEL}`
  g.textAlign = 'center'
  g.fillText(`${Math.hypot(px, py).toFixed(2)} G`, gx, gy + gr + 8 * u)
  g.textAlign = 'left'
  // Mapa pequeño (arriba a la derecha)
  if (map) {
    const m = 260 * u
    const mx = W - m - 40 * u
    const my = 40 * u
    box(mx - 14 * u, my - 14 * u, m + 28 * u, m + 28 * u)
    g.strokeStyle = C.cyan
    g.lineWidth = 4 * u
    g.lineJoin = 'round'
    g.beginPath()
    map.pts.forEach(([x, y], k) => (k ? g.lineTo(mx + x * m, my + y * m) : g.moveTo(mx + x * m, my + y * m)))
    g.stroke()
    const p = map.pos(i)
    if (p) {
      g.fillStyle = C.yellow
      g.beginPath()
      g.arc(mx + p[0] * m, my + p[1] * m, 10 * u, 0, Math.PI * 2)
      g.fill()
    }
  }
  // Marca
  g.font = `${20 * u}px ${PIXEL}`
  g.fillStyle = C.pink
  g.fillText('STREET', 40 * u, 60 * u)
  g.fillStyle = C.cyan
  g.fillText('CHAOS', 40 * u + g.measureText('STREET ').width, 60 * u)
}
