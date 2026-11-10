// Resumen de una salida: las cifras, «3 cosas de hoy» y la frase que dice la voz al terminar. Todo lo que
// se dice tiene que estar grabado (scripts/voz.mjs, tests/speech.test.js): por eso las frases son fijas
// y los nombres que pones tú (tramos, sitios) se enseñan pero no se dicen.

const MPH = 2.236936
const r1 = (x) => Math.round(x * 10) / 10

/** Duración para decirla: «21 minutos», «1 hora 5 minutos», «40 segundos». */
export function durWords(s) {
  s = Math.max(0, Math.round(s))
  if (s < 60) return `${s} ${s === 1 ? 'segundo' : 'segundos'}`
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  const mins = m ? `${m} ${m === 1 ? 'minuto' : 'minutos'}` : ''
  if (!h) return mins || '1 minuto'
  return `${h} ${h === 1 ? 'hora' : 'horas'}${mins ? ` ${mins}` : ''}`
}
/** Diferencia para decirla: «40 segundos», «1 minuto 20 segundos». */
export function gapWords(s) {
  s = Math.round(Math.abs(s))
  if (s < 60) return `${s} ${s === 1 ? 'segundo' : 'segundos'}`
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m} ${m === 1 ? 'minuto' : 'minutos'}${r ? ` ${r} ${r === 1 ? 'segundo' : 'segundos'}` : ''}`
}
/** Tiempo de vuelta o tramo para decirlo: «32,4 segundos», «1 minuto 32,4 segundos». */
export function lapWords(t) {
  const m = Math.floor(t / 60)
  const sec = (t - m * 60).toFixed(1).replace('.', ',').replace(/,0$/, '')
  return m ? `${m} ${m === 1 ? 'minuto' : 'minutos'} ${sec} segundos` : `${sec} segundos`
}
/** Tiempo para enseñarlo: «1:32.4», «47.2 s», «21 min», «1 h 05». */
export const fmtLap = (t) => (t >= 60 ? `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}` : `${t.toFixed(1)} s`)
export const fmtDur = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}` : `${Math.max(1, Math.round(s / 60))} min`)

/**
 * @param {object} meta   ficha de la sesión al cerrarse (core/blackbox.js)
 * @param {object} o
 * @param {{maxV, leanL, leanR, gMax, brakeMax}} o.trip   máximos de este viaje (telemetría)
 * @param {object} o.before   récords de siempre al empezar (totals)
 * @param {object} o.after    y al terminar
 * @param {{kind: 'seg'|'lap', name, time, best, record}[]} [o.results]  tramos y vueltas del viaje
 * @param {{name, n, avg, best, dur}} [o.route]  tu trayecto, si lo es (core/routes.js)
 * @param {'kmh'|'mph'} [o.units]
 */
export function summarize(meta, { trip = {}, before = {}, after = {}, results = [], route = null, units = 'kmh' } = {}) {
  const mi = units === 'mph'
  const sp = (ms) => Math.round(mi ? ms * MPH : ms * 3.6)
  const spU = mi ? 'millas por hora' : 'kilómetros por hora'
  const spShow = mi ? 'mph' : 'km/h'
  const dist = meta.dist || 0
  const dur = Number.isFinite(meta.lastMove) && Number.isFinite(meta.firstMove) ? meta.lastMove - meta.firstMove : (meta.end - meta.start) / 1000
  const distK = mi ? dist / 1609.344 : dist / 1000
  const cands = [] // [prioridad, texto, frase]
  const better = (k, min = 0) => (after[k] || 0) > (before[k] || 0) + min
  if (better('maxV', 0.3)) cands.push([10, `Récord de punta: ${sp(after.maxV)} ${spShow}`, `Récord de punta: ${sp(after.maxV)} ${spU}`])
  if (better('maxLeanL', 0.5)) cands.push([9, `Récord de inclinación: ${Math.round(after.maxLeanL)}° a la izquierda`, `Récord de inclinación: ${Math.round(after.maxLeanL)} grados izquierda`])
  if (better('maxLeanR', 0.5)) cands.push([9, `Récord de inclinación: ${Math.round(after.maxLeanR)}° a la derecha`, `Récord de inclinación: ${Math.round(after.maxLeanR)} grados derecha`])
  if (better('maxG', 0.02)) cands.push([8, `Récord de G: ${after.maxG.toFixed(2)}`, `Récord de G: ${after.maxG.toFixed(2).replace('.', ',')}`])
  for (const r of results) {
    const what = r.kind === 'lap' ? 'Mejor vuelta' : 'Tramo'
    if (r.record) cands.push([7, `${r.kind === 'lap' ? 'Mejor vuelta' : `Tramo ${r.name}`}: ${fmtLap(r.time)} · ¡récord!`, `${what} en ${lapWords(r.time)}. Nuevo récord`])
    else if (r.kind === 'seg' && Number.isFinite(r.best)) cands.push([5, `Tramo ${r.name}: ${fmtLap(r.time)} (+${(r.time - r.best).toFixed(1)} s)`, `Tramo en ${lapWords(r.time)}, ${String(r1(r.time - r.best)).replace('.', ',')} segundos más lento que tu mejor`])
  }
  if (route && route.n >= 3 && Number.isFinite(route.avg) && Math.abs(dur - route.avg) >= 20) {
    const faster = dur < route.avg
    cands.push([6, `${route.name}: ${fmtDur(dur)}, ${gapWords(route.avg - dur)} ${faster ? 'menos' : 'más'} que tu media`, `Tu trayecto: ${gapWords(route.avg - dur)} ${faster ? 'más rápido' : 'más lento'} que tu media`])
  }
  const lean = Math.max(trip.leanL || 0, trip.leanR || 0)
  if (lean >= 15) {
    const left = (trip.leanL || 0) >= (trip.leanR || 0)
    cands.push([4, `Lo más tumbado: ${Math.round(lean)}° a la ${left ? 'izquierda' : 'derecha'}`, `Más tumbada: ${Math.round(lean)} grados ${left ? 'izquierda' : 'derecha'}`])
  }
  if ((trip.brakeMax || 0) >= 0.35) cands.push([3, `Frenada más fuerte: ${trip.brakeMax.toFixed(2)} G`, `Frenada más fuerte: ${trip.brakeMax.toFixed(2).replace('.', ',')} G`])
  if ((trip.maxV || meta.vmax || 0) > 3) cands.push([2, `Punta: ${sp(trip.maxV || meta.vmax)} ${spShow}`, `Punta: ${sp(trip.maxV || meta.vmax)} ${spU}`])
  // Los récords no se repiten con su versión de «lo más tumbado» o «punta» de hoy
  const seen = new Set()
  const top = cands
    .sort((a, b) => b[0] - a[0])
    .filter(([, t]) => {
      const k = /punta/i.test(t) ? 'v' : /inclinaci|tumbad/i.test(t) ? 'lean' : /G:|G$/.test(t) ? 'g' : t
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .slice(0, 3)
  const head = `Salida guardada. ${String(r1(distK)).replace('.', ',')} ${mi ? 'millas' : 'kilómetros'} en ${durWords(dur)}.`
  return {
    id: meta.id,
    start: meta.start,
    dur,
    dist,
    moving: meta.moving || 0,
    vmax: trip.maxV || meta.vmax || 0,
    stops: meta.stops || 0,
    stopped: meta.stopped || 0,
    leanL: trip.leanL || 0,
    leanR: trip.leanR || 0,
    gMax: trip.gMax || 0,
    brakeMax: trip.brakeMax || 0,
    route: route ? { name: route.name, n: route.n, avg: route.avg, best: route.best } : null,
    results,
    highlights: top.map(([, text]) => text),
    speech: [head, ...top.map(([, , say]) => `${say}.`)].join(' '),
    label: `ÚLTIMA SALIDA: ${(distK).toFixed(1)} ${mi ? 'MI' : 'KM'} · ${fmtDur(dur).toUpperCase()}`.replace('Ú', 'U'),
  }
}
