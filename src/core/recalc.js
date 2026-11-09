// Récords rehechos con la caja negra (una sola vez, al arrancar la versión de 2026-11-09).
//
// Hasta esa versión, en el iPhone la inclinación salía con los ejes del giroscopio cambiados (71-72°
// donde había 35°), y parado la velocidad se sacaba de saltos de posición (129 km/h falsos, y con ellos
// la G). Aquí se vuelven a calcular la punta, la inclinación y la G de cada salida guardada en la caja
// negra con el análisis nuevo del Blackbox, y se quitan los logros de esas tres cosas que ya no se
// cumplen. Las pasadas del crono conservan sus tiempos (no guardaban los sensores).
//
// Si el análisis no se puede cargar (sin conexión: ese trozo no está en la caché de la app), no pasa
// nada: se reintenta en el siguiente arranque.
import { totals, saveTotals, settings } from './store.js'
import { idbStore, readSession } from './blackbox.js'
import { revokeAchievements } from './achievements.js'

export const CALC_VERSION = 2
const CATS = ['speed', 'lean', 'g']

/**
 * Rehace los récords si aún no se ha hecho. Devuelve lo que ha cambiado (o null si no tocaba o no se
 * pudo). `analyze` y `store` se pueden pasar (tests); si no, se cargan.
 */
export async function recalcRecords({ store = null, analyze = null } = {}) {
  if ((totals.calcVersion || 1) >= CALC_VERSION) return null
  let metas = []
  try {
    store ??= typeof indexedDB === 'undefined' ? null : idbStore()
    metas = store ? await store.listMeta() : []
  } catch {
    metas = []
  }
  metas = metas.filter((m) => m.source !== 'demo')
  if (metas.length && !analyze) {
    try {
      analyze = (await import('../blackbox/process.js')).analyze
    } catch {
      return null
    }
  }
  const before = { maxV: totals.maxV, maxLeanL: totals.maxLeanL, maxLeanR: totals.maxLeanR, maxG: totals.maxG }
  const best = { maxV: 0, maxLeanL: 0, maxLeanR: 0, maxG: 0 }
  let used = 0
  for (const m of metas) {
    try {
      const A = analyze(await readSession(store, m))
      if (A.empty || !A.stats) continue
      const S = A.stats
      best.maxV = Math.max(best.maxV, S.vMax || 0)
      best.maxLeanL = Math.max(best.maxLeanL, S.leanL || 0)
      best.maxLeanR = Math.max(best.maxLeanR, S.leanR || 0)
      best.maxG = Math.max(best.maxG, S.gTot || 0)
      used++
    } catch {
      /* una salida rota no para las demás */
    }
    // Que la app no se quede congelada entre salida y salida
    await new Promise((r) => setTimeout(r, 0))
  }
  // Sin salidas guardadas no se puede comprobar nada: la punta se queda; inclinación y G, a cero
  if (used) totals.maxV = best.maxV
  totals.maxLeanL = best.maxLeanL
  totals.maxLeanR = best.maxLeanR
  totals.maxG = best.maxG
  totals.calcVersion = CALC_VERSION
  saveTotals(true)
  const removed = revokeAchievements(CATS)
  return { sessions: used, before, after: { ...best, maxV: totals.maxV }, removed }
}

/** Texto del aviso (fuente pixel: sin tildes). */
export function recalcMessage(r) {
  if (!r) return ''
  const mi = settings.units === 'mph'
  const sp = Math.round((r.after.maxV * 3.6) / (mi ? 1.609344 : 1))
  const head = r.sessions
    ? `RECORDS RECALCULADOS CON LA CAJA NEGRA: PUNTA ${sp} ${mi ? 'MPH' : 'KM/H'}, INCLINACION ${Math.round(r.after.maxLeanL)}/${Math.round(r.after.maxLeanR)}, G ${r.after.maxG.toFixed(2)}`
    : 'INCLINACION Y G A CERO: LAS ANTERIORES ESTABAN MAL MEDIDAS'
  return r.removed.length ? `${head}. LOGROS QUITADOS: ${r.removed.map((a) => a.title).join(', ')}` : head
}

/** Para el arranque de la app: lo hace y avisa con `notify(texto)`. */
export async function fixOldRecords(notify) {
  const r = await recalcRecords().catch(() => null)
  if (r && (r.sessions || r.before.maxLeanL || r.before.maxLeanR || r.before.maxG)) notify?.(recalcMessage(r), 9000)
  return r
}
