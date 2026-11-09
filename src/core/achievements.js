// Logros y niveles. Cada logro mira un dato (km, inclinación, pasadas, duelos...) y se desbloquea al
// llegar a su meta. Bronce, plata y oro dan puntos de experiencia; con los km, las pasadas y las
// victorias forman el nivel. Se comprueba cada pocos segundos y tras cada pasada, duelo o salida.
import { totals, runs, races, bests, load, save, saveTotals } from './store.js'
import { T } from './telemetry.js'

export const TIERS = { b: { name: 'BRONCE', xp: 10 }, s: { name: 'PLATA', xp: 25 }, g: { name: 'ORO', xp: 50 } }

// get(stats) → valor actual; goal → meta; less → la meta es bajar de ella (tiempos)
const A = (id, cat, tier, title, desc, get, goal, { less = false, unit = '' } = {}) => ({ id, cat, tier, title, desc, get, goal, less, unit })
export const ACHIEVEMENTS = [
  A('km10', 'km', 'b', 'PRIMEROS KM', 'Recorre 10 km con la app', (s) => s.km, 10, { unit: 'km' }),
  A('km100', 'km', 'b', 'CIEN KM', 'Recorre 100 km', (s) => s.km, 100, { unit: 'km' }),
  A('km1000', 'km', 's', 'MIL KM', 'Recorre 1.000 km', (s) => s.km, 1000, { unit: 'km' }),
  A('km5000', 'km', 'g', 'TROTAMUNDOS', 'Recorre 5.000 km', (s) => s.km, 5000, { unit: 'km' }),
  A('trip100', 'km', 's', 'ETAPA LARGA', 'Un solo viaje de 100 km', (s) => s.longTrip, 100, { unit: 'km' }),
  A('h1', 'time', 'b', 'UNA HORA', 'Una hora en marcha con la app', (s) => s.hours, 1, { unit: 'h' }),
  A('h10', 'time', 's', 'DIEZ HORAS', 'Diez horas en marcha', (s) => s.hours, 10, { unit: 'h' }),
  A('h50', 'time', 'g', 'CINCUENTA HORAS', 'Cincuenta horas en marcha', (s) => s.hours, 50, { unit: 'h' }),
  A('night', 'night', 'b', 'NOCTAMBULO', 'Rueda de noche, entre las 22 y las 6', (s) => (s.night ? 1 : 0), 1),
  A('v100', 'speed', 'b', 'TRES CIFRAS', 'Pasa de 100 km/h', (s) => s.vmax, 100, { unit: 'km/h' }),
  A('lean20', 'lean', 'b', 'PRIMERA CURVA', 'Tumba 20 grados', (s) => s.lean, 20, { unit: '°' }),
  A('lean35', 'lean', 's', 'BIEN TUMBADO', 'Tumba 35 grados', (s) => s.lean, 35, { unit: '°' }),
  A('lean45', 'lean', 'g', 'RODILLA AL SUELO', 'Tumba 45 grados (en circuito)', (s) => s.lean, 45, { unit: '°' }),
  A('g08', 'g', 's', 'FUERZA G', 'Llega a 0,8 g', (s) => s.g, 0.8, { unit: 'g' }),
  A('g1', 'g', 'g', 'UN G', 'Llega a 1 g (en circuito)', (s) => s.g, 1, { unit: 'g' }),
  A('run1', 'crono', 'b', 'PRIMERA PASADA', 'Haz una pasada completa en el CRONO', (s) => s.runs, 1),
  A('runs10', 'crono', 'b', 'DIEZ PASADAS', 'Diez pasadas completas', (s) => s.runs, 10),
  A('runs50', 'crono', 's', 'CINCUENTA PASADAS', 'Cincuenta pasadas completas', (s) => s.runs, 50),
  A('k6', 'crono', 'b', '0-100 EN 6 S', 'De 0 a 100 km/h en menos de 6 s', (s) => s.k100, 6, { less: true, unit: 's' }),
  A('k4', 'crono', 's', '0-100 EN 4 S', 'De 0 a 100 km/h en menos de 4 s', (s) => s.k100, 4, { less: true, unit: 's' }),
  A('k32', 'crono', 'g', 'COHETE', 'De 0 a 100 km/h en menos de 3,2 s', (s) => s.k100, 3.2, { less: true, unit: 's' }),
  A('q14', 'crono', 's', 'CUARTO EN 14', '1/4 de milla en menos de 14 s', (s) => s.q, 14, { less: true, unit: 's' }),
  A('q11', 'crono', 'g', 'CUARTO EN 11', '1/4 de milla en menos de 11 s', (s) => s.q, 11, { less: true, unit: 's' }),
  A('duel1', 'duel', 'b', 'PRIMER DUELO', 'Corre un duelo en VS', (s) => s.duels, 1),
  A('win1', 'duel', 'b', 'PRIMERA VICTORIA', 'Gana un duelo', (s) => s.wins, 1),
  A('ghost', 'duel', 's', 'MAS QUE TU SOMBRA', 'Gana a tu fantasma', (s) => (s.winGhost ? 1 : 0), 1),
  A('online', 'duel', 'g', 'DE VERDAD', 'Gana a un piloto de verdad', (s) => (s.winOnline ? 1 : 0), 1),
  A('wins10', 'duel', 'g', 'DIEZ VICTORIAS', 'Gana diez duelos', (s) => s.wins, 10),
  A('box1', 'box', 'b', 'CAJA NEGRA', 'Graba tu primera salida', (s) => s.sessions, 1),
  A('box10', 'box', 's', 'DIEZ SALIDAS', 'Diez salidas grabadas', (s) => s.sessions, 10),
]

export const LEVELS = [0, 50, 150, 300, 500, 800, 1200, 1700, 2300, 3000, 4000, 5500, 7500, 10000, 13000]
const RANKS = ['NOVATO', 'NOVATO', 'AFICIONADO', 'AFICIONADO', 'PILOTO', 'PILOTO', 'VETERANO', 'VETERANO', 'EXPERTO', 'EXPERTO', 'PRO', 'PRO', 'LEYENDA', 'LEYENDA', 'LEYENDA']

/** Los datos que miran los logros. */
export function stats() {
  const b = bests()
  return {
    km: totals.odo / 1000,
    longTrip: (totals.longTrip || 0) / 1000,
    hours: (totals.time || 0) / 3600,
    night: Boolean(totals.night),
    vmax: totals.maxV * 3.6,
    lean: Math.max(totals.maxLeanL, totals.maxLeanR),
    g: totals.maxG,
    runs: runs.filter((r) => r.valid).length,
    k100: b['k0-100']?.t ?? Infinity,
    q: b['1/4']?.t ?? Infinity,
    duels: races.length,
    wins: races.filter((r) => r.win).length,
    winGhost: races.some((r) => r.win && r.opp?.kind === 'ghost'),
    winOnline: races.some((r) => r.win && r.opp?.kind === 'online'),
    sessions: totals.sessions || 0,
  }
}

/** Avance de un logro: [actual, meta, hecho]. */
export function progress(a, s = stats()) {
  const v = a.get(s)
  const done = a.less ? v < a.goal : v >= a.goal
  return [Number.isFinite(v) ? v : null, a.goal, done]
}

export const unlocked = load('achievements', {})

export function level() {
  const s = stats()
  const xp = Math.round(ACHIEVEMENTS.reduce((t, a) => t + (unlocked[a.id] ? TIERS[a.tier].xp : 0), 0) + s.km + s.runs * 3 + s.wins * 8)
  let n = 0
  while (n < LEVELS.length - 1 && xp >= LEVELS[n + 1]) n++
  const next = LEVELS[n + 1]
  return { n: n + 1, rank: RANKS[n], xp, from: LEVELS[n], to: next ?? null, frac: next ? (xp - LEVELS[n]) / (next - LEVELS[n]) : 1 }
}

const subs = new Set()
/** fn({ type: 'unlock', a } | { type: 'level', lv } | { type: 'catchup', list }) */
export const onAchievement = (fn) => (subs.add(fn), () => subs.delete(fn))
const emit = (e) => subs.forEach((fn) => fn(e))

let lastLevel = null
/** Comprueba los logros y avisa de los nuevos. */
export function checkAchievements() {
  // Datos que se apuntan aquí: viaje más largo y si has rodado de noche
  if (T.trip > (totals.longTrip || 0)) totals.longTrip = T.trip
  const h = new Date().getHours()
  if (!totals.night && T.status === 'ok' && T.v > 8 && (h >= 22 || h < 6)) totals.night = true
  saveTotals()

  const s = stats()
  const fresh = ACHIEVEMENTS.filter((a) => !unlocked[a.id] && progress(a, s)[2])
  const first = !load('achievementsInit', false)
  for (const a of fresh) unlocked[a.id] = Date.now()
  if (fresh.length) save('achievements', unlocked)
  // La primera vez se apuntan sin fiesta los que ya tenías de antes
  if (first) {
    save('achievementsInit', true)
    lastLevel = level().n
    if (fresh.length) emit({ type: 'catchup', list: fresh })
    return fresh
  }
  for (const a of fresh) emit({ type: 'unlock', a })
  const lv = level()
  if (lastLevel != null && lv.n > lastLevel) emit({ type: 'level', lv })
  lastLevel = lv.n
  return fresh
}

/**
 * Quita los logros de esas categorías que ya no se cumplen (cuando un dato se corrige a la baja,
 * p. ej. la inclinación que se medía mal). Devuelve los quitados.
 */
export function revokeAchievements(cats) {
  const s = stats()
  const out = ACHIEVEMENTS.filter((a) => cats.includes(a.cat) && unlocked[a.id] && !progress(a, s)[2])
  for (const a of out) delete unlocked[a.id]
  if (out.length) save('achievements', unlocked)
  lastLevel = level().n
  return out
}

/** Para los tests y para empezar de cero. */
export function resetAchievements() {
  for (const k of Object.keys(unlocked)) delete unlocked[k]
  save('achievements', unlocked)
  save('achievementsInit', false)
  lastLevel = null
}
