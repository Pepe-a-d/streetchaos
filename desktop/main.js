// Blackbox Street Chaos para Windows y Mac: el Blackbox de la web empaquetado dentro de la app, servido
// desde app://local para que funcione sin conexión (salvo el mapa y la nube) y con sus datos guardados
// en la propia app. Abre cada parte en su ventana y las reparte en tus pantallas (windows.js).
// - Windows: se actualiza sola (electron-updater, desde las Releases de GitHub).
// - Mac: sin firma de Apple no se puede actualizar sola: al abrirla mira si hay versión nueva y te
//   ofrece bajarla (updates.js).
const { app, BrowserWindow, protocol, net, ipcMain, Menu, shell } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const views = require('./windows.js')
const { checkMacUpdate } = require('./updates.js')
const MAC = process.platform === 'darwin'

const ROOT = path.join(__dirname, 'app')
const BASE = 'app://local/blackbox/index.html'
const PRELOAD = path.join(__dirname, 'preload.js')

// app:// se porta como una web segura: IndexedDB, workers, fetch con CORS...
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }])

// Una sola instancia: si la abres otra vez, se trae delante la que ya estaba
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  const w = views.wins.get('todo')
  if (w) (w.isMinimized() && w.restore(), w.focus())
})

function menu() {
  const open = (v) => () => views.openView(v, `${BASE}?vista=${v}`, { preload: PRELOAD })
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      // En el Mac: el menú de la app (Acerca de, Ocultar, Salir con ⌘Q) y Edición (copiar y pegar en los
      // campos de texto, que si no, no funcionan)
      ...(MAC
        ? [
            {
              label: app.name,
              submenu: [
                { role: 'about', label: `Acerca de ${app.name}` },
                { label: 'Buscar actualizaciones…', click: () => checkMacUpdate({ quiet: false }) },
                { type: 'separator' },
                { role: 'hide', label: `Ocultar ${app.name}` },
                { role: 'hideOthers', label: 'Ocultar otras' },
                { role: 'unhide', label: 'Mostrar todo' },
                { type: 'separator' },
                { role: 'quit', label: `Salir de ${app.name}` },
              ],
            },
            {
              label: 'Edición',
              submenu: [
                { role: 'undo', label: 'Deshacer' },
                { role: 'redo', label: 'Rehacer' },
                { type: 'separator' },
                { role: 'cut', label: 'Cortar' },
                { role: 'copy', label: 'Copiar' },
                { role: 'paste', label: 'Pegar' },
                { role: 'selectAll', label: 'Seleccionar todo' },
              ],
            },
          ]
        : []),
      {
        label: 'Ventanas',
        submenu: [
          { label: 'Repartir en mis pantallas', accelerator: 'CmdOrCtrl+Shift+R', click: () => views.spread({ base: BASE, preload: PRELOAD }) },
          { type: 'separator' },
          { label: 'Mapa en otra ventana', accelerator: 'CmdOrCtrl+1', click: open('mapa') },
          { label: 'Gráficas en otra ventana', accelerator: 'CmdOrCtrl+2', click: open('graficas') },
          { label: 'Datos en otra ventana', accelerator: 'CmdOrCtrl+3', click: open('datos') },
          { label: 'Vídeo en otra ventana', accelerator: 'CmdOrCtrl+4', click: open('video') },
          { type: 'separator' },
          { label: 'Pantalla completa', role: 'togglefullscreen' },
          { label: 'Minimizar', role: 'minimize' },
        ],
      },
      {
        label: 'Ver',
        submenu: [
          { label: 'Recargar', role: 'reload' },
          { label: 'Acercar', role: 'zoomIn' },
          { label: 'Alejar', role: 'zoomOut' },
          { label: 'Tamaño normal', role: 'resetZoom' },
          { type: 'separator' },
          { label: 'Herramientas de desarrollo', role: 'toggleDevTools' },
        ],
      },
      { label: 'Ayuda', submenu: [{ label: 'Street Chaos en la web', click: () => shell.openExternal('https://pepe-a-d.github.io/streetchaos/blackbox/') }] },
    ]),
  )
}

// Prueba rápida sin enseñar nada: npm start -- --smoke (abre, comprueba y se cierra)
const SMOKE = process.argv.includes('--smoke')

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const u = new URL(req.url)
    let p = decodeURIComponent(u.pathname)
    if (p.endsWith('/')) p += 'index.html'
    const file = path.normalize(path.join(ROOT, p))
    if (!file.startsWith(ROOT)) return new Response('No', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
  views.load(app.getPath('userData'))
  ipcMain.handle('spread', () => views.spread({ base: BASE, preload: PRELOAD }))
  ipcMain.handle('version', () => app.getVersion())
  menu()
  const main = views.openView('todo', BASE, { preload: PRELOAD, hidden: SMOKE })
  if (SMOKE) {
    main.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 2500))
      const r = await main.webContents.executeJavaScript('({ bb: !!window.__bb, app: !!window.bbDesktop, title: document.title, rides: window.__bb?.S.list.length, idb: typeof indexedDB, worker: typeof Worker })').catch((e) => ({ error: String(e) }))
      // Abrir el mapa en otra ventana (como el botón) y repartir
      await main.webContents.executeJavaScript("window.open(location.pathname + '?vista=mapa', 'sc-bb-mapa')").catch(() => {})
      await new Promise((r2) => setTimeout(r2, 2500))
      const mapa = views.wins.get('mapa')
      r.mapa = mapa ? await mapa.webContents.executeJavaScript('({ vista: document.body.dataset.vista, title: document.title })').catch((e) => String(e)) : null
      // La ventana del vídeo y qué vídeos sabe reproducir (H.264 y HEVC, el de las GoPro modernas)
      await main.webContents.executeJavaScript("window.open(location.pathname + '?vista=video', 'sc-bb-video')").catch(() => {})
      await new Promise((r2) => setTimeout(r2, 2500))
      const video = views.wins.get('video')
      r.video = video ? await video.webContents.executeJavaScript('({ vista: document.body.dataset.vista, panel: !document.querySelector(\'[data-k="vid"]\').hidden })').catch((e) => String(e)) : null
      r.codecs = await main.webContents.executeJavaScript(`(() => { const v = document.createElement('video'); return { h264: v.canPlayType('video/mp4; codecs="avc1.640028"'), hevc: v.canPlayType('video/mp4; codecs="hvc1.1.6.L150.B0"') } })()`).catch((e) => String(e))
      r.spread = await views.spread({ base: BASE, preload: PRELOAD })
      await new Promise((r2) => setTimeout(r2, 1500))
      r.windows = [...views.wins.keys()]
      console.log('SMOKE', JSON.stringify(r))
      app.quit()
    })
  }
  // Se actualiza sola con las versiones nuevas que se publiquen en GitHub (solo instalada)
  if (app.isPackaged && process.platform === 'win32') {
    try {
      require('electron-updater').autoUpdater.checkForUpdatesAndNotify()
    } catch {}
  }
  // En el Mac, avisa si hay una versión nueva (a los 8 s, para no estorbar al abrir)
  if (app.isPackaged && MAC && !SMOKE) setTimeout(() => checkMacUpdate({ quiet: true }), 8000)
})

// En el Mac, cerrar todas las ventanas no cierra la app (como el resto de apps del Mac): el Dock la vuelve a abrir
app.on('window-all-closed', () => !MAC && app.quit())
app.on('activate', () => {
  if (!BrowserWindow.getAllWindows().length) views.openView('todo', BASE, { preload: PRELOAD })
})
