// Pantalla negra: la app sigue abierta y en primer plano, así que sigue grabando (GPS, sensores,
// crono, caja negra y subida), pero con la pantalla en negro para gastar poca batería (en las
// pantallas OLED el negro apaga los píxeles) y sin hacer caso a los toques. Se sale manteniendo
// pulsado. Mientras está puesta, la app deja de dibujar lo que hay debajo.
import { logger } from '../core/logger.js'

const HOLD = 1.6 // s pulsando para salir
export const blackout = { on: false }

export function showBlackout(onExit = () => {}) {
  if (blackout.on) return
  blackout.on = true
  const el = document.createElement('div')
  el.className = 'blackout'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-label', 'Pantalla negra: mantén pulsado para salir')
  el.innerHTML = `
    <div class="bo-dot" data-k="dot"><i></i><span data-k="txt">REC</span></div>
    <div class="bo-hint" data-k="hint">MANTEN PULSADO PARA SALIR</div>
    <svg class="bo-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44"/></svg>`
  document.body.append(el)
  const dot = el.querySelector('[data-k="dot"]')
  const txt = el.querySelector('[data-k="txt"]')
  const hint = el.querySelector('[data-k="hint"]')
  const ring = el.querySelector('.bo-ring')

  // Aviso de cómo salir: al entrar y con cada toque, unos segundos
  let hintTimer = 0
  const showHint = () => {
    hint.style.opacity = '1'
    clearTimeout(hintTimer)
    hintTimer = setTimeout(() => (hint.style.opacity = '0'), 2500)
  }
  showHint()

  // Punto de grabación: tenue, y cambia de sitio cada poco para no marcar la pantalla
  const place = () => {
    dot.style.left = `${10 + Math.random() * 70}%`
    dot.style.top = `${10 + Math.random() * 70}%`
  }
  const status = () => {
    const rec = logger()?.recording
    dot.classList.toggle('idle', !rec)
    txt.textContent = rec ? 'REC' : 'LISTO'
  }
  place()
  status()
  const timers = [setInterval(place, 30000), setInterval(status, 2000)]

  // Salir: mantener pulsado (los toques sueltos no hacen nada)
  let hold = 0
  const start = (e) => {
    e.preventDefault()
    showHint()
    ring.style.left = `${e.clientX}px`
    ring.style.top = `${e.clientY}px`
    el.classList.remove('holding')
    void ring.getBoundingClientRect() // reinicia la animación del aro
    el.classList.add('holding')
    clearTimeout(hold)
    hold = setTimeout(exit, HOLD * 1000)
  }
  const cancel = () => {
    clearTimeout(hold)
    el.classList.remove('holding')
  }
  el.addEventListener('pointerdown', start)
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, cancel)
  // Que no haga scroll, zoom ni menú contextual
  for (const ev of ['touchstart', 'touchmove', 'contextmenu', 'gesturestart']) el.addEventListener(ev, (e) => e.preventDefault(), { passive: false })
  const onKey = (e) => e.key === 'Escape' && exit()
  addEventListener('keydown', onKey)

  function exit() {
    if (!blackout.on) return
    blackout.on = false
    timers.forEach(clearInterval)
    clearTimeout(hold)
    clearTimeout(hintTimer)
    removeEventListener('keydown', onKey)
    el.remove()
    onExit()
  }
  return exit
}
