// Ventanas de la app de escritorio: una por parte del Blackbox (la principal con todo, y el mapa, las
// gráficas o los datos sueltos), cada una en la pantalla donde la dejes. Se recuerda dónde estaba cada
// una y, con «Repartir en mis pantallas», se colocan solas: la principal en tu pantalla, el mapa y las
// gráficas en las otras.
const { BrowserWindow, screen, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const NAMES = { todo: 'Blackbox', mapa: 'Mapa', graficas: 'Gráficas', datos: 'Datos', video: 'Vídeo' }
const SMOKE = process.argv.includes('--smoke') // prueba sin enseñar ventanas
const wins = new Map() // vista → BrowserWindow
let statePath = null
let state = {}

function load(userData) {
  statePath = path.join(userData, 'ventanas.json')
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  } catch {
    state = {}
  }
}
let saveTimer = null
function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
    } catch {}
  }, 400)
}

/** ¿Se ve todavía en alguna pantalla? (si desenchufas un monitor, la ventana vuelve a la principal) */
function visible(b) {
  return b && screen.getAllDisplays().some((d) => b.x < d.bounds.x + d.bounds.width - 80 && b.x + b.width > d.bounds.x + 80 && b.y >= d.bounds.y - 20 && b.y < d.bounds.y + d.bounds.height - 80)
}

function remember(vista, win) {
  const keep = () => {
    if (win.isDestroyed() || win.isMinimized()) return
    state[vista] = { ...(win.isMaximized() || win.isFullScreen() ? state[vista] : win.getBounds()), maximized: win.isMaximized(), full: win.isFullScreen() }
    save()
  }
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, keep)
}

/** Abre (o trae delante) la ventana de una vista. url: la página a cargar. */
function openView(vista, url, { preload, bounds = null, hidden = false } = {}) {
  let win = wins.get(vista)
  if (win && !win.isDestroyed()) {
    if (bounds) place(win, bounds)
    win.show()
    win.focus()
    return win
  }
  const saved = state[vista]
  const b = bounds || (visible(saved) ? saved : null)
  win = new BrowserWindow({
    title: NAMES[vista],
    x: b?.x,
    y: b?.y,
    width: b?.width || (vista === 'todo' ? 1400 : 1200),
    height: b?.height || (vista === 'todo' ? 900 : 800),
    minWidth: 640,
    minHeight: 420,
    backgroundColor: '#0a0618',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  })
  wins.set(vista, win)
  win.once('ready-to-show', () => {
    if (hidden || SMOKE) return
    if (bounds?.max || (!bounds && saved?.maximized)) win.maximize()
    if (!bounds && saved?.full) win.setFullScreen(true)
    win.show()
  })
  win.on('closed', () => wins.delete(vista))
  remember(vista, win)
  // Enlaces de fuera (créditos del mapa, la web...): en el navegador
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    const v = new URL(u).searchParams.get('vista')
    if (u.startsWith('app://') && v && NAMES[v]) {
      openView(v, u, { preload })
      return { action: 'deny' }
    }
    if (/^https?:/.test(u)) shell.openExternal(u)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, u) => {
    if (u.startsWith('app://')) return
    e.preventDefault()
    if (/^https?:/.test(u)) shell.openExternal(u)
  })
  win.loadURL(url)
  return win
}

function place(win, b) {
  if (win.isFullScreen()) win.setFullScreen(false)
  if (win.isMaximized()) win.unmaximize()
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height })
  if (b.max) win.maximize()
}

/**
 * Reparte: la principal en la pantalla donde está; el mapa y las gráficas en las demás (de izquierda a
 * derecha). Con dos pantallas, mapa y gráficas comparten la otra; con una, se reparte esa.
 */
function spread({ base, preload }) {
  const main = wins.get('todo')
  const displays = screen.getAllDisplays().sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
  const here = main ? screen.getDisplayMatching(main.getBounds()) : screen.getPrimaryDisplay()
  const others = displays.filter((d) => d.id !== here.id)
  const id = (v) => `${base}?vista=${v}`
  const wa = (d) => ({ ...d.workArea, max: true })
  if (others.length >= 2) {
    if (main) place(main, wa(here))
    openView('mapa', id('mapa'), { preload, bounds: wa(others[0]) })
    openView('graficas', id('graficas'), { preload, bounds: wa(others[1]) })
    return { screens: displays.length }
  }
  const half = (d, side) => ({ x: d.x + (side ? Math.round(d.width / 2) : 0), y: d.y, width: Math.round(d.width / 2), height: d.height, max: false })
  if (others.length === 1) {
    if (main) place(main, wa(here))
    const o = wa(others[0])
    openView('mapa', id('mapa'), { preload, bounds: half(o, 0) })
    openView('graficas', id('graficas'), { preload, bounds: half(o, 1) })
    return { screens: 2 }
  }
  // Una sola pantalla: la principal a la izquierda y el mapa y las gráficas a la derecha
  const d = wa(here)
  if (main) {
    if (main.isMaximized()) main.unmaximize()
    main.setBounds(half(d, 0))
  }
  const right = half(d, 1)
  openView('mapa', id('mapa'), { preload, bounds: { ...right, height: Math.round(right.height / 2) } })
  openView('graficas', id('graficas'), { preload, bounds: { ...right, y: right.y + Math.round(right.height / 2), height: Math.round(right.height / 2) } })
  return { screens: 1 }
}

module.exports = { load, openView, spread, wins, NAMES }
