// Red: canales con "presencia" (quién está) y mensajes.
// - Online: Supabase Realtime (no necesita tablas, solo URL y clave pública en .env.local).
// - Local: BroadcastChannel entre pestañas del mismo navegador, para probar sin servidor.

import { netId } from './store.js'

const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_KEY
const forceLocal = new URLSearchParams(location.search).has('local')

let transport = null

export function getTransport() {
  if (transport) return transport
  transport = URL && KEY && !forceLocal ? supabaseTransport() : localTransport()
  return transport
}

function supabaseTransport() {
  let sb = null
  const loading = import('@supabase/supabase-js').then(({ createClient }) => {
    sb = createClient(URL, KEY, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 20 } } })
    t.status = 'ok'
  }).catch(() => {
    t.status = 'error'
  })
  const t = {
    kind: 'online',
    status: 'connecting',
    channel(name, h = {}) {
      let ch = null
      let ready = false
      let closed = false
      let pendingTrack = null
      const queue = []
      loading.then(() => {
        if (closed || !sb) return
        ch = sb.channel('sc:' + name, { config: { broadcast: { self: false }, presence: { key: netId } } })
        ch.on('presence', { event: 'sync' }, () => {
          const st = ch.presenceState()
          h.onSync?.(Object.values(st).map((metas) => metas[metas.length - 1]))
        })
        ch.on('broadcast', { event: 'm' }, ({ payload }) => h.onMsg?.(payload))
        ch.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            ready = true
            t.status = 'ok'
            if (pendingTrack) ch.track(pendingTrack)
            while (queue.length) ch.send({ type: 'broadcast', event: 'm', payload: queue.shift() })
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            t.status = 'error'
          }
        })
      })
      return {
        track(state) {
          pendingTrack = state
          if (ready) ch.track(state)
        },
        send(msg) {
          if (ready) ch.send({ type: 'broadcast', event: 'm', payload: msg })
          else if (queue.length < 20) queue.push(msg)
        },
        close() {
          closed = true
          if (ch) sb.removeChannel(ch)
        },
      }
    },
  }
  return t
}

function localTransport() {
  return {
    kind: 'local',
    status: typeof BroadcastChannel === 'function' ? 'ok' : 'error',
    channel(name, h = {}) {
      const bc = new BroadcastChannel('sc-local:' + name)
      const members = new Map()
      let mine = null
      const sync = () => h.onSync?.([...(mine ? [mine] : []), ...[...members.values()].map((m) => m.state)])
      bc.onmessage = ({ data: m }) => {
        if (m.type === 'pres') {
          const had = members.has(m.id)
          members.set(m.id, { state: m.state, seen: Date.now() })
          if (!had || m.changed) sync()
        } else if (m.type === 'leave') {
          members.delete(m.id)
          sync()
        } else if (m.type === 'hello') {
          if (mine) bc.postMessage({ type: 'pres', id: netId, state: mine, changed: true })
        } else if (m.type === 'msg') h.onMsg?.(m.msg)
      }
      const hb = setInterval(() => {
        if (mine) bc.postMessage({ type: 'pres', id: netId, state: mine })
        let gone = false
        for (const [id, m] of members) if (Date.now() - m.seen > 3500) (members.delete(id), (gone = true))
        if (gone) sync()
      }, 1000)
      bc.postMessage({ type: 'hello' })
      return {
        track(state) {
          mine = state
          bc.postMessage({ type: 'pres', id: netId, state, changed: true })
          sync()
        },
        send(msg) {
          bc.postMessage({ type: 'msg', msg })
        },
        close() {
          clearInterval(hb)
          if (mine) bc.postMessage({ type: 'leave', id: netId })
          bc.close()
        },
      }
    },
  }
}
