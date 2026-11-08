// Ayudas de interfaz: formato de unidades y tiempos, avisos y atajos del DOM.
import { settings } from '../core/store.js'
import { MPH, MARKS } from '../core/perf.js'

export const $ = (root, sel) => root.querySelector(sel)
export const $$ = (root, sel) => [...root.querySelectorAll(sel)]

export function html(str) {
  const t = document.createElement('template')
  t.innerHTML = str.trim()
  return t.content.firstElementChild
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export const speedUnit = () => (settings.units === 'mph' ? 'MPH' : 'KM/H')
export const toSpeed = (ms) => (settings.units === 'mph' ? ms / MPH : ms * 3.6)
export const distUnit = () => (settings.units === 'mph' ? 'MI' : 'KM')
export const toDist = (m) => (settings.units === 'mph' ? m / 1609.344 : m / 1000)

/** Número para el display de 7 segmentos: "!" es un hueco del ancho de un dígito. */
export function segPad(n, width) {
  const s = String(n)
  return s.length >= width ? s : '!'.repeat(width - s.length) + s
}

export const fmtT = (s, d = 2) => (s == null || !Number.isFinite(s) ? '--.--' : s.toFixed(d))

export function fmtClock(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

export function markLabel(id) {
  const m = MARKS[id]
  if (!m) return id
  if (m.units) return `${m.label} ${m.units === 'mph' ? 'MPH' : 'KM/H'}`
  return m.label
}

export const fmtBytes = (n) => (n < 1048576 ? `${Math.ceil(n / 1024)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB` : `${(n / 1073741824).toFixed(1)} GB`)

export function fmtDate(ts) {
  const d = new Date(ts)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

let toastEl = null
let toastTimer = 0
export function toast(msg, ms = 2600) {
  toastEl?.remove()
  toastEl = html(`<div class="toast">${esc(msg)}</div>`)
  document.body.append(toastEl)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl?.remove(), ms)
}

/** Capa a pantalla completa. Devuelve el elemento; se cierra con .remove(). */
export function layer(inner, cls = '') {
  const el = html(`<div class="layer ${cls}">${inner}</div>`)
  document.body.append(el)
  return el
}

/** Solo escribe en el DOM si el valor cambia (se llama 60 veces por segundo). */
export function setter() {
  const cache = new Map()
  return (el, val, prop = 'textContent') => {
    if (cache.get(el) === val) return
    cache.set(el, val)
    if (prop === 'textContent') el.textContent = val
    else el.setAttribute(prop, val)
  }
}
