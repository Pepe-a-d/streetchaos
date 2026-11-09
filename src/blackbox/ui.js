// Piezas pequeñas de interfaz del Blackbox: escapar texto, avisos y ventanas.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function toast(msg, ms = 3200) {
  document.querySelector('.toast')?.remove()
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  document.body.append(t)
  setTimeout(() => t.remove(), ms)
}

/** Ventana sobre la página; se cierra con Esc, clic fuera o cualquier [data-close]. */
export function modal(inner, { wide = false } = {}) {
  const el = document.createElement('div')
  el.className = 'modal-bg'
  el.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog">${inner}</div>`
  document.body.append(el)
  const onKey = (e) => e.key === 'Escape' && close()
  const close = () => {
    el.remove()
    removeEventListener('keydown', onKey)
  }
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('[data-close]')) close()
  })
  addEventListener('keydown', onKey)
  el.close = close
  return el
}
