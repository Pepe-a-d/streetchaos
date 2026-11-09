// Caja negra en la nube: el móvil sube cada salida y el Blackbox las baja, solo con la clave de
// sincronización de ese móvil. Los archivos están en un almacén privado; esta función, con la clave
// secreta del proyecto, da URLs firmadas de subida y bajada a quien tenga la clave.
//
// POST { action, key, id?, meta? }
//   put    → URL firmada para subir <id>.scb
//   commit → comprueba que el archivo está y guarda su ficha
//   list   → fichas de las salidas de esa clave
//   get    → URL firmada para bajar <id>.scb (5 min)
//   del    → borra una salida
import { createClient } from 'npm:@supabase/supabase-js@2'

const BUCKET = 'telemetry'
const QUOTA = 600 * 1024 * 1024 // por clave
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function secretKey() {
  try {
    const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default
    if (k) return k
  } catch {
    /* sin claves nuevas: la antigua */
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
}
const sb = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false } })

/** Carpeta de una clave: no se guarda la clave, solo su huella. */
async function folderOf(key: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('streetchaos:' + key))
  return [...new Uint8Array(h)].slice(0, 20).map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Solo POST' }, 405)
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'JSON no válido' }, 400)
  }
  const key = String(body.key ?? '')
  if (!/^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/.test(key)) return json({ error: 'Clave no válida' }, 400)
  const folder = await folderOf(key)
  const id = body.id == null ? null : String(body.id)
  if (id !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ error: 'Id no válido' }, 400)
  const path = `${folder}/${id}.scb`
  const needId = () => (id ? null : json({ error: 'Falta el id' }, 400))

  try {
    switch (body.action) {
      case 'put': {
        if (needId()) return needId()!
        const { data: rows } = await sb.from('bb_cloud').select('id, size').eq('folder', folder)
        const used = (rows ?? []).filter((r) => r.id !== id).reduce((s, r) => s + Number(r.size || 0), 0)
        if (used > QUOTA) return json({ error: 'Esta clave ya ocupa demasiado: borra salidas antiguas' }, 413)
        const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true })
        if (error) throw error
        return json({ url: data.signedUrl, token: data.token, path: data.path })
      }
      case 'commit': {
        if (needId()) return needId()!
        const meta = body.meta
        if (!meta || typeof meta !== 'object' || JSON.stringify(meta).length > 30000) return json({ error: 'Ficha no válida' }, 400)
        const { data: files, error: e1 } = await sb.storage.from(BUCKET).list(folder, { search: `${id}.scb`, limit: 5 })
        if (e1) throw e1
        const f = files?.find((x) => x.name === `${id}.scb`)
        if (!f) return json({ error: 'No ha llegado el archivo' }, 409)
        const size = Number(f.metadata?.size ?? 0)
        const { error } = await sb.from('bb_cloud').upsert({ folder, id, meta, size, updated_at: new Date().toISOString() })
        if (error) throw error
        return json({ ok: true, size })
      }
      case 'list': {
        const { data, error } = await sb.from('bb_cloud').select('id, meta, size, updated_at').eq('folder', folder).order('updated_at', { ascending: false }).limit(2000)
        if (error) throw error
        return json({ sessions: data })
      }
      case 'get': {
        if (needId()) return needId()!
        const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 300)
        if (error) throw error
        return json({ url: data.signedUrl })
      }
      case 'del': {
        if (needId()) return needId()!
        await sb.storage.from(BUCKET).remove([path])
        const { error } = await sb.from('bb_cloud').delete().eq('folder', folder).eq('id', id)
        if (error) throw error
        return json({ ok: true })
      }
      default:
        return json({ error: 'Acción desconocida' }, 400)
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
