// El contacto en la pantalla: la llave de la barra de arriba (en todas las pestañas) y el DASH apagado.
// Parado, un toque en la llave da o quita el contacto; en marcha, para quitarlo hay que mantenerla
// pulsada (que un roce con el guante no te cierre la ruta).
import { ignitionOn, setIgnition, onIgnition } from '../core/ignition.js'
import { T, signalBars } from '../core/telemetry.js'
import { sfx } from '../core/audio.js'
import { pixelSvg } from './pixel.js'
import { bootSweep } from './widgets.js'
import { html, setter, toast } from './util.js'

export const KEY = pixelSvg(['.XXX.......', 'X...X......', 'X.X.XXXXXXX', 'X...X...X.X', '.XXX.......'], { X: 'currentColor' })
const HOLD = 1.2 // s pulsada para quitarlo en marcha

export function mountIgnition({ dash, keyBtn, onLast }) {
  const over = html(`<div class="ign-off" hidden>
    <div class="ign-panel">
      <span class="lbl">CONTACTO</span>
      <button class="ign-key" data-k="start" aria-label="Dar el contacto">${KEY}<b>ARRANCAR</b></button>
      <p class="ign-hint">Dalo al empezar la ruta y quítalo con la llave de arriba al terminar: así solo se graba de verdad la salida, no mientras colocas el móvil.</p>
      <div class="ign-gps"><div class="bars" data-n="0"><i></i><i></i><i></i><i></i></div><span data-k="gps">GPS</span></div>
      <button class="btn ghost small ign-last" data-k="last" hidden></button>
    </div>
  </div>`)
  dash.append(over)
  const k = (n) => over.querySelector(`[data-k="${n}"]`)
  const set = setter()
  let last = null

  function render() {
    const on = ignitionOn()
    over.hidden = on
    document.body.classList.toggle('key-off', !on)
    keyBtn.classList.toggle('on', on)
    keyBtn.setAttribute('aria-label', on ? 'Quitar el contacto' : 'Dar el contacto')
    keyBtn.title = on ? 'Quitar el contacto (cierra la ruta)' : 'Dar el contacto'
  }

  function turn(on) {
    if (on) {
      setIgnition(true)
      return
    }
    setIgnition(false)
  }

  k('start').addEventListener('click', () => turn(true))
  k('last').addEventListener('click', () => last && onLast?.(last))

  // La llave de arriba: toque parado; en marcha, mantener pulsada para quitarlo
  let hold = null
  const cancel = () => {
    if (!hold) return
    clearTimeout(hold.timer)
    keyBtn.classList.remove('holding')
    hold = null
  }
  keyBtn.addEventListener('pointerdown', (e) => {
    if (!ignitionOn() || T.v < 2) return
    e.preventDefault()
    keyBtn.classList.add('holding')
    hold = { timer: setTimeout(() => (cancel(), turn(false)), HOLD * 1000), done: false }
  })
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) keyBtn.addEventListener(ev, cancel)
  keyBtn.addEventListener('click', () => {
    if (ignitionOn() && T.v >= 2) return toast('EN MARCHA: MANTEN PULSADA LA LLAVE PARA QUITAR EL CONTACTO', 3500)
    turn(!ignitionOn())
  })

  onIgnition((on, { auto }) => {
    render()
    if (on) {
      bootSweep()
      sfx.armed()
      if (auto) toast('CONTACTO DADO SOLO: VAS EN MOTO', 4000)
    } else sfx.done()
  })
  render()

  return {
    /** La última salida (para el botón «ver» del DASH apagado). */
    setLast(summary) {
      last = summary
      const b = k('last')
      b.hidden = !summary
      if (summary) b.textContent = summary.label
    },
    frame() {
      if (ignitionOn()) return
      set(over.querySelector('.bars'), String(signalBars()), 'data-n')
      set(k('gps'), T.status === 'ok' ? `GPS ±${Math.round(T.acc)} M · LISTO` : T.status === 'denied' ? 'GPS SIN PERMISO' : 'BUSCANDO GPS')
    },
  }
}
