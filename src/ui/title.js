// Pantalla de título ("toca para empezar") y ficha del piloto.
import { settings, setSetting } from '../core/store.js'
import { sfx } from '../core/audio.js'
import { $, $$, esc, layer } from './util.js'
import { bikeSvg } from './pixel.js'
import { isIOS, isStandalone } from '../core/device.js'

const COLORS = ['#ff2e88', '#22e3ff', '#ffd23f', '#3dff7a', '#ff8a1f', '#9d8cff', '#ff3b3b', '#f4f1ff']

/**
 * Muestra el título. Con `onStart` espera un toque (los permisos de la primera vez lo exigen);
 * con `auto` solo saluda unos milisegundos y se va solo (o al tocar).
 */
export function showTitle(onStart, { auto = 0 } = {}) {
  const el = layer(
    `<div class="sun"></div><div class="floor"></div>
     <div class="logo">
       ${bikeSvg(settings.color)}
       <h1>STREET<span>CHAOS</span></h1>
       <div class="press ${auto ? '' : 'blink'}">${auto ? `HOLA, ${esc(settings.name || 'PILOTO')}` : 'TOCA PARA EMPEZAR'}</div>
     </div>`,
    'titlescreen solid',
  )
  let gone = false
  const go = () => {
    if (gone) return
    gone = true
    onStart?.()
    el.classList.add('out')
    setTimeout(() => el.remove(), 250)
    if (!settings.onboarded) editRider(() => {}, true)
  }
  el.addEventListener('click', go, { once: true })
  if (auto) setTimeout(go, auto)
}

export function editRider(onSave, first = false) {
  let color = settings.color
  let units = settings.units
  const el = layer(
    `<div class="panel modal">
      <h2 class="title">${first ? 'NUEVO PILOTO' : 'TU PILOTO'}</h2>
      <div data-k="sprite" style="justify-self:center;width:140px">${bikeSvg(color)}</div>
      <label class="field"><span class="lbl">Nombre (lo veran tus rivales)</span><input data-k="name" maxlength="10" value="${esc(settings.name)}" placeholder="PILOTO" autocomplete="off" autocapitalize="characters"></label>
      <label class="field"><span class="lbl">Tu moto</span><input data-k="bike" maxlength="14" value="${esc(settings.bike)}" placeholder="MT-07, R6..." autocomplete="off" autocapitalize="characters"></label>
      <div class="field"><span class="lbl">Color</span><div class="swatches">${COLORS.map((c) => `<button class="swatch ${c === color ? 'on' : ''}" style="--c:${c}" data-c="${c}" aria-label="Color ${c}"></button>`).join('')}</div></div>
      <div class="field"><span class="lbl">Unidades</span><div class="chips"><button class="chip ${units === 'kmh' ? 'on' : ''}" data-u="kmh">KM/H</button><button class="chip ${units === 'mph' ? 'on' : ''}" data-u="mph">MPH</button></div></div>
      ${first ? `<div class="tip">Cuando el móvil pregunte, elige <b>Permitir mientras se usa la app</b> para la ubicación y <b>Permitir</b> para el movimiento: así no vuelve a preguntar.${isIOS() && !isStandalone() ? ' En iPhone, añádela a la pantalla de inicio (Compartir → Añadir a pantalla de inicio) para que recuerde los permisos.' : ''}</div>` : ''}
      <div class="actions"><button class="btn" data-k="ok">${first ? '¡A RODAR!' : 'GUARDAR'}</button></div>
    </div>`,
  )
  $$(el, '[data-c]').forEach((b) =>
    b.addEventListener('click', () => {
      sfx.click()
      color = b.dataset.c
      $$(el, '[data-c]').forEach((x) => x.classList.toggle('on', x === b))
      $(el, '[data-k="sprite"]').innerHTML = bikeSvg(color)
    }),
  )
  $$(el, '[data-u]').forEach((b) =>
    b.addEventListener('click', () => {
      sfx.click()
      units = b.dataset.u
      $$(el, '[data-u]').forEach((x) => x.classList.toggle('on', x === b))
    }),
  )
  $(el, '[data-k="ok"]').addEventListener('click', () => {
    sfx.click()
    const clean = (s) => s.trim().toUpperCase().replace(/\s+/g, ' ')
    setSetting('name', clean($(el, '[data-k="name"]').value) || 'PILOTO')
    setSetting('bike', clean($(el, '[data-k="bike"]').value))
    setSetting('color', color)
    setSetting('units', units)
    setSetting('onboarded', true)
    el.remove()
    onSave()
  })
}
