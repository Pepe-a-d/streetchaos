// GARAJE → OPCIONES AVANZADAS: la temperatura estimada de los neumáticos (apagada hasta que la actives).
// Aquí van los datos que necesita el modelo (core/tires.js) y la calibración con un termómetro de
// infrarrojos al acabar una salida.
import { settings, setSetting } from '../core/store.js'
import { logger } from '../core/logger.js'
import { TIRE_TYPES, tireSettings, calibrate, combinedK, seriesFromCalc, trailingStop, decimate, roadTemp } from '../core/tires.js'
import { weatherAt } from '../core/weather.js'
import { esc, toast, toDist, distUnit } from './util.js'

const st = () => tireSettings(settings.tires)
const setTires = (patch) => setSetting('tires', { ...st(), ...patch })
const dec = (x, d = 2) => x.toFixed(d).replace('.', ',')
const num = (txt) => {
  const v = Number(String(txt ?? '').trim().replace(',', '.'))
  return String(txt ?? '').trim() !== '' && Number.isFinite(v) ? v : NaN
}
const ZONES = [
  ['fL', 'fC', 'fR'],
  ['rL', 'rC', 'rR'],
]
// Lo que se puede escribir: [clave, mínimo, máximo] (fuera de eso no se guarda)
const LIMITS = { pFront: [0.8, 4], pRear: [0.8, 4], bikeKg: [60, 450], riderKg: [30, 200], frontPct: [30, 70], airManual: [-15, 50] }

export const advancedSub = () => (st().enabled ? `Neumáticos: estimando${st().cals.length ? ', calibrado' : ', sin calibrar'}` : 'Temperatura de neumáticos (apagada)')

const field = (key, label, small, value, { unit = '', mode = 'decimal', w = 5 } = {}) =>
  `<div class="set"><span>${label}${small ? `<small>${small}</small>` : ''}</span><label class="adv-f"><input class="adv-in" data-tk="${key}" value="${esc(String(value))}" inputmode="${mode}" size="${w}" autocomplete="off" spellcheck="false">${unit ? `<i>${unit}</i>` : ''}</label></div>`

export function advancedHtml() {
  const s = st()
  const on = s.enabled
  const head = `<div class="group"><h4 class="lbl">TEMPERATURA DE NEUMATICOS</h4>
    <div class="set"><span>Estimar la temperatura<small>Calcula, mientras vas, cómo de calientes van los neumáticos por el centro y por los hombros. No se mide (haría falta un sensor): se estima con la velocidad, las G y la inclinación, tus datos y el tiempo que hace.</small></span><button class="chip ${on ? 'on' : ''}" data-tire="enabled">${on ? 'SI' : 'NO'}</button></div>
    ${on ? '<p class="note">Para verla en marcha, añade un bloque del grupo NEUMATICOS al DASH: botón EDITAR del DASH (o APARIENCIA → PANTALLAS DEL DASH) y luego +. Hay cuatro formas de verla. También sale en el Blackbox, pestaña NEUMATICOS.</p>' : ''}</div>`
  if (!on) return head
  const type = TIRE_TYPES[s.type] ? s.type : 'calle'
  const cals = s.cals || []
  return `${head}
    <div class="group"><h4 class="lbl">NEUMATICOS</h4>
      <div class="set"><span>Tipo<small>${esc(TIRE_TYPES[type].desc)}: va bien entre ${TIRE_TYPES[type].ok[0]} y ${TIRE_TYPES[type].ok[1]} °C</small></span><div class="chips">${Object.entries(TIRE_TYPES)
        .map(([k, t]) => `<button class="chip ${k === type ? 'on' : ''}" data-tire-type="${k}">${t.name}</button>`)
        .join('')}</div></div>
      ${field('front', 'Medida delantera', 'La del flanco, p. ej. 110/70-17', s.front, { mode: 'text', w: 9 })}
      ${field('rear', 'Medida trasera', 'p. ej. 150/60-17', s.rear, { mode: 'text', w: 9 })}
      ${field('pFront', 'Presión delantera', 'En frío, antes de salir', s.pFront, { unit: 'bar' })}
      ${field('pRear', 'Presión trasera', 'En frío', s.pRear, { unit: 'bar' })}
    </div>
    <div class="group"><h4 class="lbl">PESOS</h4>
      ${field('bikeKg', 'Moto', 'En orden de marcha', s.bikeKg, { unit: 'kg', mode: 'numeric' })}
      ${field('riderKg', 'Piloto', 'Con el equipo puesto', s.riderKg, { unit: 'kg', mode: 'numeric' })}
      ${field('frontPct', 'Peso delante', 'Lo normal: 45-52 %', s.frontPct, { unit: '%', mode: 'numeric' })}
    </div>
    <div class="group"><h4 class="lbl">TIEMPO</h4>
      <div class="set"><span>Tiempo de internet<small>Temperatura, sol y lluvia de Open-Meteo al dar el contacto, al calibrar y en el Blackbox. Se manda tu posición redondeada (a ~1 km) y la hora, nada más.</small></span><button class="chip ${s.weather ? 'on' : ''}" data-tire="weather">${s.weather ? 'SI' : 'NO'}</button></div>
      ${field('airManual', 'Temperatura del aire', s.weather ? 'Si no hay internet' : 'La que hace hoy', s.airManual, { unit: '°C' })}
    </div>
    <div class="group"><h4 class="lbl">CALIBRACION</h4>
      <p class="note">Con un termómetro de infrarrojos, al parar después de una salida: mide cada rueda en el hombro izquierdo, el centro y el hombro derecho, lo antes que puedas. Apunta lo que tengas (no hace falta todo) y los minutos desde que paraste. Cuantas más veces calibres, mejor.</p>
      <div class="set"><span>Salida<small>La que acabas de hacer</small></span><select class="vsel" data-k="calSess"><option>Mirando la caja negra…</option></select></div>
      <div class="cal-grid">
        <span></span><b>IZQ</b><b>CENTRO</b><b>DER</b>
        ${ZONES.map((row, k) => `<b>${k ? 'TRAS' : 'DEL'}</b>${row.map((z) => `<input class="adv-in" data-cal="${z}" inputmode="decimal" placeholder="°C" autocomplete="off">`).join('')}`).join('')}
      </div>
      ${field('calMins', 'Minutos desde que paraste', '', 2, { mode: 'decimal', unit: 'min' }).replace('data-tk="calMins"', 'data-k="calMins"')}
      <div class="set"><span>Calibrar<small data-k="calRes">${cals.length ? `Factor de calor ×${dec(s.k)} con ${cals.length} ${cals.length === 1 ? 'medida' : 'medidas'}` : 'Sin calibrar: factor ×1,00'}</small></span><button class="btn small cyan" data-act="tireCal">CALIBRAR</button></div>
      ${
        cals.length
          ? `<div class="cal-list">${cals
              .slice()
              .reverse()
              .map((c) => `<div><span>${new Date(c.date || c.at).toLocaleDateString('es', { day: 'numeric', month: 'short' })} · ${Number.isFinite(c.tAir) ? `${c.tAir.toFixed(0)} °C` : ''}</span><span>×${dec(c.k)}</span><span>±${dec(c.err0, 1)} → ±${dec(c.err1, 1)} °C</span></div>`)
              .join('')}</div>
             <div class="set"><span>Empezar de cero<small>Borra las calibraciones</small></span><button class="btn small ghost" data-act="tireCalReset">BORRAR</button></div>`
          : ''
      }
    </div>`
}

/** La lista de salidas para calibrar (asíncrona: la caja negra está en IndexedDB). */
export async function fillAdvanced(root) {
  const sel = root.querySelector('[data-k="calSess"]')
  if (!sel) return
  const L = logger()
  const list = L ? (await L.list()).filter((m) => m.state === 'done' || m.state === 'rec').sort((a, b) => b.start - a.start).slice(0, 10) : []
  if (!sel.isConnected) return
  sel.innerHTML = list.length
    ? list.map((m) => `<option value="${esc(m.id)}">${new Date(m.start).toLocaleString('es', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${toDist(m.dist || 0).toFixed(1)} ${distUnit()}</option>`).join('')
    : '<option value="">Sin salidas guardadas</option>'
}

/** Al escribir en un campo: se guarda si es válido. true si era de esta página. */
export function advancedChange(t) {
  const key = t.dataset.tk
  if (!key) return false
  if (key === 'front' || key === 'rear') {
    const ok = /(\d{2,3})\s*\/\s*(\d{2})\s*[-\sZRBR]*\s*(\d{2})/i.test(t.value)
    if (ok) setTires({ [key]: t.value.trim().toUpperCase() })
    else toast('MEDIDA COMO 130/70-17')
    return true
  }
  const v = num(t.value)
  const [lo, hi] = LIMITS[key] || [-Infinity, Infinity]
  if (Number.isFinite(v) && v >= lo && v <= hi) setTires({ [key]: v })
  else {
    toast(`ENTRE ${lo} Y ${hi}`)
    t.value = st()[key]
  }
  return true
}

/** Clics de esta página. Devuelve true si hay que repintar, false si ya está, null si no era suyo. */
export async function advancedClick(b, root) {
  if (b.dataset.tire) {
    setTires({ [b.dataset.tire]: !st()[b.dataset.tire] })
    return true
  }
  if (b.dataset.tireType) {
    setTires({ type: b.dataset.tireType })
    return true
  }
  if (b.dataset.act === 'tireCalReset') {
    if (!confirm('¿Borrar las calibraciones de los neumáticos?')) return false
    setTires({ cals: [], k: 1 })
    return true
  }
  if (b.dataset.act !== 'tireCal') return null
  b.disabled = true
  b.textContent = '...'
  try {
    const res = await runCalibration(root)
    if (res) {
      toast(`CALIBRADO: ±${dec(res.err0, 1)} → ±${dec(res.err1, 1)} °C`, 4000)
      return true
    }
  } catch (err) {
    toast(`NO SE PUDO CALIBRAR: ${err?.message || err}`, 4000)
  }
  b.disabled = false
  b.textContent = 'CALIBRAR'
  return false
}

/** Primera posición de la salida (gps: 11 columnas, lat y lon en la 2 y la 3). */
function firstFix(gps) {
  for (let o = 0; o + 10 < gps.length; o += 11) if (Number.isFinite(gps[o + 2]) && Number.isFinite(gps[o + 3]) && gps[o + 2] !== 0) return { lat: gps[o + 2], lon: gps[o + 3] }
  return null
}

async function runCalibration(root) {
  const meas = {}
  for (const z of ZONES.flat()) {
    const v = num(root.querySelector(`[data-cal="${z}"]`)?.value)
    if (Number.isFinite(v) && v > -10 && v < 150) meas[z] = v
  }
  if (!Object.keys(meas).length) return void toast('APUNTA ALGUNA TEMPERATURA')
  const mins = Math.max(0, num(root.querySelector('[data-k="calMins"]')?.value) || 0)
  const id = root.querySelector('[data-k="calSess"]')?.value
  const L = logger()
  const m = L && id ? (await L.list()).find((x) => x.id === id) : null
  if (!m) return void toast('ELIGE UNA SALIDA')
  const s = await L.read(m)
  const full = seriesFromCalc(s.calc)
  if (full.n < 1200) return void toast('SALIDA DEMASIADO CORTA')
  const cur = st()
  let env = { tAir: Number(cur.airManual) || 15 }
  if (cur.weather) {
    const p = firstFix(s.gps)
    const w = p ? await weatherAt(p.lat, p.lon, m.start + (full.n * full.dt * 1000) / 2) : null
    if (w) env = w
  }
  env.tRoad = roadTemp(env)
  // La caja negra sigue grabando unos minutos parada: esos ya cuentan
  const extra = Math.max(0, mins - trailingStop(full) / 60)
  const r = calibrate(decimate(full, 5), cur, env, meas, { after: extra })
  if (!r) return null
  const cal = { at: Date.now(), id: m.id, date: m.start, k: Math.round(r.k * 1000) / 1000, err0: r.before, err1: r.after, n: r.n, mins, tAir: env.tAir, meas }
  const cals = [...(cur.cals || []).filter((c) => c.id !== m.id), cal].slice(-8)
  setTires({ cals, k: Math.round(combinedK(cals) * 1000) / 1000 })
  return cal
}
