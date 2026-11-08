// DASH: velocímetro grande, barra de velocidad, datos del viaje, inclinación y fuerza G.
import { T } from '../core/telemetry.js'
import { totals, settings } from '../core/store.js'
import { compassPoint } from '../core/geo.js'
import { $, setter, segPad, toSpeed, speedUnit, toDist, fmtClock } from './util.js'
import { pixelSvg } from './pixel.js'

const SEGS = 40
const LEAN_SEGS = 25
const LEAN_MAX = 60

// Moto vista desde detrás para el inclinómetro
const REAR = pixelSvg(
  ['...HHH...', '..HHHHH..', '..HVVVH..', '...HHH...', '.SSSSSSS.', 'SSSBBBSSS', 'S.BBBBB.S', '..BBBBB..', '...BKB...', '...KKK...', '...KKK...', '...KKK...'],
  { H: '#f4f1ff', V: '#22e3ff', S: '#8a80c4', B: '#ff2e88', K: '#e8e6ff' },
)

function leanDial() {
  const cx = 100
  const cy = 112
  let segs = ''
  for (let i = 0; i < LEAN_SEGS; i++) {
    const a0 = -LEAN_MAX + (i * 2 * LEAN_MAX) / LEAN_SEGS + 0.8
    const a1 = -LEAN_MAX + ((i + 1) * 2 * LEAN_MAX) / LEAN_SEGS - 0.8
    const p = (a, r) => {
      const rad = ((a - 90) * Math.PI) / 180
      return `${(cx + r * Math.cos(rad)).toFixed(1)},${(cy + r * Math.sin(rad)).toFixed(1)}`
    }
    segs += `<polygon data-i="${i}" points="${p(a0, 78)} ${p(a1, 78)} ${p(a1, 98)} ${p(a0, 98)}" fill="#1e1542"/>`
  }
  return `<svg class="dial" viewBox="0 0 200 124" preserveAspectRatio="xMidYMid meet">
    ${segs}
    <g data-k="rear" transform="rotate(0 ${cx} ${cy - 2})">
      <g transform="translate(${cx - 18} ${cy - 50}) scale(4)">${REAR.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>
    </g>
    <text data-k="leanTxt" x="${cx}" y="${cy - 54}" text-anchor="middle" font-family="DSEG7" font-style="italic" font-size="22" fill="#ffd23f">0</text>
  </svg>`
}

function gDial() {
  return `<svg class="dial" viewBox="0 0 120 120" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges">
    <rect x="4" y="4" width="112" height="112" fill="none" stroke="#2a1f5c" stroke-width="2"/>
    <circle cx="60" cy="60" r="48" fill="none" stroke="#3a2a7a" stroke-width="2" stroke-dasharray="4 4" shape-rendering="auto"/>
    <circle cx="60" cy="60" r="24" fill="none" stroke="#3a2a7a" stroke-width="2" stroke-dasharray="4 4" shape-rendering="auto"/>
    <line x1="60" y1="6" x2="60" y2="114" stroke="#2a1f5c" stroke-width="2"/>
    <line x1="6" y1="60" x2="114" y2="60" stroke="#2a1f5c" stroke-width="2"/>
    <text x="60" y="16" text-anchor="middle" font-family="'Press Start 2P'" font-size="6" fill="#4a3f86">ACEL</text>
    <text x="60" y="112" text-anchor="middle" font-family="'Press Start 2P'" font-size="6" fill="#4a3f86">FRENO</text>
    <g data-k="trail"></g>
    <rect data-k="dot" x="54" y="54" width="12" height="12" fill="#22e3ff" stroke="#000" stroke-width="2"/>
  </svg>`
}

export function mountDash(el) {
  el.innerHTML = `
    <div class="panel speedbox">
      <div class="max"><span class="lbl">Punta</span><b data-k="max">0</b></div>
      <div class="gear"><span class="lbl">G long</span><b data-k="glong">0.00</b></div>
      <div class="readout">
        <span class="seg num" data-ghost="888" data-k="speed">!!0</span>
        <span class="unit" data-k="unit">KM/H</span>
      </div>
      <div>
        <div class="speedbar">${Array.from({ length: SEGS }, (_, i) => `<i style="--c:${i < 24 ? '#3dff7a' : i < 32 ? '#ffd23f' : '#ff3b3b'}"></i>`).join('')}</div>
        <div class="scale" data-k="scale"></div>
      </div>
    </div>
    <div class="stats">
      <div class="panel stat"><span class="lbl">Viaje</span><b data-k="trip">0.0</b></div>
      <div class="panel stat"><span class="lbl">Tiempo</span><b data-k="time">0:00</b></div>
      <div class="panel stat"><span class="lbl">Media</span><b data-k="avg">0</b></div>
      <div class="panel stat"><span class="lbl">Altitud</span><b data-k="alt">---</b></div>
      <div class="panel stat"><span class="lbl">Rumbo</span><b data-k="hdg">---</b></div>
      <div class="panel stat"><span class="lbl">Total</span><b data-k="odo">0</b></div>
    </div>
    <div class="gauges">
      <div class="panel gauge">
        <span class="lbl">Inclinacion</span>
        ${leanDial()}
        <div class="foot"><span>IZQ <b data-k="maxL">0°</b></span><span>MAX</span><span><b data-k="maxR">0°</b> DER</span></div>
      </div>
      <div class="panel gauge">
        <span class="lbl">Fuerza G</span>
        ${gDial()}
        <div class="foot"><span>AHORA <b data-k="gnow">0.0</b></span><span>MAX <b data-k="gmax">0.0</b></span></div>
      </div>
    </div>`

  const k = (name) => $(el, `[data-k="${name}"]`)
  const E = Object.fromEntries(
    ['speed', 'unit', 'max', 'glong', 'scale', 'trip', 'time', 'avg', 'alt', 'hdg', 'odo', 'maxL', 'maxR', 'gnow', 'gmax', 'rear', 'leanTxt', 'dot', 'trail'].map((n) => [n, k(n)]),
  )
  const bars = [...el.querySelectorAll('.speedbar i')]
  const leanSegs = [...el.querySelectorAll('polygon[data-i]')]
  const set = setter()
  let lit = -1
  let units = null
  const trail = []
  let trailT = 0

  function drawScale() {
    const top = settings.units === 'mph' ? 200 : 300
    const step = settings.units === 'mph' ? 50 : 50
    E.scale.innerHTML = Array.from({ length: top / step + 1 }, (_, i) => `<span>${i * step}</span>`).join('')
    units = settings.units
  }

  return {
    frame(dt) {
      if (units !== settings.units) drawScale()
      const v = toSpeed(T.vDisp)
      const n = Math.round(v)
      set(E.speed, T.status === 'ok' || T.status === 'lost' ? segPad(n, 3) : '!!-')
      set(E.unit, speedUnit())
      set(E.max, String(Math.round(toSpeed(T.maxV))))
      set(E.glong, (T.gLong >= 0 ? '' : '-') + Math.abs(T.gLong).toFixed(2))

      const top = settings.units === 'mph' ? 200 : 300
      const nl = Math.min(SEGS, Math.round((v / top) * SEGS))
      if (nl !== lit) {
        bars.forEach((b, i) => b.classList.toggle('lit', i < nl))
        lit = nl
      }

      set(E.trip, toDist(T.trip).toFixed(1))
      set(E.time, fmtClock(T.tripTime))
      set(E.avg, T.tripTime > 5 ? String(Math.round(toSpeed(T.trip / T.tripTime))) : '0')
      set(E.alt, T.alt != null ? String(Math.round(settings.units === 'mph' ? T.alt * 3.281 : T.alt)) : '---')
      set(E.hdg, T.heading != null ? `${compassPoint(T.heading)} ${String(Math.round(T.heading)).padStart(3, '0')}` : '---')
      set(E.odo, String(Math.round(toDist(totals.odo))))

      // Inclinación
      const deg = (T.lean * 180) / Math.PI
      const shown = Math.max(-LEAN_MAX, Math.min(LEAN_MAX, deg))
      set(E.rear, `rotate(${shown.toFixed(1)} 100 110)`, 'transform')
      set(E.leanTxt, String(Math.round(Math.abs(deg))))
      const per = (2 * LEAN_MAX) / LEAN_SEGS
      leanSegs.forEach((p, i) => {
        const mid = -LEAN_MAX + per * (i + 0.5)
        const on = (shown > 0 && mid > 0 && mid <= shown + per / 2) || (shown < 0 && mid < 0 && mid >= shown - per / 2)
        const isMax = Math.abs(mid + T.leanMaxL) < per / 2 || Math.abs(mid - T.leanMaxR) < per / 2
        const a = Math.abs(mid)
        const c = on ? (a < 20 ? '#3dff7a' : a < 40 ? '#ffd23f' : '#ff3b3b') : isMax && (T.leanMaxL > 2 || T.leanMaxR > 2) ? '#f4f1ff' : '#1e1542'
        set(p, c, 'fill')
      })
      set(E.maxL, `${Math.round(T.leanMaxL)}°`)
      set(E.maxR, `${Math.round(T.leanMaxR)}°`)

      // Círculo de fricción
      const gx = Math.max(-1.25, Math.min(1.25, T.gLat))
      const gy = Math.max(-1.25, Math.min(1.25, T.gLong))
      const x = 60 + gx * 48 - 6
      const y = 60 - gy * 48 - 6
      set(E.dot, x.toFixed(0), 'x')
      set(E.dot, y.toFixed(0), 'y')
      trailT += dt
      if (trailT > 0.1) {
        trailT = 0
        trail.push([x, y])
        if (trail.length > 18) trail.shift()
        E.trail.innerHTML = trail.map(([tx, ty], i) => `<rect x="${(tx + 3).toFixed(0)}" y="${(ty + 3).toFixed(0)}" width="6" height="6" fill="#ff2e88" opacity="${((i + 1) / trail.length) * 0.5}"/>`).join('')
      }
      set(E.gnow, Math.hypot(T.gLat, T.gLong).toFixed(2))
      set(E.gmax, T.gMax.toFixed(2))
    },
  }
}
