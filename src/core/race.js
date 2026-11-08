// Duelo de aceleración: preparación (los dos parados), árbol de salida, carrera y resultado.
// El rival puede ser otro piloto (por la red), la CPU o tu fantasma (tu mejor pasada).
//
// Reloj compartido online: el retador (host) manda la hora del verde en su reloj; el retado
// calcula la diferencia de relojes con pings (se queda con el de menor ida y vuelta).

import { RunRecorder, traceAt, crossDist, crossSpeed, scoreRace, traceFromSaved, MILE, KMH } from './perf.js'
import { onSample, onHint } from './telemetry.js'
import { fullThrottleTrace, BIKES } from './physics.js'
import { netId } from './store.js'
import { sfx } from './audio.js'

export const RACE_MODES = {
  '1/8': { id: '1/8', kind: 'dist', target: MILE / 8 },
  '1/4': { id: '1/4', kind: 'dist', target: MILE / 4 },
  '0-100': { id: '0-100', kind: 'speed', target: 100 * KMH },
}

const TREE_LEAD = 3.2 // s entre la orden de salida y el verde
const STAGE_HOLD = 1.5 // s con los dos listos antes de encender el árbol
const FOUL_TOL = 0.08 // s de margen por la incertidumbre del GPS al detectar la salida
const now = () => performance.now() / 1000

/** Marca del objetivo en una traza: { t, v } desde la salida. */
function targetCross(pts, mode) {
  if (mode.kind === 'dist') return crossDist(pts, mode.target)
  const t = crossSpeed(pts, mode.target)
  return t == null ? null : { t, v: mode.target }
}

export function cpuOpponent(bikeId) {
  const bike = BIKES[bikeId]
  return {
    kind: 'cpu',
    name: 'CPU',
    bike: bike.name,
    color: bike.color,
    rt: 0.16 + Math.random() * 0.24,
    trace: fullThrottleTrace(bike, 45),
  }
}

export function ghostOpponent(run, name = 'FANTASMA') {
  const pts = traceFromSaved(run.trace)
  const t0 = pts[0].t
  return {
    kind: 'ghost',
    name,
    bike: 'TU MEJOR',
    color: '#9d8cff',
    rt: 0.25,
    trace: pts.map((p) => ({ ...p, t: p.t - t0 })),
  }
}

export class Race {
  /**
   * @param mode   uno de RACE_MODES
   * @param opp    { kind: 'online'|'cpu'|'ghost', name, bike, color, rt?, trace? }
   * @param online { channel, role: 'host'|'guest' } solo si el rival es otro piloto
   */
  constructor({ mode, opp, online = null }) {
    this.mode = mode
    this.online = online
    this.role = online ? online.role : 'host'
    this.phase = 'staging'
    this.green = null
    this.why = null
    this.result = null
    this.me = { staged: false, fin: null, finAt: null, d: 0, v: 0, launched: false, redLight: false }
    this.opp = { ...opp, staged: opp.kind !== 'online', synced: true, fin: null, d: 0, v: 0, prog: null, seen: now() }
    this.clock = { offset: 0, best: Infinity, n: 0 }
    this.stagedSince = null
    this.played = new Set()
    this.subs = new Set()
    this.lastSend = 0
    this.lastPing = 0

    this.rec = new RunRecorder({
      stopAtDist: mode.kind === 'dist' ? mode.target : null,
      stopAtSpeed: mode.kind === 'speed' ? mode.target : null,
      onEvent: (e, data) => this.#onRec(e, data),
    })
    this.unsubs = [onSample((s) => this.rec.feed(s)), onHint((t) => this.rec.hint(t))]
    if (online) {
      this.opp.synced = false
      this.ch = online.channel
      online.onMsg((m) => this.#onMsg(m))
    }
    this.timer = setInterval(() => this.#loop(), 50)
  }

  on(fn) {
    this.subs.add(fn)
    return () => this.subs.delete(fn)
  }
  #emit(ev, data) {
    for (const fn of this.subs) fn(ev, data)
  }

  #send(msg) {
    this.ch?.send({ ...msg, from: netId })
  }

  #onRec(e) {
    if (e === 'launch') this.me.launched = true
    else if (e === 'done') {
      const r = this.rec.result
      // Antes del árbol, una "salida" que se para sola es ruido del GPS: se vuelve a armar
      if (this.green == null && !this.me.redLight) return this.rec.reset()
      const hit = r.reason === 'target' ? targetCross(this.rec.pts, this.mode) : null
      let rt = this.green != null ? r.t0 - this.green : -1
      const foul = this.me.redLight || rt < -FOUL_TOL
      // Dentro del margen de error del GPS se da por salida perfecta
      if (!foul) rt = Math.max(0, rt)
      this.me.fin = hit ? { rt, et: hit.t - r.t0, trap: hit.v, foul } : { rt, et: 0, trap: 0, dnf: true, foul }
      this.me.finAt = now()
      this.#emit('me-finish', this.me.fin)
    }
  }

  /** Salida antes de tiempo confirmada por al menos dos muestras en movimiento. */
  #checkJump() {
    const r = this.rec
    if (this.me.redLight || r.state !== 'running' || r.samples.length < 2 || r.maxV < 2.5) return
    if (this.green == null || r.t0 < this.green - FOUL_TOL) this.#redLight()
  }

  #redLight() {
    if (this.me.redLight) return
    this.me.redLight = true
    sfx.red()
    this.#emit('redlight')
    // Si el árbol no se había encendido, se cancela: no hay carrera
    if (this.phase === 'staging') {
      this.rec.finish('foul')
      if (!this.me.fin) this.#setFin({ rt: -1, et: 0, trap: 0, foul: true, dnf: true })
    }
  }

  #onMsg(m) {
    if (!m || m.from === netId) return
    this.opp.seen = now()
    switch (m.k) {
      case 'stage':
        this.opp.staged = m.staged
        this.opp.synced = m.synced
        break
      case 'ping':
        this.#send({ k: 'pong', t1: m.t1, th: Date.now() })
        break
      case 'pong': {
        const t2 = Date.now()
        const rtt = t2 - m.t1
        this.clock.n++
        if (rtt < this.clock.best) {
          this.clock.best = rtt
          this.clock.offset = m.th - (m.t1 + t2) / 2
        }
        break
      }
      case 'go':
        if (this.role === 'guest' && this.green == null && this.phase === 'staging') {
          const local = m.green - this.clock.offset
          this.#startTree(now() + (local - Date.now()) / 1000)
        }
        break
      case 'prog':
        this.opp.prog = { d: m.d, v: m.v, at: now() }
        break
      case 'fin':
        if (!this.opp.fin) {
          this.opp.fin = m.fin
          this.#emit('opp-finish', m.fin)
        }
        this.#send({ k: 'finack' })
        break
      case 'finack':
        this.finAcked = true
        break
      case 'bye':
        if (this.phase !== 'result') this.#abort('opp-left')
        break
    }
  }

  #startTree(green) {
    this.green = green
    this.phase = 'tree'
    this.#emit('phase', 'tree')
  }

  #abort(why) {
    this.why = why
    this.phase = 'aborted'
    this.#emit('phase', 'aborted')
    this.dispose(false)
  }

  /** Lo que deberían mostrar las luces del árbol ahora mismo. */
  lights(t = now()) {
    const g = this.green
    if (g == null) return { stage: this.me.staged, oppStage: this.opp.staged, amber: 0, green: false }
    return {
      stage: true,
      oppStage: true,
      amber: t >= g - 1.5 ? (t >= g - 1.0 ? (t >= g - 0.5 ? 3 : 2) : 1) : 0,
      green: t >= g && !this.me.redLight,
      red: this.me.redLight,
      oppRed: !!this.opp.fin?.foul && this.opp.fin.rt < 0,
    }
  }

  #loop() {
    const t = now()
    const online = !!this.online
    this.me.staged = this.rec.state === 'armed'
    this.#checkJump()

    if (this.phase === 'staging') {
      if (online) {
        if (this.role === 'guest' && this.clock.n < 8 && t - this.lastPing > 0.25) {
          this.lastPing = t
          this.#send({ k: 'ping', t1: Date.now() })
        }
        if (t - this.lastSend > 0.4) {
          this.lastSend = t
          this.#send({ k: 'stage', staged: this.me.staged, synced: this.role === 'host' || this.clock.n >= 4 })
        }
        if (t - this.opp.seen > 12) return this.#abort('lost')
      }
      const both = this.me.staged && this.opp.staged && this.opp.synced && !this.me.redLight
      if (both) this.stagedSince ??= t
      else this.stagedSince = null
      if (this.role === 'host' && this.stagedSince != null && t - this.stagedSince >= STAGE_HOLD) {
        const green = t + TREE_LEAD
        if (online) {
          const greenEpoch = Date.now() + TREE_LEAD * 1000
          for (const k of [0, 200, 400]) setTimeout(() => this.#send({ k: 'go', green: greenEpoch }), k)
        }
        this.#startTree(green)
      }
    }

    if (this.phase === 'tree') {
      const L = this.lights(t)
      for (let i = 1; i <= L.amber; i++) if (!this.played.has('a' + i)) (this.played.add('a' + i), sfx.amber())
      if (t >= this.green) {
        this.phase = 'racing'
        if (!this.me.redLight) sfx.green()
        this.#emit('phase', 'racing')
      }
    }

    // Progreso propio
    const live = this.rec.live(t)
    if (live && this.green != null) {
      this.me.d = live.d
      this.me.v = live.v
    }
    if (online && t - this.lastSend > 0.25 && (this.phase === 'racing' || this.phase === 'tree')) {
      this.lastSend = t
      this.#send({ k: 'prog', d: +this.me.d.toFixed(2), v: +this.me.v.toFixed(2) })
    }

    // Progreso del rival
    if (this.opp.kind === 'online') {
      const p = this.opp.prog
      if (p) {
        const end = this.mode.kind === 'dist' ? this.mode.target : p.d
        this.opp.d = this.opp.fin ? Math.max(p.d, end) : p.d + p.v * Math.min(1, t - p.at)
        this.opp.v = p.v
      }
      if (this.me.fin && !this.opp.fin && t - this.me.finAt > 25) this.opp.fin = { rt: 0, et: 0, trap: 0, dnf: true }
      if (this.green != null && t - this.opp.seen > 15) this.opp.fin ??= { rt: 0, et: 0, trap: 0, dnf: true }
    } else if (this.green != null) {
      const s = traceAt(this.opp.trace, t - this.green - this.opp.rt)
      this.opp.d = s.d
      this.opp.v = s.v
      if (!this.opp.fin) {
        const hit = targetCross(this.opp.trace, this.mode)
        // Termina en el instante real en que cruza la meta
        if (hit && t - this.green >= this.opp.rt + hit.t) {
          this.opp.fin = { rt: this.opp.rt, et: hit.t, trap: hit.v }
          this.#emit('opp-finish', this.opp.fin)
        } else if (!hit && t - this.green > 40) this.opp.fin = { rt: this.opp.rt, et: 0, trap: 0, dnf: true }
      }
    }

    // Tiempo máximo: si no sale o no llega, no termina
    if (!this.me.fin && this.green != null && t - this.green > 60) {
      if (this.rec.state === 'running') this.rec.finish('timeout')
      else this.#setFin({ rt: 0, et: 0, trap: 0, dnf: true, foul: this.me.redLight })
    }
    if (this.me.fin && online && !this.finAcked && t - (this.lastFin || 0) > 0.8) {
      this.lastFin = t
      this.#send({ k: 'fin', fin: this.me.fin })
    }
    this.#maybeResult()
  }

  #setFin(fin) {
    this.me.fin = fin
    this.me.finAt = now()
    this.#emit('me-finish', fin)
  }

  #maybeResult() {
    if (this.phase === 'result' || this.phase === 'aborted') return
    // Salida nula antes de encender el árbol: pierde quien se movió, sin esperar a nadie
    if (this.green == null) {
      if (this.opp.fin?.foul && !this.me.fin) this.#setFin({ rt: 0, et: 0, trap: 0, dnf: true })
      if (this.me.fin?.foul && !this.opp.fin) this.opp.fin = { rt: 0, et: 0, trap: 0, dnf: true }
    }
    if (!this.me.fin || !this.opp.fin) return
    this.result = scoreRace(this.me.fin, this.opp.fin)
    this.phase = 'result'
    this.#emit('phase', 'result')
    if (this.result.win) sfx.win()
    else sfx.lose()
    // Seguimos mandando "fin" unos segundos para que el rival lo reciba
    setTimeout(() => this.dispose(false), 4000)
  }

  /** Para todo. `bye` avisa al rival si aún no había terminado. */
  dispose(bye = true) {
    if (this.disposed) return
    if (bye && this.phase !== 'result') this.#send({ k: 'bye' })
    this.disposed = true
    clearInterval(this.timer)
    this.unsubs.forEach((u) => u())
    if (this.online) setTimeout(() => this.ch.close(), bye ? 600 : 0)
  }
}
