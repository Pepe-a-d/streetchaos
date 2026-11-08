// Motor de cronometraje: detecta la salida desde parado y calcula los parciales
// (0-100, 100-200, 60 ft, 1/8, 1/4…) interpolando entre muestras GPS.
//
// Los móviles dan GPS a ~1 Hz, así que no basta con mirar qué muestra pasó de 100:
// - la velocidad se interpola linealmente entre muestras (aceleración constante en cada tramo);
// - la distancia se integra con esa misma velocidad (cuadrática en el tramo), y el cruce
//   de una distancia se resuelve con la ecuación de segundo grado;
// - el instante de salida se extrapola hacia atrás con la aceleración de las dos primeras
//   muestras en movimiento (o con el tirón del acelerómetro si lo hay).
// Todos los tiempos internos van en segundos.

export const G = 9.80665
export const KMH = 1 / 3.6
export const MPH = 0.44704
export const FOOT = 0.3048
export const MILE = 1609.344

export const DIST_MARKS = [
  { id: '60ft', label: '60 FT', m: 60 * FOOT },
  { id: '330ft', label: '330 FT', m: 330 * FOOT },
  { id: '1/8', label: '1/8 MILLA', m: MILE / 8 },
  { id: '1000ft', label: '1000 FT', m: 1000 * FOOT },
  { id: '1/4', label: '1/4 MILLA', m: MILE / 4 },
]

export const SPEED_MARKS = [
  { id: 'k0-50', units: 'kmh', label: '0-50', from: 0, to: 50 * KMH },
  { id: 'k0-100', units: 'kmh', label: '0-100', from: 0, to: 100 * KMH },
  { id: 'k0-150', units: 'kmh', label: '0-150', from: 0, to: 150 * KMH },
  { id: 'k0-200', units: 'kmh', label: '0-200', from: 0, to: 200 * KMH },
  { id: 'k100-200', units: 'kmh', label: '100-200', from: 100 * KMH, to: 200 * KMH },
  { id: 'm0-30', units: 'mph', label: '0-30', from: 0, to: 30 * MPH },
  { id: 'm0-60', units: 'mph', label: '0-60', from: 0, to: 60 * MPH },
  { id: 'm0-100', units: 'mph', label: '0-100', from: 0, to: 100 * MPH },
  { id: 'm0-130', units: 'mph', label: '0-130', from: 0, to: 130 * MPH },
  { id: 'm60-130', units: 'mph', label: '60-130', from: 60 * MPH, to: 130 * MPH },
]

export const MARKS = Object.fromEntries([...DIST_MARKS, ...SPEED_MARKS].map((m) => [m.id, m]))

/** Parciales visibles según las unidades elegidas, en orden de aparición. */
export function marksFor(units) {
  return [...SPEED_MARKS.filter((m) => m.units === units), ...DIST_MARKS]
}

export const STILL_V = 0.7 // m/s (~2,5 km/h): se considera parado
export const LAUNCH_V = 1.2 // m/s (~4,3 km/h): ha salido
const STILL_S = 0.9 // segundos parado para armar
const MAX_ARM_ACC = 25 // m de precisión GPS para poder armar
const DROP_V = 2.5 // m/s por debajo de la punta = ha cortado gas
const MAX_RUN_S = 90
const ROLLOUT_M = FOOT

/**
 * Construye la traza desde la salida: primer punto sintético en (t0, v=0, d=0)
 * y distancia integrada con velocidad lineal por tramos.
 */
export function buildTrace(t0, samples) {
  const pts = [{ t: t0, v: 0, d: 0 }]
  for (const s of samples) {
    if (s.t <= t0) continue
    const p = pts[pts.length - 1]
    const v = Math.max(0, s.v)
    pts.push({ t: s.t, v, d: p.d + ((p.v + v) / 2) * (s.t - p.t) })
  }
  return pts
}

/** Primer instante en que la velocidad alcanza V (subiendo). */
export function crossSpeed(pts, V) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (a.v < V && b.v >= V) return a.t + ((V - a.v) / (b.v - a.v)) * (b.t - a.t)
  }
  return null
}

/** Instante y velocidad al alcanzar la distancia D. */
export function crossDist(pts, D) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (b.d < D) continue
    const dt = b.t - a.t
    const acc = (b.v - a.v) / dt
    const need = D - a.d
    let tau
    if (Math.abs(acc) < 1e-9) tau = a.v > 0 ? need / a.v : 0
    else {
      const disc = a.v * a.v + 2 * acc * need
      tau = (-a.v + Math.sqrt(Math.max(0, disc))) / acc
    }
    tau = Math.min(dt, Math.max(0, tau))
    return { t: a.t + tau, v: a.v + acc * tau }
  }
  return null
}

/** Estado en el instante t (para fantasmas y extrapolar en directo). */
export function traceAt(pts, t) {
  if (!pts.length) return { d: 0, v: 0 }
  if (t <= pts[0].t) return { d: 0, v: 0 }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (t > b.t) continue
    const tau = t - a.t
    const acc = (b.v - a.v) / (b.t - a.t)
    return { d: a.d + a.v * tau + (acc * tau * tau) / 2, v: a.v + acc * tau }
  }
  const l = pts[pts.length - 1]
  return { d: l.d + l.v * (t - l.t), v: l.v }
}

/** Calcula todos los parciales a partir de la traza. */
export function computeMarks(pts, { rollout = false } = {}) {
  let tStart = pts[0].t
  if (rollout) {
    const r = crossDist(pts, ROLLOUT_M)
    if (!r) return { tStart: null, marks: {} }
    tStart = r.t
  }
  const marks = {}
  for (const m of SPEED_MARKS) {
    const tTo = crossSpeed(pts, m.to)
    if (tTo == null) continue
    if (m.from === 0) marks[m.id] = { t: tTo - tStart }
    else {
      const tFrom = crossSpeed(pts, m.from)
      if (tFrom != null) marks[m.id] = { t: tTo - tFrom }
    }
  }
  for (const m of DIST_MARKS) {
    const c = crossDist(pts, m.m)
    if (c) marks[m.id] = { t: c.t - tStart, v: c.v }
  }
  return { tStart, marks }
}

/** Instante de salida estimado. a = última muestra parada, b y c = primeras en movimiento. */
export function estimateLaunch(a, b, c, hint) {
  const lo = a ? a.t : b.t - 1.5
  const hi = b.t - 0.02
  if (hint != null && hint >= lo - 0.3 && hint <= b.t) return Math.min(hi, Math.max(lo, hint))
  let acc = 6 // m/s² supuesta mientras no hay segunda muestra
  if (c && c.t > b.t) {
    const a1 = (c.v - b.v) / (c.t - b.t)
    if (a1 > 0.5) acc = Math.min(15, a1)
  }
  return Math.min(hi, Math.max(lo, b.t - b.v / acc))
}

/**
 * Grabador de pasadas. Se le pasan muestras {t (s), v (m/s), acc (m), alt}.
 * Estados: idle → armed (parado con GPS bueno) → running → done.
 */
export class RunRecorder {
  constructor({ rollout = false, stopAtDist = null, stopAtSpeed = null, onEvent = () => {} } = {}) {
    this.rollout = rollout
    this.stopAtDist = stopAtDist
    this.stopAtSpeed = stopAtSpeed
    this.onEvent = onEvent
    this.result = null
    this.reset()
  }

  reset() {
    this.state = 'idle'
    this.stillSince = null
    this.lastStill = null
    this.pre = []
    this.samples = []
    this.pts = []
    this.t0 = null
    this.tStart = null
    this.hintT = null
    this.marks = {}
    this.maxV = 0
  }

  /** Tirón detectado por el acelerómetro (segundos, mismo reloj que las muestras). */
  hint(t) {
    if (this.state === 'armed') this.hintT = t
  }

  feed(s) {
    const last = this.samples[this.samples.length - 1] || this.pre[this.pre.length - 1]
    if (last && s.t <= last.t) return
    if (this.state === 'idle' || this.state === 'done') return this.#waitStill(s)
    if (this.state === 'armed') return this.#armed(s)
    if (this.state === 'running') return this.#running(s)
  }

  #waitStill(s) {
    if (s.v < STILL_V && (s.acc ?? 0) <= MAX_ARM_ACC) {
      if (this.stillSince == null) this.stillSince = s.t
      this.lastStill = s
      if (s.t - this.stillSince >= STILL_S) {
        this.state = 'armed'
        this.pre = []
        this.hintT = null
        this.onEvent('armed')
      }
    } else this.stillSince = null
  }

  #armed(s) {
    if (s.v < STILL_V) {
      this.lastStill = s
      this.pre = []
      if ((s.acc ?? 0) > MAX_ARM_ACC * 2) {
        this.state = 'idle'
        this.stillSince = null
        this.onEvent('disarmed')
      }
      return
    }
    this.pre.push(s)
    if (s.v < LAUNCH_V) return
    // ¡Salida!
    this.state = 'running'
    this.samples = [...this.pre]
    this.pre = []
    this.marks = {}
    this.maxV = 0
    this.#update()
    this.onEvent('launch', { t0: this.t0 })
    this.#checkEnd()
  }

  #running(s) {
    this.samples.push(s)
    this.#update()
    this.#checkEnd()
  }

  #update() {
    const [b, c] = this.samples
    this.t0 = estimateLaunch(this.lastStill, b, c, this.hintT)
    this.pts = buildTrace(this.t0, this.samples)
    const { tStart, marks } = computeMarks(this.pts, { rollout: this.rollout })
    this.tStart = tStart ?? this.t0
    for (const id of Object.keys(marks)) if (!this.marks[id]) this.onEvent('mark', { id, ...marks[id] })
    this.marks = marks
    for (const p of this.pts) this.maxV = Math.max(this.maxV, p.v)
  }

  #checkEnd() {
    const last = this.pts[this.pts.length - 1]
    let reason = null
    if (this.stopAtDist && last.d >= this.stopAtDist) reason = 'target'
    else if (this.stopAtSpeed && last.v >= this.stopAtSpeed) reason = 'target'
    else if (last.v < STILL_V) reason = 'stopped'
    else if (this.maxV > 5 && last.v < this.maxV - DROP_V) reason = 'lift'
    else if (last.t - this.t0 > MAX_RUN_S) reason = 'timeout'
    if (reason) this.finish(reason)
  }

  /** Cierra la pasada y prepara el resultado. */
  finish(reason = 'manual') {
    if (this.state !== 'running') return null
    const pts = this.pts
    const last = pts[pts.length - 1]
    const real = this.samples
    const span = real.length > 1 ? real[real.length - 1].t - real[0].t : 0
    let peakAcc = 0
    for (let i = 1; i < pts.length; i++) {
      const dt = pts[i].t - pts[i - 1].t
      if (dt > 0.05 && i > 1) peakAcc = Math.max(peakAcc, (pts[i].v - pts[i - 1].v) / dt)
    }
    const alts = real.filter((s) => Number.isFinite(s.alt))
    let slope = null
    if (alts.length >= 2 && last.d > 80) slope = ((alts[alts.length - 1].alt - alts[0].alt) / last.d) * 100
    this.result = {
      valid: Object.keys(this.marks).length > 0,
      reason,
      date: Date.now(),
      t0: this.t0,
      tStart: this.tStart,
      rollout: this.rollout,
      marks: this.marks,
      maxV: this.maxV,
      dist: last.d,
      duration: last.t - this.t0,
      peakG: peakAcc / G,
      hz: span > 0 ? (real.length - 1) / span : 0,
      accMax: Math.max(...real.map((s) => s.acc ?? 0)),
      slope,
      trace: pts.map((p) => [round3(p.t - this.tStart), round3(p.v), round3(p.d)]),
    }
    this.state = 'done'
    this.stillSince = null
    this.onEvent('done', this.result)
    return this.result
  }

  /** Lectura en directo extrapolada al instante t (para animar a 60 fps). */
  live(t) {
    if (this.state !== 'running' && this.state !== 'done') return null
    const pts = this.pts
    const l = pts[pts.length - 1]
    if (this.state === 'done') return { elapsed: l.t - this.tStart, d: l.d, v: l.v }
    const dt = Math.min(1.5, Math.max(0, t - l.t))
    return { elapsed: Math.max(0, t - this.tStart), d: l.d + l.v * dt, v: l.v }
  }
}

const round3 = (x) => Math.round(x * 1000) / 1000

/** Reproduce una traza guardada ([t, v, d] relativos a la salida). */
export function traceFromSaved(trace) {
  return trace.map(([t, v, d]) => ({ t, v, d }))
}

/**
 * Resultado de un duelo. Cada lado: { rt, et, foul, dnf }.
 * Gana quien llega antes desde el verde (rt + et); un fallo de salida pierde.
 */
export function scoreRace(me, them) {
  const total = (r) => (r.dnf ? Infinity : r.rt + r.et)
  if (me.foul && !them.foul) return { win: false, why: 'foul' }
  if (them.foul && !me.foul) return { win: true, why: 'their-foul' }
  if (me.foul && them.foul) return { win: me.rt > them.rt, why: 'double-foul' }
  const a = total(me)
  const b = total(them)
  if (a === Infinity && b === Infinity) return { win: false, why: 'both-dnf' }
  return { win: a < b, margin: Math.abs(a - b), why: a === Infinity || b === Infinity ? 'dnf' : 'time' }
}
