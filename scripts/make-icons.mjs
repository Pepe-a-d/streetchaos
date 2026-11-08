// Genera los iconos PNG de la app en pixel art (32×32 escalado sin suavizar).
// Uso: npm run icons
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const N = 32
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255]
const C = {
  bg: hex('#0a0618'), bg2: hex('#1a0b3a'), pink: hex('#ff2e88'), orange: hex('#ff8a1f'),
  yellow: hex('#ffd23f'), cyan: hex('#22e3ff'), grid: hex('#7b2cbf'), white: hex('#f4f1ff'), black: hex('#000000'),
}

const px = Array.from({ length: N * N }, () => C.bg)
const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < N && y < N) px[y * N + x] = c }

// Cielo con degradado escalonado
for (let y = 0; y < 18; y++) for (let x = 0; x < N; x++) set(x, y, y < 9 ? C.bg : C.bg2)

// Sol de franjas
const cx = 15.5, cy = 15, r = 9
for (let y = 4; y <= 18; y++) {
  for (let x = 0; x < N; x++) {
    const d = Math.hypot(x - cx, y - cy)
    if (d > r) continue
    if (y >= 11 && y % 2 === 0) continue // cortes horizontales
    set(x, y, y < 8 ? C.yellow : y < 12 ? C.orange : C.pink)
  }
}

// Horizonte y suelo con rejilla en perspectiva
for (let x = 0; x < N; x++) set(x, 18, C.cyan)
for (let y = 19; y < N; y++) for (let x = 0; x < N; x++) set(x, y, C.black)
for (const y of [20, 22, 25, 29]) for (let x = 0; x < N; x++) set(x, y, C.grid)
for (let k = -6; k <= 6; k++) {
  for (let y = 19; y < N; y++) {
    const t = (y - 18) / (N - 18)
    set(Math.round(cx + k * 2.6 * t * 4), y, C.grid)
  }
}

// Carretera central con línea discontinua
for (let y = 19; y < N; y++) {
  const t = (y - 18) / (N - 18)
  const half = Math.round(1 + t * 9)
  for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) set(x, y, C.bg2)
  set(Math.round(cx - half), y, C.white)
  set(Math.round(cx + half), y, C.white)
  if (y % 3 !== 0) set(Math.round(cx), y, C.yellow)
}

// Bandera a cuadros arriba a la izquierda
for (let y = 2; y < 8; y++) for (let x = 2; x < 9; x++) set(x, y, (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? C.white : C.black)
for (let y = 2; y < 13; y++) set(1, y, C.white)

function png(size) {
  const scale = size / N
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const c = px[Math.floor(y / scale) * N + Math.floor(x / scale)]
      raw.set(c, y * (size * 4 + 1) + 1 + x * 4)
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

mkdirSync('public/icons', { recursive: true })
for (const s of [192, 512]) writeFileSync(`public/icons/icon-${s}.png`, png(s))
writeFileSync('public/icons/apple-touch-icon.png', png(192))
writeFileSync('public/favicon.png', png(64))
console.log('Iconos generados en public/icons')
