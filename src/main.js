// Entrada: fuentes, estilos y alto de pantalla.
// - En el ordenador se abre el Blackbox (el analizador): la app es para el móvil. Con ?app se queda
//   en la app (para probarla en el ordenador), y lo recuerda mientras dure la pestaña.
// - En el iPhone, si se abre en Safari en vez de desde la pantalla de inicio, solo se enseña cómo
//   instalarla; si no, se carga la app (app.js).
import '@fontsource/press-start-2p'
import '@fontsource/vt323'
import './style.css'
import { fitScreen, mustInstall, isDesktop } from './core/device.js'
import { showInstallGate } from './ui/install.js'

function wantsApp() {
  try {
    if (new URLSearchParams(location.search).has('app')) sessionStorage.setItem('sc-desktop-app', '1')
    return sessionStorage.getItem('sc-desktop-app') === '1'
  } catch {
    return false
  }
}

if (isDesktop() && !wantsApp()) {
  window.__scBooted = true
  location.replace(`${import.meta.env.BASE_URL}blackbox/${location.hash}`)
} else {
  fitScreen()
  if (mustInstall()) {
    showInstallGate()
    // No es un fallo de arranque: que no salga el modo rescate
    window.__scBooted = true
  } else import('./app.js')
}
