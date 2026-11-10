// Franja del DASH para los tramos y las vueltas en directo: aparece sola al cruzar la salida, con el
// tiempo y la diferencia con tu mejor (verde si vas por delante, rojo si por detrás), y al acabar enseña
// el resultado unos segundos.
import { live } from '../core/segments.js'
import { fmtLap } from '../core/tripsum.js'
import { html, setter } from './util.js'

const plain = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
export const fmtDelta = (d) => (Number.isFinite(d) ? `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}` : '')

export function mountLiveStrip(dash) {
  const el = html(`<div class="live-strip" hidden><span class="ls-name" data-k="name"></span><b class="ls-time seg" data-k="time"></b><b class="ls-delta" data-k="delta"></b></div>`)
  dash.append(el)
  const k = (n) => el.querySelector(`[data-k="${n}"]`)
  const set = setter()
  return {
    frame() {
      const now = performance.now() / 1000
      const cur = live.cur
      const last = live.last && now - live.last.at < 6 ? live.last : null
      el.hidden = !cur && !last
      if (el.hidden) return
      if (cur && !(last && last.name === cur.name && now - last.at < 4)) {
        set(k('name'), cur.kind === 'lap' ? `VUELTA ${cur.n}` : plain(cur.name))
        set(k('time'), fmtLap(Math.max(0, now - cur.t0)))
        // El delta, cuando ya hay algo de recorrido con el que compararse
        const d = cur.d > 50 ? cur.delta : NaN
        set(k('delta'), fmtDelta(d))
        el.dataset.s = !Number.isFinite(d) ? '' : d < 0 ? 'ahead' : 'behind'
      } else {
        set(k('name'), last.kind === 'lap' ? `VUELTA ${last.n}` : plain(last.name))
        set(k('time'), fmtLap(last.time))
        set(k('delta'), last.record ? 'RECORD' : Number.isFinite(last.best) ? fmtDelta(last.time - last.best) : '')
        el.dataset.s = last.record ? 'record' : 'behind'
      }
    },
  }
}
