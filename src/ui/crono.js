// CRONO: pasadas desde parado. Se arma solo al parar y cronometra al salir.
import { RunRecorder, marksFor, MARKS } from '../core/perf.js'
import { T, onSample, onHint, onAccel, signalBars } from '../core/telemetry.js'
import { settings, setSetting, addRun, deleteRun, bests } from '../core/store.js'
import { sfx } from '../core/audio.js'
import { $, $$, setter, segPad, toSpeed, speedUnit, fmtT, toast } from './util.js'
import { logEvent } from '../core/logger.js'
import { say, spoken } from '../core/voice.js'
import { spokenMark } from '../core/announcer.js'
import { checkAchievements } from '../core/achievements.js'
import { live, track, markFinishHere, useCircuit, clearTrack, circuits, setLapMode } from '../core/segments.js'
import { fmtLap } from '../core/tripsum.js'
import { fmtDelta } from './livestrip.js'
import { layer, esc } from './util.js'

const MODES = { kmh: ['k0-100', 'k100-200', '1/8', '1/4'], mph: ['m0-60', 'm60-130', '1/8', '1/4'] }

export function mountCrono(el) {
  let visible = false
  let shown = null // pasada que enseña el tablero
  let records = new Set()
  let flash = new Set()

  const rec = new RunRecorder({ rollout: settings.rollout, onEvent })
  onSample((s) => {
    if ((visible || rec.state === 'running') && !settings.lapMode) rec.feed(s)
  })
  onHint((t) => rec.hint(t))
  onAccel((t, a) => rec.accel(t, a))

  function onEvent(e, data) {
    if (e === 'armed') {
      sfx.armed()
      say('Crono listo', { kind: 'crono' })
    }
    if (e === 'aborted') {
      logEvent('abort')
      say('Pasada cancelada', { kind: 'crono', urgent: true })
      sfx.error()
      toast('PASADA CANCELADA')
      renderBoard()
    }
    if (e === 'launch') {
      logEvent('launch', {}, data?.t0 ?? undefined)
      sfx.launch()
      shown = null
      records = new Set()
      renderBoard()
    }
    if (e === 'mark') {
      flash.add(data.id)
      if (data.id === mode()) sfx.mark()
    }
    if (e === 'done') {
      if (!data.valid) return
      const before = bests()
      records = new Set(Object.keys(data.marks).filter((id) => !before[id] || data.marks[id].t < before[id].t))
      shown = addRun(data)
      logEvent('run', { id: shown.id, marks: Object.fromEntries(Object.entries(data.marks).map(([id, m]) => [id, m.t])), maxV: data.maxV }, data.tStart)
      if (records.has(mode())) sfx.record()
      else sfx.done()
      renderBoard()
      // Por voz: el parcial del modo elegido (o el más largo que haya), la trampa y si es récord
      const id = data.marks[mode()] ? mode() : Object.keys(data.marks).at(-1)
      if (id) {
        const m = data.marks[id]
        const trap = id === '1/4' || id === '1/8' ? `, a ${Math.round(toSpeed(m.v ?? data.maxV))}` : ''
        say(`${spokenMark(id)} en ${spoken(m.t)} segundos${trap}.${records.has(id) ? ' ¡Récord!' : ''}`, { kind: 'crono', urgent: true })
      }
      checkAchievements()
    }
  }

  const mode = () => {
    const list = MODES[settings.units]
    return list.includes(settings.timerMode) ? settings.timerMode : list[0]
  }

  el.innerHTML = `
    <div class="chips modes"></div>
    <div class="panel status" data-s="nogps">
      <div class="big" data-k="big"></div>
      <div class="sub" data-k="sub"></div>
      <div class="light" data-k="light" hidden></div>
      <span class="seg timer" data-k="timer" data-ghost="88.88" hidden>!0.00</span>
      <div class="live" data-k="live" hidden><span><b data-k="lv">0</b><small data-k="lvu">KM/H</small></span><span><b data-k="ld">0</b><small>M</small></span></div>
      <div class="record" data-k="record" hidden>¡NUEVO RECORD!</div>
      <button class="btn ghost small discard" data-k="discard" hidden>DESCARTAR PASADA</button>
    </div>
    <div class="panel board"></div>
    <div class="panel laps" hidden>
      <div class="lap-head"><span class="lbl" data-k="trk">SIN META</span><span class="lbl" data-k="lapn"></span></div>
      <span class="seg timer" data-k="laptime" data-ghost="8:88.8">0:00.0</span>
      <div class="lap-delta" data-k="ldelta"></div>
      <div class="lap-row"><span class="lbl">ULTIMA <b data-k="llast">—</b></span><span class="lbl">MEJOR <b data-k="lbest">—</b></span></div>
      <div class="lap-list" data-k="llist"></div>
      <div class="lap-btns">
        <button class="btn small" data-lap="mark">MARCAR META AQUI</button>
        <button class="btn small ghost" data-lap="circuits">CIRCUITOS DEL BLACKBOX</button>
        <button class="btn small ghost" data-lap="clear">BORRAR META</button>
      </div>
      <p class="lap-note">Pasa por la línea de meta y pulsa MARCAR META AQUI (en el sentido en que vas). Desde ahí, cada vuelta se cronometra sola y la franja del DASH te dice si vas mejor o peor que tu mejor vuelta.</p>
    </div>`

  const k = (n) => $(el, `[data-k="${n}"]`)
  const status = $(el, '.status')
  const board = $(el, '.board')
  const lapsEl = $(el, '.laps')

  // ---- Vueltas ----
  lapsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lap]')
    if (!b) return
    sfx.click()
    const a = b.dataset.lap
    if (a === 'mark') {
      if (markFinishHere()) (sfx.armed(), toast('META MARCADA: CADA VEZ QUE PASES POR AQUI, EN ESTE SENTIDO, CUENTA UNA VUELTA', 4500))
      else (sfx.error(), toast('HACE FALTA GPS Y HABER IDO EN MARCHA (PARA SABER EL SENTIDO)', 4000))
    } else if (a === 'clear') {
      clearTrack()
      toast('META BORRADA')
    } else if (a === 'circuits') {
      const list = circuits()
      const ly = layer(
        `<div class="panel sheet"><header class="sh-head"><h3 class="title">CIRCUITOS</h3><button class="sh-x" data-close aria-label="Cerrar">×</button></header><div class="sh-body">${
          list.length
            ? list.map((c) => `<button class="mi" data-cid="${esc(c.id)}"><span class="mi-t">${esc(c.name)}</span><span class="mi-s">${Math.round(c.length)} m${Number.isFinite(c.best) ? ` · mejor ${fmtLap(c.best)}` : ''}</span></button>`).join('')
            : '<p class="note">No hay circuitos: en el Blackbox, guarda un tramo que empiece y acabe en el mismo sitio. Llegan solos al móvil.</p>'
        }</div></div>`,
        'sheet-layer',
      )
      ly.addEventListener('click', (ev) => {
        const c = ev.target.closest('[data-cid]')
        if (c && useCircuit(c.dataset.cid)) (toast('CIRCUITO LISTO: LA META ES SU LINEA DE SALIDA'), ly.remove())
        else if (ev.target.closest('[data-close]') || ev.target === ly) ly.remove()
      })
    }
  })
  // En los dígitos LCD solo números: «44.4», «1:32.4»
  const segLap = (x) => (x >= 60 ? `${Math.floor(x / 60)}:${(x % 60).toFixed(1).padStart(4, '0')}` : x.toFixed(1))
  function lapFrame() {
    const t = track()
    const cur = live.cur?.kind === 'lap' ? live.cur : null
    const now = performance.now() / 1000
    set(k('trk'), t ? `META: ${String(t.name || 'CIRCUITO').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()}` : 'SIN META')
    set(k('lapn'), cur ? `VUELTA ${cur.n}` : live.laps.length ? `${live.laps.length} VUELTAS` : '')
    set(k('laptime'), cur ? segLap(Math.max(0, now - cur.t0)) : live.laps.length ? segLap(live.laps.at(-1).time) : '0.0')
    // El delta, cuando ya hay algo de vuelta con la que compararse
    const d = cur && cur.d > 50 ? cur.delta : NaN
    set(k('ldelta'), cur && Number.isFinite(d) ? fmtDelta(d) : '')
    k('ldelta').dataset.s = !Number.isFinite(d) ? '' : d < 0 ? 'ahead' : 'behind'
    const lastLap = live.laps.at(-1)
    set(k('llast'), lastLap ? segLap(lastLap.time) : '—')
    set(k('lbest'), t && Number.isFinite(t.best) ? segLap(t.best) : '—')
    const sig = live.laps.length
    if (k('llist')._n !== sig) {
      k('llist')._n = sig
      const best = Math.min(...live.laps.map((x) => x.time))
      k('llist').innerHTML = live.laps
        .slice()
        .reverse()
        .map((x) => `<div class="row ${x.time === best ? 'rec' : ''}"><span class="lbl">VUELTA ${x.n}</span><b class="got">${segLap(x.time)}${x.record ? ' ★' : ''}</b></div>`)
        .join('')
    }
  }
  const set = setter()

  function renderModes() {
    const laps = !!settings.lapMode
    $(el, '.modes').innerHTML =
      MODES[settings.units].map((id) => `<button class="chip ${!laps && id === mode() ? 'on' : ''}" data-mode="${id}">${MARKS[id].label}</button>`).join('') +
      (laps ? '' : `<button class="chip ${settings.rollout ? 'on' : ''}" data-roll title="Rollout de 1 pie, como en las pistas de drag">1FT</button>`) +
      `<button class="chip ${laps ? 'on' : ''}" data-laps title="Vueltas a un circuito, con el tiempo de cada una">VUELTAS</button>`
    status.hidden = laps
    board.hidden = laps
    lapsEl.hidden = !laps
  }
  $(el, '.modes').addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    sfx.click()
    if (b.hasAttribute('data-laps')) setLapMode(!settings.lapMode)
    else if (b.dataset.mode) {
      if (settings.lapMode) setLapMode(false)
      setSetting('timerMode', b.dataset.mode)
    } else {
      setSetting('rollout', !settings.rollout)
      rec.rollout = settings.rollout
      toast(settings.rollout ? 'ROLLOUT 1 PIE: EL CRONO EMPIEZA A LOS 30 CM' : 'ROLLOUT DESACTIVADO')
    }
    renderModes()
    renderBoard()
  })

  function renderBoard() {
    const best = bests()
    const r = shown || (rec.state === 'running' ? { marks: rec.marks } : null)
    const head = mode()
    const running = rec.state === 'running'
    const title = r ? (running ? 'EN CURSO' : 'ULTIMA PASADA') : 'TUS MEJORES MARCAS'
    board.innerHTML =
      `<div class="board-title lbl">${title}${r && records.size ? ' <span>· RECORD</span>' : ''}</div>` +
      marksFor(settings.units)
        .map((m) => {
          const got = r ? r.marks[m.id] : best[m.id]
          const trap = got?.v != null ? `<small>@${Math.round(toSpeed(got.v))}</small>` : ''
          const cls = [m.id === head ? 'head' : '', r && records.has(m.id) ? 'rec' : ''].join(' ')
          return `<div class="row ${cls}" data-id="${m.id}"><span class="lbl">${m.label}</span><b class="${got ? 'got' : ''}">${got ? fmtT(got.t) : '--.--'}${trap}</b></div>`
        })
        .join('') + `<div class="meta" data-k="meta"></div>`
    renderMeta()
  }

  function renderMeta() {
    const r = shown
    const parts = []
    if (r) {
      parts.push(`GPS ${r.hz.toFixed(1)} HZ ±${Math.round(r.accMax)} M`)
      if (r.slope != null) parts.push(`PENDIENTE ${r.slope >= 0 ? '+' : ''}${r.slope.toFixed(1)}%`)
      parts.push(`PUNTA ${Math.round(toSpeed(r.maxV))} ${speedUnit()}`)
    } else parts.push(`TRAMPA @ = VELOCIDAD EN ${speedUnit()} · ${settings.rollout ? 'ROLLOUT 1 PIE' : 'SIN ROLLOUT'}`)
    const m = $(board, '[data-k="meta"]')
    if (m) m.textContent = parts.join(' · ')
  }

  // Salida en falso: un toque en cualquier parte de la pantalla cancela la pasada en marcha
  el.addEventListener('pointerdown', (e) => {
    if (rec.state !== 'running') return
    e.preventDefault()
    e.stopPropagation()
    rec.abort()
  }, true)
  // Ya terminada (y guardada): se puede tirar a la basura para que no cuente en récords
  k('discard').addEventListener('click', () => {
    if (!shown?.id) return
    deleteRun(shown.id)
    shown = null
    records = new Set()
    sfx.click()
    toast('PASADA DESCARTADA')
    renderBoard()
  })

  renderModes()
  renderBoard()

  return {
    show() {
      visible = true
      renderModes()
      renderBoard()
    },
    hide() {
      visible = false
      if (rec.state === 'armed') rec.reset()
    },
    frame() {
      if (settings.lapMode) return lapFrame()
      const t = performance.now() / 1000
      let s = rec.state
      const bars = signalBars()
      if (T.status !== 'ok' && s !== 'running') s = 'nogps'
      else if (s !== 'running' && bars < 2) s = 'weak'
      if (s === 'done' || (s === 'idle' && shown && T.v > 0.7)) s = shown ? 'done' : 'idle'
      set(status, s, 'data-s')

      let big = ''
      let sub = ''
      if (s === 'nogps') {
        big = T.status === 'denied' ? 'SIN PERMISO GPS' : 'BUSCANDO GPS'
        sub = T.status === 'denied' ? 'Activa la ubicación para esta web' : 'Sal a cielo abierto'
      } else if (s === 'weak') {
        big = 'GPS DEBIL'
        sub = `Precisión ±${Math.round(T.acc)} m · espera a que baje de 20 m`
      } else if (s === 'idle') {
        big = 'PARA LA MOTO'
        sub = 'El crono se arma solo al estar parado'
      } else if (s === 'armed') {
        big = '¡LISTO!'
        sub = shown?.marks[mode()] ? `Última ${MARKS[mode()].label}: ${fmtT(shown.marks[mode()].t)} s · sal cuando quieras` : 'Sal cuando quieras'
      } else if (s === 'running') {
        sub = 'Toca la pantalla para cancelar'
      } else if (s === 'done') {
        const h = shown?.marks[mode()]
        big = h ? `${MARKS[mode()].label}` : 'PASADA INCOMPLETA'
        sub = h ? 'Detente para la siguiente' : `No llegaste a ${MARKS[mode()].label}`
      }
      set(k('big'), big)
      set(k('sub'), sub)
      k('big').classList.toggle('blink', s === 'armed')
      k('light').hidden = s !== 'armed'
      k('light').classList.toggle('green', s === 'armed')

      const timer = k('timer')
      const live = rec.live(t)
      const showTimer = s === 'running' || (s === 'done' && shown?.marks[mode()])
      timer.hidden = !showTimer
      k('live').hidden = s !== 'running'
      k('record').hidden = !(s === 'done' && records.has(mode()))
      k('discard').hidden = !shown || s === 'running' || s === 'nogps'
      if (s === 'running' && live) {
        set(timer, segPad(live.elapsed.toFixed(2), 5))
        set(k('lv'), String(Math.round(toSpeed(T.vDisp))))
        set(k('lvu'), speedUnit())
        set(k('ld'), String(Math.round(live.d)))
        if (rec.marks !== board._marks) {
          board._marks = rec.marks
          renderBoard()
        }
      } else if (s === 'done' && shown?.marks[mode()]) {
        set(timer, segPad(fmtT(shown.marks[mode()].t), 5))
      }
      if (flash.size) {
        for (const id of flash) $$(board, `[data-id="${CSS.escape(id)}"]`).forEach((r) => r.classList.add('flash'))
        flash = new Set()
      }
    },
  }
}
