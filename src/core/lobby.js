// Lobby: quién hay cerca con la app abierta y retos entre pilotos.
// Cada piloto se anuncia en la celda geohash de 6 caracteres (~1,2 × 0,6 km) donde está
// y escucha esa celda y sus 8 vecinas; luego se filtra por distancia real.

import { getTransport } from './net.js'
import { geohash, geohashNeighborhood, haversine } from './geo.js'
import { T, onSample } from './telemetry.js'
import { settings, netId } from './store.js'

const channels = new Map() // celda → { ch, members }
let ownCell = null
let unsub = null
let lastTrack = 0
let busy = false
const listeners = new Set()
const pending = new Map() // raceId → { resolve, timer, resend }
const answered = new Map() // raceId → 'shown' | 'accept' | 'decline'

export const lobby = {
  active: false,
  riders: [],
  onChallenge: null,
  onCancel: null,
  get kind() {
    return getTransport().kind
  },
  get status() {
    return getTransport().status
  },
}

export const onLobby = (fn) => (listeners.add(fn), () => listeners.delete(fn))
const emit = () => listeners.forEach((fn) => fn(lobby))

export function me() {
  const f = T.fix
  return {
    id: netId,
    name: settings.name || 'PILOTO',
    bike: settings.bike || '',
    color: settings.color,
    // Unos 10 m de precisión: suficiente para el radar sin dar la posición exacta
    lat: f ? +f.lat.toFixed(4) : null,
    lon: f ? +f.lon.toFixed(4) : null,
    v: f ? +f.v.toFixed(1) : 0,
    busy,
    ts: Date.now(),
  }
}

export function startLobby() {
  if (lobby.active) return
  lobby.active = true
  unsub = onSample(() => refresh())
  refresh(true)
}

export function stopLobby() {
  lobby.active = false
  unsub?.()
  for (const { ch } of channels.values()) ch.close()
  channels.clear()
  ownCell = null
  lobby.riders = []
  emit()
}

export function setBusy(b) {
  busy = b
  refresh(true)
}

function refresh(force = false) {
  if (!lobby.active || !T.fix) return
  const cell = geohash(T.fix.lat, T.fix.lon, 6)
  const want = new Set(geohashNeighborhood(cell))
  const tr = getTransport()
  for (const [c, entry] of channels) if (!want.has(c)) (entry.ch.close(), channels.delete(c))
  for (const c of want) {
    if (channels.has(c)) continue
    const entry = { members: [] }
    entry.ch = tr.channel('cell:' + c, {
      onSync: (list) => {
        entry.members = list
        rebuild()
      },
      onMsg: onMessage,
    })
    channels.set(c, entry)
  }
  if (cell !== ownCell) {
    if (ownCell && channels.has(ownCell)) channels.get(ownCell).ch.track({ id: netId, gone: true, ts: Date.now() })
    ownCell = cell
    force = true
  }
  if (force || Date.now() - lastTrack > 3000) {
    lastTrack = Date.now()
    channels.get(ownCell).ch.track(me())
  }
  rebuild()
}

function rebuild() {
  const byId = new Map()
  for (const { members } of channels.values()) {
    for (const m of members) {
      if (!m || m.id === netId || m.gone || m.lat == null) continue
      const prev = byId.get(m.id)
      if (!prev || m.ts > prev.ts) byId.set(m.id, m)
    }
  }
  const f = T.fix
  lobby.riders = [...byId.values()]
    .map((m) => ({ ...m, dist: f ? haversine(f.lat, f.lon, m.lat, m.lon) : Infinity }))
    .filter((m) => m.dist <= settings.radius && Date.now() - m.ts < 30000)
    .sort((a, b) => a.dist - b.dist)
  emit()
}

function onMessage(msg) {
  if (!msg || msg.to !== netId) return
  if (msg.k === 'challenge') {
    // El retador reenvía hasta tener respuesta: no repetir el aviso y reenviar la respuesta dada
    const prev = answered.get(msg.raceId)
    if (prev) return prev !== 'shown' && send({ k: prev, raceId: msg.raceId, to: msg.from.id })
    if (busy) return send({ k: 'decline', raceId: msg.raceId, to: msg.from.id, why: 'busy' })
    answered.set(msg.raceId, 'shown')
    lobby.onChallenge?.(msg)
  } else if (msg.k === 'accept' || msg.k === 'decline') {
    const p = pending.get(msg.raceId)
    if (p) {
      clearTimeout(p.timer)
      clearInterval(p.resend)
      pending.delete(msg.raceId)
      p.resolve(msg.k === 'accept' ? 'accept' : msg.why === 'busy' ? 'busy' : 'decline')
    }
  } else if (msg.k === 'cancel') lobby.onCancel?.(msg)
}

function send(msg) {
  const own = channels.get(ownCell)
  own?.ch.send({ ...msg, from: msg.from || { id: netId } })
}

/** Reta a un piloto. Resuelve 'accept' | 'decline' | 'busy' | 'timeout' | 'cancel'. */
export function challenge(rider, modeId) {
  const raceId = Math.random().toString(36).slice(2, 10)
  const msg = { k: 'challenge', raceId, to: rider.id, mode: modeId, from: me() }
  const promise = new Promise((resolve) => {
    send(msg)
    const resend = setInterval(() => send({ ...msg, from: me() }), 2000)
    const timer = setTimeout(() => {
      clearInterval(resend)
      pending.delete(raceId)
      resolve('timeout')
    }, 20000)
    pending.set(raceId, { resolve, timer, resend })
  })
  return { raceId, promise, cancel: () => cancelChallenge(raceId, rider.id) }
}

function cancelChallenge(raceId, to) {
  const p = pending.get(raceId)
  if (!p) return
  clearTimeout(p.timer)
  clearInterval(p.resend)
  pending.delete(raceId)
  send({ k: 'cancel', raceId, to })
  p.resolve('cancel')
}

export function reply(msg, accept) {
  const k = accept ? 'accept' : 'decline'
  answered.set(msg.raceId, k)
  send({ k, raceId: msg.raceId, to: msg.from.id })
}

export function raceChannel(raceId, handlers) {
  return getTransport().channel('race:' + raceId, handlers)
}
