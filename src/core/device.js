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

/**
 * Alto real de la pantalla en `--app-h`. En el iPhone, instalada en la pantalla de inicio y con la barra
 * de estado transparente, iOS da un alto de ventana menor que la pantalla (le resta la barra de estado)
 * y quedaba una franja vacía abajo. Ahí se usa el alto de la pantalla, que es lo que se ve de verdad.
 */
export function fitScreen() {
  const root = document.documentElement
  const apply = () => {
    let h = window.innerHeight
    if (isIOS() && isStandalone()) {
      const land = window.innerWidth > window.innerHeight
      const sh = land ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height)
      // Solo si la diferencia es la de la barra de estado (no en una ventana partida del iPad)
      if (sh > h && sh - h <= 80) h = sh
    }
    root.style.setProperty('--app-h', `${h}px`)
  }
  apply()
  addEventListener('resize', apply)
  addEventListener('orientationchange', () => setTimeout(apply, 250))
  screen.orientation?.addEventListener?.('change', () => setTimeout(apply, 250))
  return apply
}
