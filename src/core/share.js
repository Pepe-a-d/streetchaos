// Sacar los datos del móvil: enviarlos para analizarlos (Supabase) o descargar una copia.
import { runs, races, totals, settings } from './store.js'
import { supabaseClient } from './net.js'
import { deviceId } from './device.js'

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
    settings: { units: settings.units, rollout: settings.rollout, source: settings.source, bike: settings.bike },
    totals,
    runs,
    races,
  }
}

/** Envía todo para analizarlo. Devuelve { ok, error }. */
export async function sendForAnalysis() {
  const sb = await supabaseClient()
  if (!sb) return { ok: false, error: 'La app no tiene servidor configurado' }
  const { error } = await sb.from('analysis_uploads').insert({ device: deviceId(), payload: payload() })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** Copia en un archivo JSON: menú de compartir si el móvil lo permite, si no, descarga. */
export async function exportFile() {
  const name = `streetchaos-${new Date().toISOString().slice(0, 10)}.json`
  const blob = new Blob([JSON.stringify(payload(), null, 1)], { type: 'application/json' })
  const file = new File([blob], name, { type: 'application/json' })
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Street Chaos' })
      return true
    }
  } catch (e) {
    if (e?.name === 'AbortError') return false
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  return true
}
