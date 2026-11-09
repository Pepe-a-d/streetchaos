import '@fontsource/press-start-2p'
import '@fontsource/vt323'
import './style.css'
import { settings, onSetting, saveTotals } from './core/store.js'
import { T, useSource, createRealGps, tick, requestMotion, motionNeedsTap, signalBars } from './core/telemetry.js'
import { geoPermission, isStandalone } from './core/device.js'
import { createSimGps } from './core/sim.js'
import { unlockAudio, sfx } from './core/audio.js'
import { startLobby, stopLobby, lobby } from './core/lobby.js'
import { initLogger, logger, onSessionEnd, onSessionStart } from './core/logger.js'
import { watch } from './core/announcer.js'
import { say, spoken, unlockVoice } from './core/voice.js'
import { checkAchievements } from './core/achievements.js'
import { setupUnlocks } from './ui/unlock.js'
import { totals } from './core/store.js'
import { syncNow } from './core/cloud.js'
import { mountDash } from './ui/dash.js'
import { mountCrono } from './ui/crono.js'
import { mountVs, setupIncoming } from './ui/vs.js'
import { mountGarage } from './ui/garage.js'
import { showTitle } from './ui/title.js'
import { ICONS, pixelSvg } from './ui/pixel.js'
import { showBlackout, blackout } from './ui/blackout.js'
import { applyTheme } from './ui/themes.js'
import { $, html, setter } from './ui/util.js'

const TABS = [
  { id: 'dash', label: 'DASH' },
  { id: 'crono', label: 'CRONO' },
  { id: 'vs', label: 'VS' },
  { id: 'garage', label: 'GARAJE' },
]

// Luna para el botón de pantalla negra
const MOON = pixelSvg(['..XXXX.', '.XX....', 'XX.....', 'XX.....', 'XX.....', '.XX....', '..XXXX.'], { X: 'currentColor' })

const app = document.getElementById('app')
app.innerHTML = `
  <header class="topbar">
    <div class="gps"><div class="bars" data-n="0"><i></i><i></i><i></i><i></i></div><span data-k="gps">GPS</span></div>
    <div class="grow" data-k="title">DASH</div>
    <span class="badge sim" data-k="sim" hidden>SIM</span>
    <button class="topbtn" data-k="black" aria-label="Pantalla negra" title="Pantalla negra: sigue grabando">${MOON}</button>
    <span class="clock" data-k="clock">00:00</span>
  </header>
  <main>
    ${TABS.map((t) => `<section class="screen ${t.id === 'garage' ? 'scroll' : ''}" id="${t.id}"></section>`).join('')}
  </main>
  <nav class="tabs">
    ${TABS.map((t) => `<button class="tab" data-tab="${t.id}">${ICONS[t.id]}<span>${t.label}</span></button>`).join('')}
  </nav>`

document.body.classList.toggle('crt', settings.crt)
applyTheme()

// ---- Fuente de GPS ----
let sim = null
function applySource() {
  sim = settings.source === 'sim' ? createSimGps({ hz: settings.simHz, bike: settings.simBike }) : null
  useSource(sim || createRealGps())
  simPad.hidden = !sim
  $(app, '[data-k="sim"]').hidden = !sim
}

// ---- Pantallas ----
const screens = {
  dash: mountDash(document.getElementById('dash'), { onTitle: (t) => current === 'dash' && ($(app, '[data-k="title"]').textContent = t) }),
  crono: mountCrono(document.getElementById('crono')),
  vs: mountVs(document.getElementById('vs')),
  garage: mountGarage(document.getElementById('garage'), {
    applySource: () => applySource(),
    editDash: () => {
      go('dash')
      screens.dash.edit()
    },
  }),
}
let current = null
function go(id) {
  if (current === id) return
  if (current) {
    screens[current].hide?.()
    document.getElementById(current).classList.remove('on')
  }
  current = id
  document.body.dataset.tab = id
  document.getElementById(id).classList.add('on')
  screens[id].show?.()
  for (const b of app.querySelectorAll('.tab')) b.classList.toggle('on', b.dataset.tab === id)
  $(app, '[data-k="title"]').textContent = screens[id].title?.() || TABS.find((t) => t.id === id).label
  try {
    sessionStorage.setItem('sc-tab', id)
  } catch {}
}
$(app, '[data-k="black"]').addEventListener('click', () => {
  sfx.click()
  showBlackout()
})
$(app, '.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]')
  if (b) (sfx.click(), go(b.dataset.tab))
})

// ---- Mandos del simulador (botones y teclado) ----
const simPad = html(`<div class="simpad" hidden>
  <div class="col"><button data-in="left">◀</button></div>
  <div class="col"><button class="brk" data-in="brake">FRENO</button><button class="gas" data-in="gas">GAS</button></div>
  <div class="col"><button data-in="right">▶</button></div>
</div>`)
document.body.append(simPad)
const held = new Set()
function applyInput() {
  if (!sim) return
  sim.input.throttle = held.has('gas') ? 1 : 0
  sim.input.brake = held.has('brake') ? 1 : 0
  sim.input.steer = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0)
  for (const b of simPad.querySelectorAll('[data-in]')) b.classList.toggle('pressed', held.has(b.dataset.in))
}
simPad.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-in]')
  if (!b) return
  b.setPointerCapture(e.pointerId)
  held.add(b.dataset.in)
  applyInput()
})
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'])
  simPad.addEventListener(ev, (e) => {
    const b = e.target.closest('[data-in]')
    if (b) held.delete(b.dataset.in)
    applyInput()
  })
const KEYS = { ArrowUp: 'gas', KeyW: 'gas', Space: 'gas', ArrowDown: 'brake', KeyS: 'brake', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' }
addEventListener('keydown', (e) => {
  if (!sim || !KEYS[e.code] || e.target.tagName === 'INPUT') return
  e.preventDefault()
  held.add(KEYS[e.code])
  applyInput()
})
addEventListener('keyup', (e) => {
  if (!KEYS[e.code]) return
  held.delete(KEYS[e.code])
  applyInput()
})

// ---- Pantalla siempre encendida ----
let wakeLock = null
async function keepAwake() {
  try {
    if (document.visibilityState === 'visible' && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen')
      wakeLock.addEventListener('release', () => (wakeLock = null))
    }
  } catch {
    wakeLock = null
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepAwake()
  else saveTotals(true)
})

// ---- Barra superior y bucle de dibujo ----
const set = setter()
const bars = $(app, '.bars')
const gpsTxt = $(app, '[data-k="gps"]')
const clock = $(app, '[data-k="clock"]')
let last = performance.now()
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  tick(dt)
  watch(dt)
  // Con la pantalla negra no se dibuja nada: la telemetría y la grabación siguen igual
  if (blackout.on) return requestAnimationFrame(frame)
  set(bars, String(signalBars()), 'data-n')
  const txt =
    T.status === 'ok'
      ? `${T.hz >= 1.5 ? Math.round(T.hz) : 1}HZ ±${Math.round(T.acc)}M`
      : T.status === 'denied'
        ? 'SIN PERMISO'
        : T.status === 'lost'
          ? 'PERDIDO'
          : T.status === 'error'
            ? 'ERROR'
            : 'BUSCANDO'
  set(gpsTxt, txt)
  const d = new Date()
  set(clock, `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
  screens[current]?.frame(dt)
  requestAnimationFrame(frame)
}

// ---- Arranque ----
let tabStart = 'dash'
try {
  tabStart = sessionStorage.getItem('sc-tab') || 'dash'
} catch {}
go(TABS.some((t) => t.id === tabStart) ? tabStart : 'dash')
onSetting((key, val) => {
  if (['theme', 'digits', 'accentBike', 'color'].includes(key)) applyTheme()
  if (key === 'crt') document.body.classList.toggle('crt', val)
  if (['units', 'name', 'color', 'digits'].includes(key)) screens[current].show?.()
  if (key === 'visible') val ? startLobby() : stopLobby()
})
setupIncoming()
initLogger()
// Subida a la nube: al cerrar cada salida, al abrir la app (lo que quedó pendiente) y al volver la conexión
onSessionEnd((meta) => {
  setTimeout(syncNow, 2000)
  totals.sessions = (totals.sessions || 0) + 1
  saveTotals(true)
  checkAchievements()
  const mi = settings.units === 'mph'
  say(`Salida guardada. ${spoken((meta.dist || 0) / (mi ? 1609.344 : 1000), 1)} ${mi ? 'millas' : 'kilómetros'}`, { kind: 'box' })
})
onSessionStart(() => say('Grabando la salida', { kind: 'box' }))
// Logros: aviso al desbloquear y comprobación cada pocos segundos
setupUnlocks()
setInterval(checkAchievements, 3000)
setTimeout(checkAchievements, 1500)
setTimeout(syncNow, 12000)
addEventListener('online', () => syncNow())
onSetting((key, val) => key === 'cloudSync' && val && syncNow())
requestAnimationFrame(frame)
// Arrancada: el modo rescate de index.html ya no hace falta
window.__scBooted = true

// Lo que no necesita un toque: GPS, radar, pantalla encendida y (fuera de iPhone) el acelerómetro
let started = false
function start() {
  if (started) return
  started = true
  applySource()
  if (settings.visible) startLobby()
  keepAwake()
  if (!motionNeedsTap()) requestMotion()
}
// Lo que el navegador solo permite dentro de un toque: sonido, acelerómetro en iPhone y pantalla completa.
// En pantallas táctiles cuenta como toque al LEVANTAR el dedo (pointerup), no al apoyarlo (pointerdown):
// por eso antes el iPhone rechazaba el permiso de movimiento sin preguntar. Se reintenta en cada toque
// hasta que esté concedido (si lo deniegas, ya no insiste: se reactiva en Garaje → Permisos).
let fullscreenTried = false
function onTap() {
  unlockAudio()
  unlockVoice()
  keepAwake()
  if (!T.motion && (T.motionPerm === 'unknown' || T.motionPerm === 'tap')) requestMotion()
  if (!fullscreenTried) {
    fullscreenTried = true
    if (matchMedia('(pointer: coarse)').matches && !isStandalone()) document.documentElement.requestFullscreen?.().catch(() => {})
  }
}
document.addEventListener('pointerup', onTap, true)
document.addEventListener('keydown', onTap, true)

// Si ya diste permiso de ubicación, la app arranca sola: el título solo saluda un momento
geoPermission().then((geo) => {
  if (settings.onboarded && (geo === 'granted' || settings.source === 'sim')) {
    start()
    showTitle(null, { auto: 1200 })
  } else showTitle(() => start())
})

// Ganchos para probar desde la consola
window.__sc = { T, settings, lobby, get sim() { return sim }, go, logger }
