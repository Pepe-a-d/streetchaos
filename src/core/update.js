// Actualizaciones de la app instalada. El service worker nuevo se instala solo, pero la app abierta
// sigue con el código viejo hasta recargar, y en el iPhone la app instalada casi nunca se recarga (al
// volver a ella sigue donde estaba). Aquí: al volver a la app se mira si hay versión nueva y, cuando
// la hay, se recarga en cuanto la moto esté parada (nunca en marcha ni en una pasada o un duelo).
import { T } from './telemetry.js'
import { toast } from '../ui/util.js'

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
const DONE = 'sc-updated'

let pending = false
export const updatePending = () => pending

/** Mira ya si hay versión nueva. */
export async function checkUpdate() {
  try {
    const r = await navigator.serviceWorker?.getRegistration()
    await r?.update()
    return !!(r?.waiting || r?.installing) || pending
  } catch {
    return pending
  }
}

const safeToReload = () => T.v < 0.5 && !document.body.classList.contains('racing')

export function setupUpdates() {
  if (!('serviceWorker' in navigator)) return
  // Si venimos de una recarga por actualización, se dice
  try {
    if (sessionStorage.getItem(DONE)) {
      sessionStorage.removeItem(DONE)
      setTimeout(() => toast(`APP ACTUALIZADA · ${APP_VERSION.split(' ')[0]}`, 3500), 1500)
    }
  } catch {}
  // Solo cuenta si ya había un service worker controlando (la primera instalación también lo cambia)
  const had = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (had) pending = true
  })
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkUpdate())
  setInterval(() => {
    if (!pending || !safeToReload()) return
    pending = false
    try {
      sessionStorage.setItem(DONE, '1')
    } catch {}
    location.reload()
  }, 3000)
}
