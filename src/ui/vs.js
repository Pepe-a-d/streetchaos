// VS: pilotos cercanos con la app abierta, retos y duelos contra la CPU o tu fantasma.
import { lobby, onLobby, challenge, reply, raceChannel } from '../core/lobby.js'
import { RACE_MODES, cpuOpponent, ghostOpponent } from '../core/race.js'
import { BIKES } from '../core/physics.js'
import { settings, setSetting, bestRunFor } from '../core/store.js'
import { T } from '../core/telemetry.js'
import { sfx } from '../core/audio.js'
import { $, esc, layer, toast } from './util.js'
import { bikeSvg } from './pixel.js'
import { openRace, onlineLink, modeLabel } from './raceview.js'

const MARK_OF = { '1/8': '1/8', '1/4': '1/4', '0-100': 'k0-100' }
let current = null // duelo abierto

export function mountVs(el) {
  el.innerHTML = `
    <div class="vs-head">
      <h2 class="title">RIVALES CERCA</h2>
      <span class="badge" data-k="net"></span>
    </div>
    <div class="chips" data-k="modes"></div>
    <div class="vs-body">
      <div class="panel riders" data-k="riders"></div>
      <div class="panel cpu">
        <span class="lbl">Contra la maquina</span>
        <div class="cpu-grid" data-k="cpu"></div>
      </div>
    </div>`
  const k = (n) => $(el, `[data-k="${n}"]`)

  function renderModes() {
    k('modes').innerHTML = Object.keys(RACE_MODES)
      .map((id) => `<button class="chip ${id === settings.raceMode ? 'on' : ''}" data-mode="${id}">${modeLabel(id)}</button>`)
      .join('')
  }
  k('modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]')
    if (!b) return
    sfx.click()
    setSetting('raceMode', b.dataset.mode)
    renderModes()
    renderCpu()
  })

  function renderNet() {
    const b = k('net')
    if (lobby.kind === 'local') {
      b.className = 'badge'
      b.textContent = 'MODO LOCAL'
    } else if (lobby.status === 'ok') {
      b.className = 'badge on'
      b.textContent = 'ONLINE'
    } else {
      b.className = 'badge off'
      b.textContent = lobby.status === 'connecting' ? 'CONECTANDO' : 'SIN CONEXION'
    }
  }

  function renderRiders() {
    const box = k('riders')
    if (!lobby.active) {
      box.innerHTML = `<div class="empty"><span class="lbl">Radar apagado</span><span>Activa «Visible en el radar» en Garaje para ver y retar a pilotos cercanos</span></div>`
      return
    }
    if (!T.fix) {
      box.innerHTML = `<div class="empty"><div class="radar"></div><span class="lbl">Esperando al GPS</span><span>Necesitas posición para ver quién hay cerca</span></div>`
      return
    }
    if (!lobby.riders.length) {
      box.innerHTML = `<div class="empty"><div class="radar"></div><span class="lbl">Nadie cerca... de momento</span><span>Los pilotos con la app abierta a menos de ${(settings.radius / 1000).toFixed(1)} km aparecen aquí</span></div>`
      return
    }
    box.innerHTML = lobby.riders
      .map(
        (r) => `<div class="rider">
          ${bikeSvg(r.color || '#ff2e88')}
          <div class="who"><b>${esc(r.name)}</b><span>${esc(r.bike || 'MOTO')} · ${fmtDist(r.dist)}${r.busy ? ' · EN CARRERA' : ''}</span></div>
          <button class="btn small" data-id="${esc(r.id)}" ${r.busy ? 'disabled' : ''}>RETAR</button>
        </div>`,
      )
      .join('')
  }
  k('riders').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]')
    if (!b) return
    const r = lobby.riders.find((x) => x.id === b.dataset.id)
    if (r) sendChallenge(r, settings.raceMode)
  })

  function renderCpu() {
    const best = bestRunFor(MARK_OF[settings.raceMode])
    k('cpu').innerHTML =
      Object.values(BIKES)
        .map((b) => `<button class="cpu-card" data-bike="${b.id}">${bikeSvg(b.color)}<span>${b.name}</span><small>${b.kw} kW</small></button>`)
        .join('') +
      `<button class="cpu-card" data-ghost ${best ? '' : 'disabled style="opacity:.45"'}>${bikeSvg('#9d8cff')}<span>FANTASMA</span><small>${best ? 'Tu mejor pasada' : 'Haz una pasada en CRONO'}</small></button>`
  }
  k('cpu').addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b || b.disabled) return
    sfx.click()
    const modeId = settings.raceMode
    if (b.dataset.bike) startLocal(modeId, () => cpuOpponent(b.dataset.bike))
    else {
      const run = bestRunFor(MARK_OF[modeId])
      if (run) startLocal(modeId, () => ghostOpponent(run))
    }
  })

  renderModes()
  renderNet()
  renderRiders()
  renderCpu()
  onLobby(() => {
    renderNet()
    renderRiders()
  })
  let lastFix = !!T.fix
  setInterval(() => {
    renderNet()
    if (!!T.fix !== lastFix) {
      lastFix = !!T.fix
      renderRiders()
    }
  }, 1500)

  return {
    show() {
      renderModes()
      renderNet()
      renderRiders()
      renderCpu()
    },
    hide() {},
    frame() {},
  }
}

const fmtDist = (m) => (m < 1000 ? `${Math.round(m)} M` : `${(m / 1000).toFixed(1)} KM`)

function startLocal(modeId, makeOpp) {
  current?.close()
  current = openRace({ modeId, opp: makeOpp(), onRematch: () => startLocal(modeId, makeOpp) })
}

function startOnline(modeId, rider, raceId, role) {
  current?.close()
  const online = onlineLink(raceChannel, raceId, role)
  current = openRace({
    modeId,
    opp: { kind: 'online', name: rider.name, bike: rider.bike, color: rider.color || '#22e3ff' },
    online,
    onRematch: () => {
      const r = lobby.riders.find((x) => x.id === rider.id)
      if (r) sendChallenge(r, modeId)
      else toast('EL RIVAL YA NO ESTA CERCA')
    },
  })
}

function sendChallenge(rider, modeId) {
  sfx.click()
  const c = challenge(rider, modeId)
  const el = layer(
    `<div class="panel modal">
      <h2 class="title">RETO ENVIADO</h2>
      ${bikeSvg(rider.color || '#ff2e88', 'sprite')}
      <div><b class="lbl" style="color:var(--ink);font-size:11px">${esc(rider.name)}</b></div>
      <div class="lbl">${modeLabel(modeId)}</div>
      <div class="blink" style="font-size:20px">Esperando respuesta...</div>
      <div class="actions"><button class="btn ghost" data-k="x">CANCELAR</button></div>
    </div>`,
  )
  $(el, '.sprite').style.cssText = 'width:120px;justify-self:center'
  $(el, '[data-k="x"]').onclick = () => c.cancel()
  c.promise.then((res) => {
    el.remove()
    if (res === 'accept') startOnline(modeId, rider, c.raceId, 'host')
    else if (res === 'decline') (sfx.error(), toast(`${rider.name} HA RECHAZADO EL RETO`))
    else if (res === 'busy') toast(`${rider.name} ESTA EN OTRA CARRERA`)
    else if (res === 'timeout') toast('SIN RESPUESTA')
  })
}

/** Reto entrante (llega en cualquier pantalla). */
let incoming = null
export function setupIncoming() {
  lobby.onChallenge = (msg) => {
    if (incoming || current?.race && !current.race.disposed) return reply(msg, false)
    sfx.challenge()
    const r = msg.from
    const dist = T.fix && r.lat != null ? fmtDist(Math.hypot((r.lat - T.fix.lat) * 111320, (r.lon - T.fix.lon) * 111320 * Math.cos((T.fix.lat * Math.PI) / 180))) : ''
    incoming = { msg }
    const el = layer(
      `<div class="panel modal">
        <h2 class="title blink" style="font-size:16px;color:var(--pink)">¡TE RETAN!</h2>
        ${bikeSvg(r.color || '#ff2e88', 'sprite')}
        <div><b style="font-family:var(--pixel);font-size:13px">${esc(r.name)}</b></div>
        <div style="color:var(--dim)">${esc(r.bike || 'MOTO')}${dist ? ' · a ' + dist : ''}</div>
        <div class="lbl" style="color:var(--yellow);font-size:11px">${modeLabel(msg.mode)}</div>
        <div class="actions">
          <button class="btn green" data-k="yes">ACEPTAR</button>
          <button class="btn ghost" data-k="no">NO</button>
        </div>
      </div>`,
    )
    $(el, '.sprite').style.cssText = 'width:130px;justify-self:center'
    const done = (accept) => {
      clearTimeout(timer)
      el.remove()
      incoming = null
      reply(msg, accept)
      if (accept) startOnline(msg.mode, r, msg.raceId, 'guest')
    }
    const timer = setTimeout(() => done(false), 20000)
    $(el, '[data-k="yes"]').onclick = () => (sfx.click(), done(true))
    $(el, '[data-k="no"]').onclick = () => (sfx.click(), done(false))
    incoming.close = () => {
      clearTimeout(timer)
      el.remove()
      incoming = null
    }
  }
  lobby.onCancel = (msg) => {
    if (incoming && incoming.msg.raceId === msg.raceId) {
      incoming.close()
      toast('EL RETO SE HA CANCELADO')
    }
  }
}
