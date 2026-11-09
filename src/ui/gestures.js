// Gestos táctiles, como en una app del iPhone:
// - Deslizar desde el borde izquierdo hacia la derecha = volver: cierra la ventana que haya abierta, sale
//   del apartado del Garaje, sale del editor del DASH o vuelve al DASH desde otra pestaña.
// - Deslizar hacia abajo una ventana u hoja = cerrarla.
// Lo que se va a cerrar sigue al dedo; al soltar, si se pasó del umbral (o fue rápido), se va; si no, vuelve.
// Además: en el iPhone los botones no se ven pulsados sin un oyente de toques (por eso parecían no responder).

const EDGE = 30 // px desde el borde donde empieza el gesto de volver
const GO = 80 // px para que cuente
const FAST = 0.5 // px/ms: un deslizamiento rápido cuenta aunque sea corto
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** La ventana de arriba del todo y su botón de cerrar (solo se cierran con gesto las que tienen uno). */
function topLayer() {
  const ly = [...document.querySelectorAll('.layer')].at(-1)
  if (!ly) return null
  const closer = ly.querySelector('[data-close], [data-k="close"], [data-dismiss]')
  return { ly, closer, panel: ly.querySelector('.sheet, .modal, .panel') || ly.firstElementChild || ly }
}

/**
 * Qué hace «volver» ahora mismo: { el (lo que se mueve con el dedo), go() } o null.
 * Con una ventana abierta sin botón de cerrar (una carrera en marcha, el título), nada.
 */
function backTarget({ goTab, canLeave }) {
  const top = topLayer()
  if (top) return top.closer ? { el: top.panel, go: () => top.closer.click() } : null
  if (document.body.classList.contains('dash-edit')) {
    const done = document.querySelector('[data-ed="done"]')
    return done ? { el: document.getElementById('dash'), go: () => done.click(), soft: true } : null
  }
  const sub = document.querySelector('#garage.on .g-wrap.in-sub .g-page')
  if (sub) return { el: sub, go: () => document.querySelector('#garage.on [data-back]')?.click() }
  const tab = document.body.dataset.tab
  if (tab && tab !== 'dash' && canLeave()) return { el: document.getElementById(tab), go: () => goTab('dash') }
  return null
}

function settle(el, to, done) {
  el.style.transition = reduce() ? 'none' : 'transform 0.16s ease-out, opacity 0.16s ease-out'
  el.style.transform = to
  if (to !== '' && to !== 'none') el.style.opacity = '0.6'
  const end = () => {
    // Primero se cierra (para que no se vea volver a su sitio un instante) y luego se limpia
    done?.()
    el.style.transition = ''
    el.style.transform = ''
    el.style.opacity = ''
  }
  if (reduce()) end()
  else setTimeout(end, 170)
}

export function setupGestures({ goTab, canLeave = () => true }) {
  // Botones que se ven pulsados al tocarlos (iOS solo aplica :active si hay un oyente de toques)
  document.addEventListener('touchstart', () => {}, { passive: true })

  let g = null // gesto en curso
  document.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return (g = null)
      const t = e.touches[0]
      const x = t.clientX
      const y = t.clientY
      // Volver: desde el borde izquierdo
      if (x <= EDGE) {
        const target = backTarget({ goTab, canLeave })
        if (target) return (g = { kind: 'back', x0: x, y0: y, t0: e.timeStamp, ...target, dx: 0, on: false })
      }
      // Cerrar hacia abajo: en una ventana con botón de cerrar, empezando en su cabecera o con su contenido arriba del todo
      const top = topLayer()
      if (top?.closer && top.panel.contains(e.target)) {
        const scroller = e.target.closest('.sh-body, .sheet, .modal, .panel')
        const atTop = !scroller || scroller.scrollTop <= 0
        if (atTop && !e.target.closest('input, select, textarea, .no-swipe')) g = { kind: 'down', x0: x, y0: y, t0: e.timeStamp, el: top.panel, go: () => top.closer.click(), dy: 0, on: false }
      }
    },
    { passive: true },
  )
  document.addEventListener(
    'touchmove',
    (e) => {
      if (!g) return
      const t = e.touches[0]
      const dx = t.clientX - g.x0
      const dy = t.clientY - g.y0
      if (!g.on) {
        // Hasta que el gesto tiene dirección clara no se hace nada (si es un scroll, se suelta)
        if (Math.hypot(dx, dy) < 10) return
        const ok = g.kind === 'back' ? dx > Math.abs(dy) * 1.2 : dy > Math.abs(dx) * 1.2
        if (!ok) return (g = null)
        g.on = true
        g.el.style.transition = 'none'
        g.el.style.willChange = 'transform'
      }
      e.preventDefault()
      if (g.kind === 'back') {
        g.dx = Math.max(0, dx)
        g.el.style.transform = g.soft ? `translateX(${g.dx * 0.25}px)` : `translateX(${g.dx}px)`
      } else {
        g.dy = Math.max(0, dy)
        g.el.style.transform = `translateY(${g.dy}px)`
      }
    },
    { passive: false },
  )
  const end = (e) => {
    if (!g) return
    const cur = g
    g = null
    if (!cur.on) return
    cur.el.style.willChange = ''
    const d = cur.kind === 'back' ? cur.dx : cur.dy
    const v = d / Math.max(1, e.timeStamp - cur.t0)
    if (d > GO || (d > 30 && v > FAST)) {
      // Se va por donde iba y entonces se cierra
      settle(cur.el, cur.kind === 'back' ? (cur.soft ? '' : 'translateX(100%)') : 'translateY(100%)', cur.go)
    } else settle(cur.el, '')
  }
  document.addEventListener('touchend', end, { passive: true })
  document.addEventListener('touchcancel', end, { passive: true })
}
