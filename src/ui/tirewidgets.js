// Bloques de NEUMATICOS para el DASH (core/tirelive.js): cuatro formas de ver la temperatura estimada.
// No salen solos: se añaden a mano en el DASH, y solo aparecen en el catálogo si la activas en
// Garaje → Opciones avanzadas. Si la apagas con el bloque puesto, el bloque te dice dónde encenderla.
import { settings } from '../core/store.js'
import { T } from '../core/telemetry.js'
import { tires } from '../core/tirelive.js'
import { tireSettings, tireState, workingTemp, TIRE_TYPES } from '../core/tires.js'
import { setter } from './util.js'

const st = () => tireSettings(settings.tires)
export const tiresOn = () => st().enabled
const typeOf = () => (TIRE_TYPES[st().type] ? st().type : 'calle')
const leanDeg = () => (T.lean * 180) / Math.PI
const OFF = '<span class="lbl">Neumaticos</span><p class="tw-off">ACTIVALO EN GARAJE &gt; OPCIONES AVANZADAS</p>'
// Nombres cortos (caben en un bloque pequeño)
const SHORT = { frio: 'FRIO', templado: 'TEMPLANDO', ok: 'OK', caliente: 'CALIENTE' }
const deg = (t) => (Number.isFinite(t) ? String(Math.round(t)) : '--')

/** Lo común: si está apagada, el aviso; si no, el bloque (que se pinta 4 veces por segundo). */
function tireW(build) {
  return (el, size) => {
    let mode = null
    let inner = null
    let t = 1
    return {
      frame(dt = 0.25) {
        const on = tiresOn()
        if (on !== mode) {
          mode = on
          el.classList.toggle('tw-disabled', !on)
          if (on) inner = build(el, size)
          else (inner = null), (el.innerHTML = OFF)
          t = 1
        }
        if (!inner || (t += dt) < 0.25) return
        t = 0
        inner.frame(tires.snap)
      },
    }
  }
}

// ---------- 1. Números: la temperatura que manda en cada rueda ----------
function numW(el) {
  el.innerHTML = `<span class="lbl">Neumaticos <small>°C</small></span>
    <div class="tn"><div class="tn-w"><small>DEL</small><b class="seg v" data-k="f">--</b></div><div class="tn-w"><small>TRAS</small><b class="seg v" data-k="r">--</b></div></div>`
  const k = (n) => el.querySelector(`[data-k="${n}"]`)
  const set = setter()
  const setC = setter()
  return {
    frame(s) {
      const type = typeOf()
      for (const w of ['f', 'r']) {
        const t = s ? workingTemp(s[w], leanDeg()) : NaN
        setC(k(w), deg(t))
        set(k(w), `seg v st-${s ? tireState(t, type) : 'none'}`, 'class')
      }
    },
  }
}

// ---------- 2. Mapa térmico: cada rueda por zonas (hombro izquierdo, centro, derecho) ----------
function mapW(el) {
  const tire = (w, label) => `<div class="tm-w"><small>${label}</small><div class="tm-tire">${['L', 'C', 'R'].map((z) => `<div class="tm-z" data-k="${w}${z}"><b data-k="${w}${z}v">--</b></div>`).join('')}</div><small class="tm-core" data-k="${w}core">CARCASA --</small></div>`
  el.innerHTML = `<span class="lbl">Mapa termico <small>°C</small></span><div class="tm">${tire('f', 'DEL')}${tire('r', 'TRAS')}</div>`
  const k = (n) => el.querySelector(`[data-k="${n}"]`)
  const set = setter()
  const setC = setter()
  return {
    frame(s) {
      const type = typeOf()
      for (const w of ['f', 'r'])
        for (const z of ['L', 'C', 'R']) {
          const t = s ? s[w][z] : NaN
          setC(k(`${w}${z}v`), deg(t))
          set(k(`${w}${z}`), `tm-z st-${s ? tireState(t, type) : 'none'}`, 'class')
        }
      for (const w of ['f', 'r']) setC(k(`${w}core`), `CARCASA ${s ? deg(s[w].core) : '--'}°`)
    },
  }
}

// ---------- 3. Barras: dónde estás respecto a la ventana buena ----------
function barsW(el) {
  const row = (w, label) => `<div class="tb-r"><small>${label}</small><div class="tb-bar"><s data-k="win"></s><i data-k="${w}m"></i></div><b data-k="${w}v">--</b></div>`
  el.innerHTML = `<span class="lbl">Neumaticos <small data-k="range"></small></span><div class="tb">${row('f', 'DEL')}${row('r', 'TRAS')}</div>`
  const k = (n) => el.querySelector(`[data-k="${n}"]`)
  const set = setter()
  const setC = setter()
  return {
    frame(s) {
      const type = typeOf()
      const [lo, hi] = TIRE_TYPES[type].ok
      const min = lo - 30
      const max = hi + 20
      const x = (t) => `${Math.max(0, Math.min(100, ((t - min) / (max - min)) * 100)).toFixed(1)}%`
      for (const win of el.querySelectorAll('[data-k="win"]')) {
        win.style.left = x(lo)
        win.style.width = `${(((hi - lo) / (max - min)) * 100).toFixed(1)}%`
      }
      set(k('range'), `OK ${lo}-${hi}°`)
      for (const w of ['f', 'r']) {
        const t = s ? workingTemp(s[w], leanDeg()) : NaN
        const m = k(`${w}m`)
        m.style.left = Number.isFinite(t) ? x(t) : '0%'
        set(m, `st-${s ? tireState(t, type) : 'none'}`, 'class')
        setC(k(`${w}v`), `${deg(t)}°`)
      }
    },
  }
}

// ---------- 4. Semáforo: frío, templando, ok o caliente ----------
function lightW(el) {
  const row = (w, label) => `<div class="tl-r"><i data-k="${w}i"></i><small>${label}</small><b data-k="${w}">--</b></div>`
  el.innerHTML = `<span class="lbl">Neumaticos</span><div class="tl">${row('f', 'DEL')}${row('r', 'TRAS')}</div>`
  const k = (n) => el.querySelector(`[data-k="${n}"]`)
  const set = setter()
  const setC = setter()
  return {
    frame(s) {
      const type = typeOf()
      for (const w of ['f', 'r']) {
        const state = s ? tireState(workingTemp(s[w], leanDeg()), type) : 'none'
        setC(k(w), s ? SHORT[state] : '--')
        set(k(w), `st-${state}`, 'class')
        setC(k(`${w}i`), `st-${state}`, 'class')
      }
    },
  }
}

export const TIRE_WIDGETS = {
  tirenum: { name: 'Temp. neumáticos', title: 'NEUMATICOS', group: 'NEUMATICOS', sizes: ['m', 's', 'l', 'w'], desc: 'Los grados de cada rueda, del color de cómo van', needs: tiresOn, make: tireW(numW) },
  tiremap: { name: 'Mapa térmico', title: 'MAPA TERMICO', group: 'NEUMATICOS', sizes: ['l', 'w', 'xl'], desc: 'Cada rueda por zonas: hombros y centro, y la carcasa', needs: tiresOn, make: tireW(mapW) },
  tirebars: { name: 'Barras de temperatura', title: 'BARRAS NEUMATICOS', group: 'NEUMATICOS', sizes: ['w', 'l', 'm'], desc: 'Dónde estás respecto a la temperatura buena', needs: tiresOn, make: tireW(barsW) },
  tirelight: { name: 'Semáforo', title: 'SEMAFORO NEUMATICOS', group: 'NEUMATICOS', sizes: ['m', 's', 'w'], desc: 'Frío, templando, ok o caliente, sin números', needs: tiresOn, make: tireW(lightW) },
}
