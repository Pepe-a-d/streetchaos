// En el móvil: los tramos del Blackbox y el circuito, cronometrados en directo (core/live.js). Avisa por
// voz al acabar cada uno, lo apunta en la caja negra y en el resumen de la salida, y guarda aquí tu mejor
// tiempo (para compararte con él la próxima vez aunque el Blackbox aún no se haya enterado).
import { settings, setSetting, load, save } from './store.js'
import { T, onSample } from './telemetry.js'
import { ignitionOn } from './ignition.js'
import { createTimer, gatesOf, gateFrom, profileFrom } from './live.js'
import { onSegments } from './cloud.js'
import { logEvent } from './logger.js'
import { addResult } from './trips.js'
import { say } from './voice.js'
import { lapWords } from './tripsum.js'
import { sfx } from './audio.js'

const subs = new Set()
/** Estado para la pantalla: { cur: { name, kind, n, t0, delta, d } | null, last, laps } */
export const live = { cur: null, last: null, laps: [] }
export const onLive = (fn) => (subs.add(fn), () => subs.delete(fn))
const changed = (e) => subs.forEach((fn) => fn(e))

let segs = load('segs', []) // [{ id, name, points, length, closed, best, prof }]
let timers = []
let lapTimer = null

function buildSegments() {
  timers = segs
    .filter((g) => Array.isArray(g.points) && g.points.length >= 2 && !g.closed)
    .map((g) => {
      const { start, end } = gatesOf(g.points, false)
      const ref = Array.isArray(g.prof) && g.prof.length === 101 ? { prof: g.prof, length: g.length } : null
      return createTimer({ id: g.id, name: g.name, start, end, length: g.length, closed: false, best: g.best, ref }, (e) => event(e, g))
    })
}

/** Circuito para las vueltas: { name, gate, best, ref } (lo marcas tú o viene del Blackbox). */
export const track = () => load('track', null)
function buildLaps() {
  const t = track()
  lapTimer = t && settings.lapMode ? createTimer({ id: 'track', name: t.name || 'Circuito', start: t.gate, end: t.gate, closed: true, best: t.best, ref: t.ref, length: t.ref?.length }, (e) => event(e, null)) : null
  live.laps = []
}

/** Marca la meta aquí: donde estás y hacia donde vas (hace falta ir en marcha, o haber ido hace poco). */
export function markFinishHere(name = 'Circuito') {
  const f = T.fix
  if (!f || T.heading == null) return false
  save('track', { name, gate: gateFrom(f.lat, f.lon, T.heading), best: null, ref: null, at: Date.now() })
  buildLaps()
  return true
}
/** Usa un circuito del Blackbox (un tramo cerrado): su meta y su mejor vuelta. */
export function useCircuit(id) {
  const g = segs.find((x) => x.id === id)
  if (!g) return false
  const { start } = gatesOf(g.points, true)
  save('track', { name: g.name, gate: start, best: g.best ?? null, ref: Array.isArray(g.prof) ? { prof: g.prof, length: g.length } : null, from: id, at: Date.now() })
  buildLaps()
  return true
}
export function clearTrack() {
  save('track', null)
  buildLaps()
}
export const circuits = () => segs.filter((g) => g.closed)
export const segmentCount = () => segs.filter((g) => !g.closed).length

function event(e, seg) {
  if (e.type === 'start') {
    live.cur = { name: e.name, kind: e.kind, n: e.n, t0: e.t0, delta: NaN, d: 0 }
    if (e.kind === 'seg') sfx.mark()
  } else if (e.type === 'tick') {
    if (live.cur && live.cur.name === e.name) Object.assign(live.cur, { t0: e.t0, delta: e.delta, d: e.d })
  } else if (e.type === 'abort') {
    if (live.cur?.name === e.name) live.cur = null
  } else if (e.type === 'finish') {
    live.last = { ...e, at: performance.now() / 1000 }
    if (live.cur?.name === e.name && e.kind === 'seg') live.cur = null
    if (e.kind === 'lap') live.laps.push({ n: e.n, time: e.time, record: e.record })
    logEvent(e.kind, { id: e.id, name: e.name, n: e.n, time: Math.round(e.time * 1000) / 1000, record: e.record }, e.t)
    addResult({ kind: e.kind, name: e.name, n: e.n, time: e.time, best: e.best, record: e.record })
    e.record ? sfx.record() : sfx.done()
    const what = e.kind === 'lap' ? `Vuelta ${e.n}` : 'Tramo'
    const tail = !Number.isFinite(e.best) ? '' : e.record ? (e.kind === 'lap' ? ' Mejor vuelta.' : ' Nuevo récord.') : ` ${String(Math.round((e.time - e.best) * 10) / 10).replace('.', ',')} segundos más lento que tu mejor.`
    say(`${what} en ${lapWords(e.time)}.${tail}`, { kind: 'live', urgent: true })
    // Tu nuevo mejor, guardado aquí
    if (e.record) {
      if (seg) {
        seg.best = e.time
        seg.prof = profileFrom(e.pts, e.length)
        save('segs', segs)
      } else {
        const t = track()
        if (t) save('track', { ...t, best: e.time, ref: { pts: e.pts, length: e.length } })
      }
    }
  }
  changed(e)
}

export function initSegments() {
  buildSegments()
  buildLaps()
  onSegments((list) => {
    segs = list.map((g) => {
      // Si aquí tienes un tiempo mejor que el del Blackbox, se queda el tuyo
      const mine = segs.find((x) => x.id === g.id)
      return mine && Number.isFinite(mine.best) && (!Number.isFinite(g.best) || mine.best < g.best) ? { ...g, best: mine.best, prof: mine.prof } : g
    })
    save('segs', segs)
    buildSegments()
  })
  onSample((s) => {
    if (!ignitionOn()) return
    for (const tm of timers) tm.feed(s)
    lapTimer?.feed(s)
  })
}

export function setLapMode(on) {
  setSetting('lapMode', !!on)
  buildLaps()
  if (!on && live.cur?.kind === 'lap') live.cur = null
  changed({ type: 'mode' })
}
