// Sacar los datos del móvil: enviar las pasadas para analizarlas (Supabase) o exportarlo todo
// (pasadas, duelos y la telemetría de la caja negra) a un archivo para el ordenador.
import { runs, races, totals, settings } from './store.js'
import { supabaseClient } from './net.js'
import { deviceId } from './device.js'
import { FORMAT, STREAMS, toBase64 } from './blackbox.js'
import { logger } from './logger.js'

function payload() {
  return {
    app: 'streetchaos',
    version: 1,
    exportedAt: new Date().toISOString(),
    device: {
      ua: navigator.userAgent,
      screen: [screen.width, screen.height, devicePixelRatio],
      viewport: [innerWidth, innerHeight],
    },
    settings: { units: settings.units, rollout: settings.rollout, source: settings.source, bike: settings.bike, mount: settings.mount, leanSign: settings.leanSign, gyroAxes: settings.gyroAxes, gpsLag: settings.gpsLag },
    totals,
    runs,
    races,
  }
}

/** Envía las pasadas y los duelos (sin telemetría ni posición) para analizarlos. Devuelve { ok, error }. */
export async function sendForAnalysis() {
  const sb = await supabaseClient()
  if (!sb) return { ok: false, error: 'La app no tiene servidor configurado' }
  const { error } = await sb.from('analysis_uploads').insert({ device: deviceId(), payload: payload() })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/**
 * Todo en un .json: lo de payload() más la telemetría de cada sesión (formato en docs/telemetria.md).
 * Se arma por trozos para no tener en memoria más de una sesión en texto a la vez.
 */
export async function buildExport() {
  const L = logger()
  await L?.flush()
  const head = JSON.stringify({ ...payload(), format: 'streetchaos-export', id: deviceId() })
  const parts = [head.slice(0, -1), `,"telemetry":{"format":${FORMAT},"streams":${JSON.stringify(STREAMS)},"sessions":[`]
  const metas = L ? (await L.list()).sort((a, b) => a.start - b.start) : []
  for (const [i, m] of metas.entries()) {
    const s = await L.read(m)
    parts.push((i ? ',' : '') + JSON.stringify({ ...m, events: s.ev, gps: toBase64(s.gps), imu: toBase64(s.imu), calc: toBase64(s.calc) }))
  }
  parts.push(']}}')
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
  return new File(parts, `streetchaos-${stamp}.json`, { type: 'application/json' })
}

/** Menú de compartir si el móvil lo permite (AirDrop, Drive, correo...); si no, descarga. */
export async function shareFile(file) {
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Street Chaos' })
      return true
    }
  } catch (e) {
    if (e?.name === 'AbortError') return false
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 30000)
  return true
}
