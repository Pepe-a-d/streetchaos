// Vista del duelo: cabecera VS, árbol de salida, pista pixel con las dos motos y resultado.
import { Race, RACE_MODES } from '../core/race.js'
import { MILE, KMH } from '../core/perf.js'
import { settings, netId, addRace, addRun } from '../core/store.js'
import { setBusy } from '../core/lobby.js'
import { sfx } from '../core/audio.js'
import { $, layer, setter, esc, segPad, toSpeed, speedUnit, fmtT } from './util.js'
import { drawBike, BIKE_W, BIKE_H } from './pixel.js'
import { logEvent } from '../core/logger.js'

export function modeLabel(id) {
  const m = RACE_MODES[id]
  if (m.kind === 'dist') return m.id === '1/8' ? '1/8 MILLA' : '1/4 MILLA'
  return settings.units === 'mph' ? `0-${Math.round(m.target / 0.44704)} MPH` : `0-${Math.round(m.target / KMH)} KM/H`
}

/**
 * Abre un duelo. opts: { modeId, opp, online?: { channel, role, onMsg }, onRematch?: fn }
 */
export function openRace({ modeId, opp, online = null, onRematch = null }) {
  const mode = RACE_MODES[modeId]
  const race = new Race({ mode, opp, online })
  setBusy(true)
  document.body.classList.add('racing')
  const meColor = settings.color
  const el = layer(
    `<div class="race-head">
      <div class="p"><span class="lbl" style="color:${meColor}">TU</span><b>${esc(settings.name || 'PILOTO')}</b><span class="lbl">${esc(settings.bike || '')}</span></div>
      <div class="vs">VS</div>
      <div class="p"><span class="lbl" style="color:${esc(opp.color)}">${opp.kind === 'online' ? 'RIVAL' : opp.kind === 'cpu' ? 'CPU' : 'FANTASMA'}</span><b>${esc(opp.name)}</b><span class="lbl">${esc(opp.bike || '')}</span></div>
    </div>
    <div class="race-center">
      <div class="tree">
        <div class="bulb stage" data-b="s1"></div><div class="bulb stage" data-b="o1"></div>
        <div class="bulb stage" data-b="s2"></div><div class="bulb stage" data-b="o2"></div>
        <div class="bulb amber" data-b="a1"></div><div class="bulb amber" data-b="b1"></div>
        <div class="bulb amber" data-b="a2"></div><div class="bulb amber" data-b="b2"></div>
        <div class="bulb amber" data-b="a3"></div><div class="bulb amber" data-b="b3"></div>
        <div class="bulb green" data-b="g"></div><div class="bulb green" data-b="og"></div>
        <div class="bulb red" data-b="r"></div><div class="bulb red" data-b="or"></div>
      </div>
      <div class="race-info">
        <div class="lbl" style="color:var(--pink)">${modeLabel(modeId)}</div>
        <div class="msg" data-k="msg">PARA LA MOTO</div>
        <div class="lamps" data-k="lamps"><span data-k="l1">TU</span><span data-k="l2">RIVAL</span></div>
        <span class="seg num" data-k="speed" data-ghost="888" hidden>!!0</span>
        <span class="seg et" data-k="et" data-ghost="88.88" hidden>!0.00</span>
        <div class="actions"><button class="btn ghost small" data-k="cancel">ABANDONAR</button></div>
      </div>
    </div>
    <canvas class="strip"></canvas>`,
    'solid race',
  )
  const k = (n) => $(el, `[data-k="${n}"]`)
  const bulbs = Object.fromEntries([...el.querySelectorAll('[data-b]')].map((b) => [b.dataset.b, b]))
  const canvas = $(el, '.strip')
  const ctx = canvas.getContext('2d')
  const set = setter()
  let raf = 0
  let closed = false

  k('cancel').onclick = () => {
    sfx.click()
    close()
  }

  race.on((ev) => {
    if (ev === 'phase' && race.phase === 'result') setTimeout(showResult, 900)
    if (ev === 'phase' && race.phase === 'aborted') {
      set(k('msg'), race.why === 'opp-left' ? 'EL RIVAL ABANDONO' : 'SE PERDIO LA CONEXION')
      k('cancel').textContent = 'SALIR'
    }
  })

  function close() {
    if (closed) return
    closed = true
    cancelAnimationFrame(raf)
    race.dispose(true)
    setBusy(false)
    document.body.classList.remove('racing')
    el.remove()
    resultEl?.remove()
  }

  function lightsFrame() {
    const L = race.lights()
    const t = performance.now() / 1000
    const on = (b, v) => bulbs[b].classList.toggle('on', !!v)
    on('s1', race.me.staged || race.green != null)
    on('s2', race.me.staged || race.green != null)
    on('o1', race.opp.staged || race.green != null)
    on('o2', race.opp.staged || race.green != null)
    for (let i = 1; i <= 3; i++) {
      on('a' + i, L.amber >= i && !L.green && !L.red)
      on('b' + i, L.amber >= i && t < (race.green ?? 0))
    }
    on('g', L.green)
    on('og', race.green != null && t >= race.green && !L.oppRed)
    on('r', L.red)
    on('or', L.oppRed)

    let msg = ''
    let cls = ''
    if (race.phase === 'aborted') return
    if (race.me.redLight) {
      msg = '¡SALIDA NULA!'
      cls = 'red'
    } else if (race.phase === 'staging') {
      msg = !race.me.staged ? 'PARA LA MOTO' : !race.opp.staged ? 'ESPERANDO AL RIVAL' : !race.opp.synced ? 'SINCRONIZANDO' : 'ATENTO...'
    } else if (race.phase === 'tree') msg = L.amber ? ['', '3', '2', '1'][L.amber] : 'ATENTO...'
    else if (race.phase === 'racing') {
      if (t - race.green < 1.2 && !race.me.launched) {
        msg = '¡GO!'
        cls = 'go'
      } else msg = race.me.fin ? (race.opp.fin ? '' : 'ESPERANDO AL RIVAL') : ''
    }
    set(k('msg'), msg)
    set(k('msg'), 'msg ' + cls, 'class')
    k('lamps').hidden = race.phase !== 'staging'
    set(k('l1'), race.me.staged ? 'TU LISTO' : 'TU')
    k('l1').classList.toggle('ok', race.me.staged)
    k('l2').classList.toggle('ok', race.opp.staged && race.opp.synced)

    const racing = race.phase === 'racing' || race.phase === 'result'
    k('speed').hidden = !racing
    k('et').hidden = !racing
    if (racing) {
      set(k('speed'), segPad(Math.round(toSpeed(race.me.v)), 3))
      const elapsed = race.me.fin && !race.me.fin.dnf ? race.me.fin.rt + race.me.fin.et : Math.max(0, t - race.green)
      set(k('et'), segPad(elapsed.toFixed(2), 5))
    }
  }

  function stripFrame() {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = Math.round(canvas.clientWidth * dpr)
    const h = Math.round(canvas.clientHeight * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#0b0718'
    ctx.fillRect(0, 0, w, h)
    const laneH = h / 2
    const scale = Math.max(1, Math.floor((laneH * 0.86) / BIKE_H))
    const bw = BIKE_W * scale
    const x0 = Math.round(8 * dpr)
    const x1 = w - bw - Math.round(10 * dpr)
    const progress = (s) => (mode.kind === 'dist' ? s.d / mode.target : s.v / mode.target)

    // Asfalto con líneas de carril
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = i ? '#15102a' : '#120c26'
      ctx.fillRect(0, i * laneH, w, laneH)
    }
    ctx.fillStyle = '#ffd23f'
    const dash = Math.round(14 * dpr)
    const off = Math.round(-((race.me.d * 6) % (dash * 2)))
    for (let x = off; x < w; x += dash * 2) ctx.fillRect(x, laneH - dpr, dash, 2 * dpr)
    // Marcas de distancia
    if (mode.kind === 'dist') {
      ctx.fillStyle = '#3a2a7a'
      for (const m of [18.288, 100.584, MILE / 8, 304.8]) {
        if (m >= mode.target) continue
        const x = x0 + bw + (m / mode.target) * (x1 - x0)
        ctx.fillRect(Math.round(x), 0, Math.max(1, dpr), h)
      }
    }
    // Salida y meta a cuadros
    ctx.fillStyle = '#f4f1ff'
    ctx.fillRect(x0 + bw, 0, 2 * dpr, h)
    const cs = Math.max(3, Math.round(5 * dpr))
    for (let y = 0; y < h; y += cs) for (let c = 0; c < 2; c++) {
      ctx.fillStyle = (Math.floor(y / cs) + c) % 2 ? '#000' : '#f4f1ff'
      ctx.fillRect(x1 + bw + c * cs - cs * 2, y, cs, cs)
    }
    const t = performance.now() / 1000
    const lanes = [
      { s: race.me, color: meColor, y: 0 },
      { s: race.opp, color: race.opp.color, y: laneH },
    ]
    for (const L of lanes) {
      const p = Math.max(0, Math.min(1, progress(L.s)))
      const x = x0 + p * (x1 - x0)
      const y = L.y + (laneH - BIKE_H * scale) / 2 + (L.s.v > 1 ? Math.round(Math.sin(t * 40) * 0.5) : 0)
      // Estela de velocidad
      if (L.s.v > 3) {
        ctx.fillStyle = L.color
        ctx.globalAlpha = 0.35
        for (let i = 0; i < 4; i++) ctx.fillRect(x - (8 + i * 10) * scale, y + (4 + i * 2) * scale, (4 + i * 2) * scale, scale)
        ctx.globalAlpha = 1
      }
      drawBike(ctx, x, y, scale, L.color, Math.floor(L.s.d * 2))
    }
    // Nombres pegados a la meta, encima de cada carril
    ctx.font = `${Math.round(7 * dpr)}px 'Press Start 2P'`
    ctx.fillStyle = '#8a80c4'
    ctx.textAlign = 'right'
    const lx = x1 + bw - cs * 2 - Math.round(6 * dpr)
    ctx.fillText('TU', lx, Math.round(10 * dpr))
    ctx.fillText(race.opp.kind === 'online' ? 'RIVAL' : race.opp.name, lx, laneH + Math.round(10 * dpr))
    ctx.textAlign = 'left'
  }

  function frame() {
    if (closed) return
    lightsFrame()
    stripFrame()
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  // ---- Resultado ----
  let resultEl = null
  function showResult() {
    if (closed || resultEl) return
    const r = race.result
    const me = race.me.fin
    const op = race.opp.fin
    const title = r.win ? (r.why === 'their-foul' ? '¡GANAS!' : '¡VICTORIA!') : me.foul ? 'SALIDA NULA' : 'DERROTA'
    const why =
      r.why === 'their-foul' ? 'EL RIVAL SALIO ANTES DE TIEMPO' : r.why === 'foul' ? 'SALISTE ANTES DEL VERDE' : r.why === 'dnf' ? (me.dnf ? 'NO LLEGASTE A META' : 'EL RIVAL NO LLEGO') : r.margin != null ? `POR ${r.margin.toFixed(3)} S` : ''
    const slip = (name, f, win) => `
      <div class="slip ${win ? 'win' : ''}">
        <h4>${esc(name)}</h4>${win ? '<span class="tag">GANADOR</span>' : ''}
        <div class="r"><span>REACCIÓN</span><b>${f.foul && f.rt < 0 ? 'NULA' : fmtT(f.rt, 3)}</b></div>
        <div class="r"><span>${mode.kind === 'dist' ? 'ET' : 'TIEMPO'}</span><b>${f.dnf ? 'DNF' : fmtT(f.et, 3)}</b></div>
        <div class="r"><span>TOTAL</span><b>${f.dnf || f.foul ? '--' : fmtT(f.rt + f.et, 3)}</b></div>
        ${mode.kind === 'dist' ? `<div class="r"><span>TRAMPA</span><b>${f.dnf ? '--' : Math.round(toSpeed(f.trap))}</b></div>` : ''}
      </div>`
    resultEl = layer(
      `<div class="result ${r.win ? 'win' : 'lose'}" style="display:grid">
        <div class="lbl">${modeLabel(modeId)} · ${speedUnit()}</div>
        <h2>${title}</h2>
        <div class="margin">${why}</div>
        <div class="slips">${slip(settings.name || 'TU', me, r.win)}${slip(opp.name, op, !r.win)}</div>
        <div class="actions" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          ${onRematch ? '<button class="btn" data-k="again">REVANCHA</button>' : ''}
          <button class="btn ghost" data-k="out">SALIR</button>
        </div>
      </div>`,
      'solid',
    )
    addRace({ mode: modeId, opp: { name: opp.name, bike: opp.bike, kind: opp.kind }, me, them: op, win: r.win })
    logEvent('race', { mode: modeId, opp: opp.kind, win: r.win, me, them: op })
    if (race.rec.result?.valid) addRun({ ...race.rec.result, race: modeId })
    $(resultEl, '[data-k="out"]').onclick = () => (sfx.click(), close())
    const again = $(resultEl, '[data-k="again"]')
    if (again)
      again.onclick = () => {
        sfx.click()
        close()
        onRematch()
      }
  }

  return { race, close }
}

/** Crea el canal de un duelo online y lo deja listo para Race. */
export function onlineLink(channelFactory, raceId, role) {
  let handler = null
  const channel = channelFactory(raceId, { onMsg: (m) => handler?.(m) })
  return { channel, role, onMsg: (fn) => (handler = fn), me: netId }
}
