// Bloques del DASH. Cada uno dice qué tamaños admite y sabe dibujarse en cualquiera de ellos:
// el contenido se escala con el hueco (container queries en style.css). Colores: siempre las
// variables del tema, así cada tema los repinta.
import { T, zeroLean, signalBars, motionNeedsTap } from '../core/telemetry.js'
import { totals, settings, bests, runs } from '../core/store.js'
import { compassPoint } from '../core/geo.js'
import { logger } from '../core/logger.js'
import { sfx } from '../core/audio.js'
import { setter, segPad, toSpeed, speedUnit, toDist, distUnit, fmtClock, fmtT, markLabel, toast } from './util.js'
import { pixelSvg } from './pixel.js'
import { cssColor } from './themes.js'
import { TIRE_WIDGETS } from './tirewidgets.js'

const LEAN_SEGS = 25
const LEAN_MAX = 60
const lcd = () => (document.documentElement.dataset.digits || 'lcd') === 'lcd'
/** Relleno para alinear a la derecha: en LCD el hueco de un dígito («!»), en las demás un espacio de cifra. */
const pad = (n, w) => (lcd() ? segPad(n, w) : String(n).padStart(w, ' '))
const blank = (w) => (lcd() ? '!'.repeat(w) : ' '.repeat(w))
const ghost = (g) => (lcd() ? ` data-ghost="${g}"` : '')

// ---------- Barrido al dar el contacto ----------
// Como el cuadro de una moto al girar la llave: las agujas suben al máximo y vuelven (1,4 s)
let sweepAt = -1
export function bootSweep() {
  sweepAt = performance.now()
}
/** 0 → 1 → 0 durante el barrido; null si no hay. */
function sweep() {
  if (sweepAt < 0) return null
  const e = (performance.now() - sweepAt) / 1000
  if (e > 1.4) return (sweepAt = -1), null
  return e < 0.7 ? e / 0.7 : 1 - (e - 0.7) / 0.7
}

// ---------- Historial para las gráficas (se va guardando aunque no se vean) ----------
const hist = { v: [], alt: [], tv: 0, ta: 0 }
export function sample(dt) {
  hist.tv += dt
  hist.ta += dt
  if (hist.tv >= 0.25) {
    hist.tv = 0
    hist.v.push(T.status === 'ok' ? T.vDisp : null)
    if (hist.v.length > 240) hist.v.shift() // 60 s
  }
  if (hist.ta >= 2) {
    hist.ta = 0
    hist.alt.push(T.alt)
    if (hist.alt.length > 300) hist.alt.shift() // 10 min
  }
}

// ---------- Piezas comunes ----------
function stat(label, unit, get, { cls = '', g = '' } = {}) {
  return (el) => {
    el.classList.add('w-stat')
    el.innerHTML = `<span class="lbl">${label}</span><b class="v seg ${cls}"${g ? ghost(g) : ''}><span data-k="v">—</span><small data-k="u"></small></b>`
    const v = el.querySelector('[data-k="v"]')
    const u = el.querySelector('[data-k="u"]')
    const set = setter()
    return {
      frame() {
        const r = get()
        set(v, r[0])
        set(u, r[1] ?? (typeof unit === 'function' ? unit() : unit))
      },
    }
  }
}

const sign = (x, d) => {
  const r = Math.round(x * 10 ** d) / 10 ** d
  return (r < 0 ? '-' : '') + Math.abs(r).toFixed(d)
}

// ---------- Velocímetro ----------
function speedW(el) {
  const SEGS = 40
  el.innerHTML = `
    <div class="sb-top">
      <div><span class="lbl">Punta</span><b class="seg" data-k="max">0</b></div>
      <div class="r"><span class="lbl">G long</span><b class="seg" data-k="glong">0.00</b></div>
    </div>
    <div class="readout"><span class="seg num"${ghost('888')} data-k="speed">${blank(2)}0</span><span class="unit" data-k="unit">KM/H</span></div>
    <div class="sbar">
      <div class="speedbar">${Array.from({ length: SEGS }, (_, i) => `<i class="${i < 24 ? 'g' : i < 32 ? 'y' : 'r'}"></i>`).join('')}</div>
      <div class="scale" data-k="scale"></div>
    </div>`
  const k = (n) => el.querySelector(`[data-k="${n}"]`)
  const E = { speed: k('speed'), unit: k('unit'), max: k('max'), glong: k('glong'), scale: k('scale') }
  const bars = [...el.querySelectorAll('.speedbar i')]
  const set = setter()
  let lit = -1
  let units = null
  return {
    frame() {
      const top = settings.units === 'mph' ? 200 : 300
      if (units !== settings.units) {
        E.scale.innerHTML = Array.from({ length: top / 50 + 1 }, (_, i) => `<span>${i * 50}</span>`).join('')
        units = settings.units
      }
      const sw = sweep()
      const v = sw != null ? top * sw : toSpeed(T.vDisp)
      set(E.speed, sw != null || T.status === 'ok' || T.status === 'lost' ? pad(Math.round(v), 3) : blank(2) + '-')
      set(E.unit, speedUnit())
      set(E.max, String(Math.round(toSpeed(T.maxV))))
      set(E.glong, sign(T.gLong, 2))
      const nl = Math.min(SEGS, Math.round((v / top) * SEGS))
      if (nl !== lit) {
        bars.forEach((b, i) => b.classList.toggle('lit', i < nl))
        lit = nl
      }
    },
  }
}

// ---------- Inclinómetro ----------
const REAR = pixelSvg(
  ['...HHH...', '..HHHHH..', '..HVVVH..', '...HHH...', '.SSSSSSS.', 'SSSBBBSSS', 'S.BBBBB.S', '..BBBBB..', '...BKB...', '...KKK...', '...KKK...', '...KKK...'],
  { H: '#f4f1ff', V: '#22e3ff', S: '#8a80c4', B: '#ff2e88', K: '#e8e6ff' },
)
function leanW(el) {
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
    segs += `<polygon data-i="${i}" points="${p(a0, 78)} ${p(a1, 78)} ${p(a1, 98)} ${p(a0, 98)}"/>`
  }
  el.innerHTML = `
    <span class="lbl">Inclinacion</span>
    <svg class="dial" viewBox="0 0 200 124" preserveAspectRatio="xMidYMid meet">
      <g class="ld-segs">${segs}</g>
      <g data-k="rear"><g transform="translate(${cx - 18} ${cy - 50}) scale(4)">${REAR.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g></g>
      <text class="ld-txt" data-k="txt" x="${cx}" y="${cy - 54}" text-anchor="middle">0</text>
    </svg>
    <div class="foot"><span>IZQ <b data-k="maxL">0°</b></span><span class="mid">MAX</span><span><b data-k="maxR">0°</b> DER</span></div>`
  const k = (n) => el.querySelector(`[data-k="${n}"]`)
  const polys = [...el.querySelectorAll('polygon')]
  const set = setter()
  // Poner a cero: mantener pulsado (un toque corto solo explica cómo)
  let press = null
  el.addEventListener('pointerdown', () => {
    if (document.body.classList.contains('dash-edit')) return
    press = setTimeout(() => {
      press = null
      const ok = zeroLean()
      ok ? sfx.armed() : sfx.error()
      toast(ok ? 'INCLINOMETRO A 0' : noMotionMsg(), 4000)
    }, 700)
  })
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel'])
    el.addEventListener(ev, () => {
      if (!press) return
      clearTimeout(press)
      press = null
      if (ev === 'pointerup') toast(T.motion ? 'MANTEN PULSADO CON LA MOTO RECTA PARA PONERLO A 0' : noMotionMsg(), 4000)
    })
  const per = (2 * LEAN_MAX) / LEAN_SEGS
  return {
    frame() {
      const sw = sweep()
      const deg = sw != null ? LEAN_MAX * sw * (performance.now() % 1400 < 700 ? 1 : -1) : (T.lean * 180) / Math.PI
      const shown = Math.max(-LEAN_MAX, Math.min(LEAN_MAX, deg))
      set(k('rear'), `rotate(${shown.toFixed(1)} 100 110)`, 'transform')
      set(k('txt'), String(Math.round(Math.abs(deg))))
      polys.forEach((p, i) => {
        const mid = -LEAN_MAX + per * (i + 0.5)
        const on = (shown > 0 && mid > 0 && mid <= shown + per / 2) || (shown < 0 && mid < 0 && mid >= shown - per / 2)
        const isMax = Math.abs(mid + T.leanMaxL) < per / 2 || Math.abs(mid - T.leanMaxR) < per / 2
        const a = Math.abs(mid)
        set(p, on ? (a < 20 ? 'g' : a < 40 ? 'y' : 'r') : isMax && (T.leanMaxL > 2 || T.leanMaxR > 2) ? 'm' : '', 'class')
      })
      set(k('maxL'), `${Math.round(T.leanMaxL)}°`)
      set(k('maxR'), `${Math.round(T.leanMaxR)}°`)
    },
  }
}

/** Por qué no hay sensor y qué hacer. */
function noMotionMsg() {
  if (T.motionPerm === 'denied') return 'MOVIMIENTO DENEGADO: MIRA GARAJE > PERMISOS'
  if (motionNeedsTap()) return 'TOCA ACTIVAR EN GARAJE > PERMISOS Y ELIGE PERMITIR'
  return 'ESTE MOVIL NO DA DATOS DE MOVIMIENTO'
}

// ---------- Círculo de fuerza G ----------
function gW(el) {
  el.innerHTML = `
    <span class="lbl">Fuerza G</span>
    <svg class="dial" viewBox="0 0 120 120" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges">
      <rect class="gd-frame" x="4" y="4" width="112" height="112"/>
      <circle class="gd-ring" cx="60" cy="60" r="48" shape-rendering="auto"/>
      <circle class="gd-ring" cx="60" cy="60" r="24" shape-rendering="auto"/>
      <line class="gd-frame" x1="60" y1="6" x2="60" y2="114"/>
      <line class="gd-frame" x1="6" y1="60" x2="114" y2="60"/>
      <text class="gd-lbl" x="60" y="16" text-anchor="middle">ACEL</text>
      <text class="gd-lbl" x="60" y="112" text-anchor="middle">FRENO</text>
      <text class="gd-lbl" x="9" y="57">IZQ</text>
      <text class="gd-lbl" x="111" y="57" text-anchor="end">DER</text>
      <g class="gd-trail" data-k="trail"></g>
      <rect class="gd-dot" data-k="dot" x="54" y="54" width="12" height="12"/>
    </svg>
    <div class="foot"><span><i>AHORA </i><b data-k="now">0.0</b></span><span><i>MAX </i><b data-k="max">0.0</b></span></div>`
  const k = (n) => el.querySelector(`[data-k="${n}"]`)
  const set = setter()
  const trail = []
  let t = 0
  return {
    frame(dt) {
      const gx = Math.max(-1.25, Math.min(1.25, T.gLat))
      const gy = Math.max(-1.25, Math.min(1.25, T.gLong))
      const x = 60 + gx * 48 - 6
      const y = 60 - gy * 48 - 6
      set(k('dot'), x.toFixed(0), 'x')
      set(k('dot'), y.toFixed(0), 'y')
      t += dt
      if (t > 0.1) {
        t = 0
        trail.push([x, y])
        if (trail.length > 18) trail.shift()
        k('trail').innerHTML = trail.map(([tx, ty], i) => `<rect x="${(tx + 3).toFixed(0)}" y="${(ty + 3).toFixed(0)}" width="6" height="6" opacity="${(((i + 1) / trail.length) * 0.5).toFixed(2)}"/>`).join('')
      }
      set(k('now'), Math.hypot(T.gLat, T.gLong).toFixed(2))
      set(k('max'), T.gMax.toFixed(2))
    },
  }
}

// ---------- Inclinación en número, con barra ----------
function leanNumW(el) {
  el.innerHTML = `<span class="lbl">Inclinacion</span>
    <div class="ln"><b class="seg v"${ghost('88')} data-k="v">0</b><span class="side" data-k="side"></span></div>
    <div class="lbar"><i data-k="bar"></i><s></s></div>`
  const k = (n) => el.querySelector(`[data-k="${n}"]`)
  const set = setter()
  return {
    frame() {
      const deg = (T.lean * 180) / Math.PI
      const a = Math.round(Math.abs(deg))
      set(k('v'), pad(a, 2))
      set(k('side'), a < 1 ? '' : deg < 0 ? 'IZQ' : 'DER')
      const f = Math.max(-1, Math.min(1, deg / 55))
      const bar = k('bar')
      bar.style.left = `${50 + Math.min(0, f) * 50}%`
      bar.style.width = `${Math.abs(f) * 50}%`
      set(bar, Math.abs(deg) < 20 ? 'g' : Math.abs(deg) < 40 ? 'y' : 'r', 'class')
    },
  }
}

// ---------- G longitudinal con barra ----------
function gLongW(el) {
  el.innerHTML = `<span class="lbl">G long</span><b class="seg v" data-k="v">0.00</b><div class="lbar"><i data-k="bar"></i><s></s></div>`
  const k = (n) => el.querySelector(`[data-k="${n}"]`)
  const set = setter()
  return {
    frame() {
      set(k('v'), sign(T.gLong, 2))
      const f = Math.max(-1, Math.min(1, T.gLong))
      const bar = k('bar')
      bar.style.left = `${50 + Math.min(0, f) * 50}%`
      bar.style.width = `${Math.abs(f) * 50}%`
      set(bar, f < 0 ? 'r' : 'g', 'class')
    },
  }
}

// ---------- Hora ----------
function clockW(el) {
  el.innerHTML = `<span class="lbl">Hora</span><b class="seg v big"${ghost('88:88')} data-k="v">00:00</b>`
  const v = el.querySelector('[data-k="v"]')
  const set = setter()
  return {
    frame() {
      const d = new Date()
      set(v, `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
    },
  }
}

// ---------- GPS ----------
function gpsW(el) {
  el.innerHTML = `<span class="lbl">GPS</span><div class="gpsw"><div class="bars" data-k="bars" data-n="0"><i></i><i></i><i></i><i></i></div><b class="v" data-k="v">—</b></div>`
  const k = (n) => el.querySelector(`[data-k="${n}"]`)
  const set = setter()
  return {
    frame() {
      set(k('bars'), String(signalBars()), 'data-n')
      set(k('v'), T.status === 'ok' ? `${T.hz >= 1.5 ? Math.round(T.hz) : 1} HZ ±${Math.round(T.acc)} M` : T.status === 'denied' ? 'SIN PERMISO' : T.status === 'lost' ? 'PERDIDO' : 'BUSCANDO')
    },
  }
}

// ---------- Caja negra ----------
function recW(el) {
  el.innerHTML = `<span class="lbl">Caja negra</span><div class="recw"><i data-k="dot"></i><b class="v" data-k="v">—</b></div><small class="sub" data-k="sub"></small>`
  const k = (n) => el.querySelector(`[data-k="${n}"]`)
  const set = setter()
  let t = 1
  return {
    frame(dt) {
      if ((t += dt) < 0.5) return
      t = 0
      const L = logger()
      const sess = L?.state?.sess
      const on = Boolean(L?.recording && sess)
      set(k('dot'), on ? 'on' : settings.logTelemetry ? '' : 'off', 'class')
      set(k('v'), on ? 'REC' : settings.logTelemetry ? 'EN ESPERA' : 'APAGADA')
      set(k('sub'), on ? `${fmtClock((Date.now() - sess.start) / 1000)} · ${toDist(sess.dist).toFixed(1)} ${distUnit()}` : settings.logTelemetry ? 'Graba sola al arrancar' : 'Garaje → Ajustes')
    },
  }
}

// ---------- Gráficas ----------
function traceW(label, data, opts) {
  return (el) => {
    el.innerHTML = `<div class="tr-head"><span class="lbl">${label}</span><b class="v"><span class="seg" data-k="v">—</span><small data-k="u"></small></b></div><canvas></canvas>`
    const cv = el.querySelector('canvas')
    const v = el.querySelector('[data-k="v"]')
    const u = el.querySelector('[data-k="u"]')
    const set = setter()
    let t = 1
    return {
      frame(dt) {
        if ((t += dt) < 0.25) return
        t = 0
        const arr = data()
        const last = [...arr].reverse().find((x) => x != null)
        const [num, unit] = last == null ? ['—', ''] : opts.fmt(last)
        set(v, num)
        set(u, unit)
        const dpr = devicePixelRatio || 1
        const w = Math.round(cv.clientWidth * dpr)
        const h = Math.round(cv.clientHeight * dpr)
        if (!w || !h) return
        if (cv.width !== w || cv.height !== h) (cv.width = w), (cv.height = h)
        const ctx = cv.getContext('2d')
        ctx.clearRect(0, 0, w, h)
        const vals = arr.map((x) => (x == null ? null : opts.conv(x)))
        const real = vals.filter((x) => x != null)
        if (real.length < 2) return
        let lo = opts.min ?? Math.min(...real)
        let hi = Math.max(opts.minTop ?? 0, ...real)
        if (hi - lo < (opts.span ?? 10)) (hi = lo + (opts.span ?? 10))
        const n = opts.len
        const x = (i) => (i + n - vals.length) * (w / (n - 1))
        const y = (val) => h - 2 * dpr - ((val - lo) / (hi - lo)) * (h - 4 * dpr)
        // Rejilla
        ctx.strokeStyle = cssColor('off')
        ctx.lineWidth = dpr
        for (let q = 1; q < 4; q++) {
          ctx.beginPath()
          ctx.moveTo(0, Math.round((h * q) / 4) + 0.5)
          ctx.lineTo(w, Math.round((h * q) / 4) + 0.5)
          ctx.stroke()
        }
        // Línea con relleno
        const col = cssColor(opts.color)
        ctx.beginPath()
        let started = false
        vals.forEach((val, i) => {
          if (val == null) return
          started ? ctx.lineTo(x(i), y(val)) : ctx.moveTo(x(i), y(val))
          started = true
        })
        ctx.strokeStyle = col
        ctx.lineWidth = 2 * dpr
        ctx.stroke()
        ctx.lineTo(x(vals.length - 1), h)
        ctx.lineTo(x(vals.findIndex((q) => q != null)), h)
        ctx.closePath()
        ctx.globalAlpha = 0.15
        ctx.fillStyle = col
        ctx.fill()
        ctx.globalAlpha = 1
      },
    }
  }
}

// ---------- Brújula ----------
function compassW(el) {
  let ticks = ''
  for (let a = 0; a < 360; a += 15) {
    const r1 = a % 90 === 0 ? 34 : a % 45 === 0 ? 38 : 41
    const rad = (a * Math.PI) / 180
    ticks += `<line x1="${(50 + Math.sin(rad) * r1).toFixed(1)}" y1="${(50 - Math.cos(rad) * r1).toFixed(1)}" x2="${(50 + Math.sin(rad) * 45).toFixed(1)}" y2="${(50 - Math.cos(rad) * 45).toFixed(1)}"/>`
  }
  const card = (t, a) => {
    const rad = (a * Math.PI) / 180
    return `<text x="${(50 + Math.sin(rad) * 26).toFixed(1)}" y="${(50 - Math.cos(rad) * 26 + 3.5).toFixed(1)}" text-anchor="middle" class="${t === 'N' ? 'n' : ''}">${t}</text>`
  }
  el.innerHTML = `<span class="lbl">Rumbo</span>
    <svg class="dial cmp" viewBox="0 0 100 100">
      <g data-k="rose"><circle cx="50" cy="50" r="45"/>${ticks}${card('N', 0)}${card('E', 90)}${card('S', 180)}${card('O', 270)}</g>
      <path class="ptr" d="M50 1 L55 10 L45 10 Z"/>
    </svg>
    <b class="v" data-k="v">---</b>`
  const k = (n) => el.querySelector(`[data-k="${n}"]`)
  const set = setter()
  let shown = 0
  return {
    frame(dt) {
      if (T.heading == null) return set(k('v'), '---')
      // Gira por el camino corto y suave
      let d = ((T.heading - shown + 540) % 360) - 180
      shown = (shown + d * Math.min(1, dt * 6) + 360) % 360
      set(k('rose'), `rotate(${(-shown).toFixed(1)} 50 50)`, 'transform')
      set(k('v'), `${compassPoint(T.heading)} ${String(Math.round(T.heading)).padStart(3, '0')}°`)
    },
  }
}

// ---------- Crono ----------
const headMark = () => (settings.units === 'mph' ? 'm0-60' : 'k0-100')
function bestW(el) {
  el.innerHTML = `<span class="lbl">Records</span><div class="two"><div><small data-k="l1"></small><b class="seg v" data-k="a">--.--</b></div><div><small>1/4</small><b class="seg v" data-k="b">--.--</b></div></div>`
  const k = (n) => el.querySelector(`[data-k="${n}"]`)
  const set = setter()
  let t = 9
  return {
    frame(dt) {
      if ((t += dt) < 2) return
      t = 0
      const b = bests()
      set(k('l1'), markLabel(headMark()).replace(/ (KM\/H|MPH)$/, ''))
      set(k('a'), b[headMark()] ? fmtT(b[headMark()].t) : '--.--')
      set(k('b'), b['1/4'] ? fmtT(b['1/4'].t) : '--.--')
    },
  }
}
function lastRunW(el) {
  el.innerHTML = `<span class="lbl">Ultima pasada</span><b class="seg v" data-k="v">--.--</b><small class="sub" data-k="sub">Haz una en CRONO</small>`
  const k = (n) => el.querySelector(`[data-k="${n}"]`)
  const set = setter()
  let t = 9
  return {
    frame(dt) {
      if ((t += dt) < 2) return
      t = 0
      const r = runs[0]
      const m = r && (r.marks[headMark()] ? headMark() : Object.keys(r.marks)[0])
      set(k('v'), m ? fmtT(r.marks[m].t) : '--.--')
      set(k('sub'), m ? `${markLabel(m).replace(/ (KM\/H|MPH)$/, '')} · punta ${Math.round(toSpeed(r.maxV))}` : 'Haz una en CRONO')
    },
  }
}

// ---------- Catálogo ----------
// sizes: el primero es el de por defecto. s pequeño, m ancho, l grande, w banda, xl enorme, max pantalla.
export const WIDGETS = {
  speed: { name: 'Velocímetro', title: 'VELOCIMETRO', group: 'VELOCIDAD', sizes: ['xl', 'max', 'w', 'l', 'm'], desc: 'Velocidad en grande, con punta, G y barra', make: speedW },
  top: { name: 'Punta', title: 'PUNTA', group: 'VELOCIDAD', sizes: ['s', 'm'], desc: 'La velocidad máxima del viaje', make: stat('Punta', speedUnit, () => [String(Math.round(toSpeed(T.maxV)))]) },
  avg: { name: 'Media', title: 'MEDIA', group: 'VELOCIDAD', sizes: ['s', 'm'], desc: 'Velocidad media en marcha', make: stat('Media', speedUnit, () => [T.tripTime > 5 ? String(Math.round(toSpeed(T.trip / T.tripTime))) : '0']) },
  speedtrace: { name: 'Gráfica de velocidad', title: 'GRAFICA VELOCIDAD', group: 'VELOCIDAD', sizes: ['w', 'l', 'xl'], desc: 'El último minuto', make: traceW('Velocidad 1 min', () => hist.v, { len: 240, conv: toSpeed, fmt: (x) => [String(Math.round(toSpeed(x))), speedUnit()], min: 0, minTop: 40, span: 30, color: 'cyan' }) },
  lean: { name: 'Inclinómetro', title: 'INCLINOMETRO', group: 'MOTO', sizes: ['l', 'w', 'xl'], desc: 'La moto que se tumba, con los máximos', make: leanW },
  leannum: { name: 'Inclinación', title: 'INCLINACION', group: 'MOTO', sizes: ['m', 's', 'l', 'w'], desc: 'Los grados en número, con barra', make: leanNumW },
  leanmax: { name: 'Incl. máxima', title: 'INCL MAXIMA', group: 'MOTO', sizes: ['m', 's'], desc: 'Lo más tumbado a cada lado', make: stat('Incl max', '', () => [`${Math.round(T.leanMaxL)}·${Math.round(T.leanMaxR)}`, 'I·D']) },
  gforce: { name: 'Círculo G', title: 'CIRCULO G', group: 'MOTO', sizes: ['l', 'xl'], desc: 'Hacia dónde empuja la moto, con rastro', make: gW },
  glong: { name: 'G longitudinal', title: 'G LONG', group: 'MOTO', sizes: ['m', 's'], desc: 'Acelerar (+) o frenar (−), con barra', make: gLongW },
  gmax: { name: 'G máxima', title: 'G MAXIMA', group: 'MOTO', sizes: ['s', 'm'], desc: 'La mayor fuerza G del viaje', make: stat('G max', 'G', () => [T.gMax.toFixed(2)]) },
  trip: { name: 'Viaje', title: 'VIAJE', group: 'VIAJE', sizes: ['s', 'm'], desc: 'Distancia de este viaje', make: stat('Viaje', distUnit, () => [toDist(T.trip).toFixed(1)]) },
  time: { name: 'Tiempo', title: 'TIEMPO', group: 'VIAJE', sizes: ['s', 'm'], desc: 'Tiempo en marcha', make: stat('Tiempo', '', () => [fmtClock(T.tripTime)]) },
  odo: { name: 'Total', title: 'TOTAL', group: 'VIAJE', sizes: ['s', 'm'], desc: 'Cuentakilómetros de la app', make: stat('Total', distUnit, () => [String(Math.round(toDist(totals.odo)))]) },
  alt: { name: 'Altitud', title: 'ALTITUD', group: 'VIAJE', sizes: ['s', 'm'], desc: 'Altura sobre el mar', make: stat('Altitud', () => (settings.units === 'mph' ? 'FT' : 'M'), () => [T.alt != null ? String(Math.round(settings.units === 'mph' ? T.alt * 3.281 : T.alt)) : '---']) },
  alttrace: { name: 'Perfil de altitud', title: 'PERFIL ALTITUD', group: 'VIAJE', sizes: ['w', 'l'], desc: 'Subidas y bajadas de los últimos 10 min', make: traceW('Altitud 10 min', () => hist.alt, { len: 300, conv: (m) => (settings.units === 'mph' ? m * 3.281 : m), fmt: (m) => [String(Math.round(settings.units === 'mph' ? m * 3.281 : m)), settings.units === 'mph' ? 'FT' : 'M'], span: 20, color: 'violet' }) },
  heading: { name: 'Rumbo', title: 'RUMBO', group: 'VIAJE', sizes: ['s', 'm'], desc: 'Hacia dónde vas', make: stat('Rumbo', '', () => [T.heading != null ? `${compassPoint(T.heading)} ${String(Math.round(T.heading)).padStart(3, '0')}` : '---']) },
  compass: { name: 'Brújula', title: 'BRUJULA', group: 'VIAJE', sizes: ['l', 'xl'], desc: 'Rosa de los vientos que gira contigo', make: compassW },
  clock: { name: 'Hora', title: 'HORA', group: 'VIAJE', sizes: ['m', 's', 'l', 'w'], desc: 'La hora en grande', make: clockW },
  best: { name: 'Récords', title: 'RECORDS', group: 'CRONO', sizes: ['m', 'l'], desc: 'Tu mejor 0-100 y 1/4 de milla', make: bestW },
  lastrun: { name: 'Última pasada', title: 'ULTIMA PASADA', group: 'CRONO', sizes: ['m', 's'], desc: 'El tiempo de tu última pasada del crono', make: lastRunW },
  gps: { name: 'GPS', title: 'GPS', group: 'SISTEMA', sizes: ['m', 's'], desc: 'Señal y precisión', make: gpsW },
  rec: { name: 'Caja negra', title: 'CAJA NEGRA', group: 'SISTEMA', sizes: ['m', 's'], desc: 'Si está grabando la salida', make: recW },
  // Solo en el catálogo si activas la temperatura (Garaje → Opciones avanzadas)
  ...TIRE_WIDGETS,
}

export const GROUPS = ['VELOCIDAD', 'MOTO', 'VIAJE', 'CRONO', 'SISTEMA', 'NEUMATICOS']

export const SIZE_NAMES = { s: 'MINI', m: 'ANCHO', l: 'GRANDE', w: 'BANDA', xl: 'ENORME', max: 'PANTALLA' }
