// Aviso de versión nueva en el Mac. Sin la firma de Apple (cuesta 99 € al año) el Mac no deja que una app
// se cambie a sí misma, así que no puede actualizarse sola como la de Windows: al abrirla mira la última
// versión publicada en GitHub y, si es más nueva, ofrece abrir la página de descarga.
const { app, dialog, net, shell, BrowserWindow } = require('electron')

const LATEST = 'https://api.github.com/repos/Pepe-a-d/streetchaos/releases/latest'
const PAGE = 'https://pepe-a-d.github.io/streetchaos/blackbox/descargar/'

/** «2.10.0» > «2.9.3»: compara versiones por partes. */
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number)
  const pb = String(b).replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  return false
}

async function checkMacUpdate({ quiet = true } = {}) {
  let latest = null
  try {
    const r = await net.fetch(LATEST, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Blackbox-StreetChaos' } })
    if (r.ok) latest = (await r.json()).tag_name
  } catch {}
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  if (!latest) {
    if (!quiet) dialog.showMessageBox(win, { type: 'warning', message: 'No se pudo mirar si hay versión nueva', detail: 'Comprueba la conexión e inténtalo otra vez.' })
    return null
  }
  if (!newer(latest, app.getVersion())) {
    if (!quiet) dialog.showMessageBox(win, { type: 'info', message: 'Tienes la última versión', detail: `Blackbox Street Chaos ${app.getVersion()}` })
    return false
  }
  const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    buttons: ['Descargar', 'Ahora no'],
    defaultId: 0,
    cancelId: 1,
    message: `Hay una versión nueva: ${latest.replace(/^v/, '')}`,
    detail: `Tienes la ${app.getVersion()}. Bájala y arrástrala a Aplicaciones (sustituye a esta; tus salidas no se tocan).`,
  })
  if (response === 0) shell.openExternal(PAGE)
  return true
}

module.exports = { checkMacUpdate, newer }
