// Fin de la salida: el resumen en pantalla (como el ordenador de viaje de la moto) con lo mejor del día y
// el botón para compartirlo como imagen.
import { settings } from '../core/store.js'
import { logger } from '../core/logger.js'
import { drawCard, shareCanvas } from '../core/card.js'
import { fmtDur, fmtLap } from '../core/tripsum.js'
import { cssColor } from './themes.js'
import { esc, layer, toast, toSpeed, speedUnit, toDist, distUnit } from './util.js'
import { sfx } from '../core/audio.js'

const day = (ms) => {
  const t = new Date(ms).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })
  return t.charAt(0).toUpperCase() + t.slice(1)
}
const hour = (ms) => new Date(ms).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
const plain = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()

/** Las cifras de la salida: [etiqueta, valor] (en la pantalla y en la tarjeta). */
export function tripStats(s) {
  const lean = Math.max(s.leanL, s.leanR)
  return [
    ['DISTANCIA', `${toDist(s.dist).toFixed(1)} ${distUnit()}`],
    ['TIEMPO', fmtDur(s.dur)],
    ['PUNTA', `${Math.round(toSpeed(s.vmax))} ${speedUnit()}`],
    ['MEDIA EN MARCHA', s.moving > 30 ? `${Math.round(toSpeed(s.dist / s.moving))} ${speedUnit()}` : '—'],
    ['INCLINACION I·D', lean > 3 ? `${Math.round(s.leanL)}°·${Math.round(s.leanR)}°` : '—'],
    [s.brakeMax >= 0.2 ? 'FRENADA MAX' : 'PARADAS', s.brakeMax >= 0.2 ? `${s.brakeMax.toFixed(2)} G` : `${s.stops}`],
  ]
}

export function showTrip(s) {
  if (!s) return
  const stats = tripStats(s)
  const el = layer(
    `<div class="panel sheet trip">
      <header class="sh-head"><h3 class="title">FIN DE LA SALIDA</h3><button class="sh-x" data-close aria-label="Cerrar">×</button></header>
      <div class="sh-body">
        <p class="trip-when">${esc(day(s.start))} · ${hour(s.start)}</p>
        <div class="trip-grid">${stats.map(([l, v]) => `<div><span class="lbl">${l}</span><b>${esc(v)}</b></div>`).join('')}</div>
        ${s.stops ? `<p class="trip-stops">${s.stops} ${s.stops === 1 ? 'parada' : 'paradas'} · ${fmtDur(s.stopped)} parado</p>` : ''}
        ${s.highlights.length ? `<h4 class="lbl">LO MEJOR DE HOY</h4><ul class="trip-hl">${s.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
        ${s.results?.length ? `<h4 class="lbl">TRAMOS Y VUELTAS</h4><ul class="trip-hl">${s.results.map((r) => `<li>${r.kind === 'lap' ? `Vuelta ${r.n}` : esc(r.name)}: <b>${fmtLap(r.time)}</b>${r.record ? ' · récord' : Number.isFinite(r.best) ? ` · +${(r.time - r.best).toFixed(1)} s` : ''}</li>`).join('')}</ul>` : ''}
        <div class="trip-btns"><button class="btn cyan" data-k="share">COMPARTIR TARJETA</button></div>
      </div>
    </div>`,
    'sheet-layer',
  )
  el.querySelector('[data-k="share"]').addEventListener('click', async (e) => {
    const b = e.currentTarget
    b.disabled = true
    b.textContent = 'PREPARANDO…'
    try {
      const canvas = await tripCard(s)
      const r = await shareCanvas(canvas, `street-chaos-${new Date(s.start).toISOString().slice(0, 10)}.png`)
      if (r === 'downloaded') toast('TARJETA GUARDADA')
      sfx.done()
    } catch (err) {
      toast(`NO SE PUDO HACER LA TARJETA: ${err.message}`, 4000)
    } finally {
      b.disabled = false
      b.textContent = 'COMPARTIR TARJETA'
    }
  })
  el.addEventListener('click', (e) => e.target.closest('[data-close]') && el.remove())
  return el
}

/** La tarjeta de una salida, con su recorrido leído de la caja negra. */
export async function tripCard(s) {
  let track = []
  try {
    const L = logger()
    const meta = (await L.list()).find((m) => m.id === s.id)
    if (meta) {
      const { gps } = await L.read(meta)
      const W = 11
      for (let i = 0; i + W <= gps.length; i += W * 2) if (gps[i + 9] > 1) track.push([gps[i + 2], gps[i + 3]])
    }
  } catch {
    track = []
  }
  const colors = Object.fromEntries(['bg', 'ink', 'dim', 'pink', 'cyan', 'yellow', 'green'].map((k) => [k, cssColor(k)]).filter(([, v]) => /^#/.test(v)))
  return drawCard(
    {
      track,
      title: `${plain(day(s.start))} · ${hour(s.start)}`,
      stats: tripStats(s),
      highlights: s.highlights,
      who: [settings.name, settings.bike].filter(Boolean).join(' · '),
    },
    colors,
  )
}
