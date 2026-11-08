// CRONO: pasadas desde parado. Se arma solo al parar y cronometra al salir.
import { RunRecorder, marksFor, MARKS } from '../core/perf.js'
import { T, onSample, onHint, signalBars } from '../core/telemetry.js'
import { settings, setSetting, addRun, deleteRun, bests } from '../core/store.js'
import { sfx } from '../core/audio.js'
import { $, $$, setter, segPad, toSpeed, speedUnit, fmtT, toast } from './util.js'
import { logEvent } from '../core/logger.js'

const MODES = { kmh: ['k0-100', 'k100-200', '1/8', '1/4'], mph: ['m0-60', 'm60-130', '1/8', '1/4'] }

export function mountCrono(el) {
  let visible = false
  let shown = null // pasada que enseña el tablero
  let records = new Set()
  let flash = new Set()

  const rec = new RunRecorder({ rollout: settings.rollout, onEvent })
  onSample((s) => {
    if (visible || rec.state === 'running') rec.feed(s)
  })
  onHint((t) => rec.hint(t))

  function onEvent(e, data) {
    if (e === 'armed') sfx.armed()
    if (e === 'aborted') {
      logEvent('abort')
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
    <div class="panel board"></div>`

  const k = (n) => $(el, `[data-k="${n}"]`)
  const status = $(el, '.status')
  const board = $(el, '.board')
  const set = setter()

  function renderModes() {
    $(el, '.modes').innerHTML = MODES[settings.units]
      .map((id) => `<button class="chip ${id === mode() ? 'on' : ''}" data-mode="${id}">${MARKS[id].label}</button>`)
      .join('') + `<button class="chip ${settings.rollout ? 'on' : ''}" data-roll title="Rollout de 1 pie, como en las pistas de drag">1FT</button>`
  }
  $(el, '.modes').addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    sfx.click()
    if (b.dataset.mode) setSetting('timerMode', b.dataset.mode)
    else {
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
