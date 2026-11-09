// Datos del dispositivo y de los permisos que da el navegador.

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/**
 * Ordenador (Mac, Windows, Linux): ratón o trackpad como puntero principal y nada de móvil ni tableta.
 * Ahí la dirección de la app abre el Blackbox.
 */
export const isDesktop = () => !isIOS() && !/Android|Mobi|Tablet/i.test(navigator.userAgent) && !matchMedia('(pointer: coarse)').matches

/** Abierta desde la pantalla de inicio (instalada como app). */
export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true

/** 'granted' | 'prompt' | 'denied' | 'unknown' (si el navegador no lo dice). */
export async function geoPermission() {
  try {
    const p = await navigator.permissions.query({ name: 'geolocation' })
    return p.state
  } catch {
    return 'unknown'
  }
}

/** Identificador anónimo de este móvil (para agrupar los envíos de datos). */
export function deviceId() {
  try {
    let id = localStorage.getItem('sc-device')
    if (!id) {
      id = Math.random().toString(36).slice(2, 12)
      localStorage.setItem('sc-device', id)
    }
    return id
  } catch {
    return 'sin-id'
  }
}

/**
 * Hay que instalarla: en iPhone/iPad, abierta en Safari (o en otro navegador) en vez de desde la
 * pantalla de inicio. Ahí el GPS, los sensores y la pantalla completa no van bien, y lo que se guarda
 * en Safari no lo ve la app instalada.
 */
export const mustInstall = () => isIOS() && !isStandalone()

/** Lo que mide de alto un elemento con `height: <unidad>` (100lvh, 100dvh...), o 0. */
function measure(unit) {
  const el = document.createElement('div')
  el.style.cssText = `position:fixed;top:0;left:0;width:1px;visibility:hidden;pointer-events:none;height:${unit}`
  document.documentElement.append(el)
  const h = el.getBoundingClientRect().height
  el.remove()
  return h || 0
}

/** Medidas de la pantalla (para Garaje → Versión, por si algo no encaja). */
export function screenInfo() {
  const cs = getComputedStyle(document.documentElement)
  return {
    inner: `${innerWidth}×${innerHeight}`,
    screen: `${screen.width}×${screen.height}`,
    lvh: Math.round(measure('100lvh')),
    dvh: Math.round(measure('100dvh')),
    vv: Math.round(visualViewport?.height ?? 0),
    appH: cs.getPropertyValue('--app-h').trim(),
    safe: ['top', 'right', 'bottom', 'left'].map((k) => Math.round(measure(`env(safe-area-inset-${k}, 0px)`))).join('/'),
    standalone: isStandalone(),
    mode: ['fullscreen', 'standalone', 'minimal-ui', 'browser'].find((m) => matchMedia(`(display-mode: ${m})`).matches) || '?',
  }
}

/**
 * Alto real de la pantalla en `--app-h`. En el iPhone instalado (iOS 26, con la barra de estado
 * transparente), la ventana sale más baja que la pantalla: innerHeight, 100% y 100dvh pierden lo que
 * mide la barra de estado y quedaba una franja vacía abajo (fallo de WebKit 301108). 100lvh sí da el
 * alto entero; si tampoco, el alto de la pantalla. Se usa el mayor.
 */
export function fitScreen() {
  const root = document.documentElement
  const apply = () => {
    let h = window.innerHeight
    if (isStandalone()) h = Math.max(h, measure('100lvh'))
    if (isIOS() && isStandalone()) {
      const land = window.innerWidth > window.innerHeight
      const sh = land ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height)
      // Solo si la diferencia es la de la barra de estado (no en una ventana partida del iPad)
      if (sh > h && sh - h <= 80) h = sh
    }
    root.style.setProperty('--app-h', `${Math.round(h)}px`)
  }
  apply()
  // Al arrancar desde el icono, iOS a veces da las medidas buenas un instante después
  setTimeout(apply, 300)
  setTimeout(apply, 1200)
  addEventListener('resize', apply)
  addEventListener('orientationchange', () => setTimeout(apply, 250))
  screen.orientation?.addEventListener?.('change', () => setTimeout(apply, 250))
  return apply
}
