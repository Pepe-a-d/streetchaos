// Datos del dispositivo y de los permisos que da el navegador.

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

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
