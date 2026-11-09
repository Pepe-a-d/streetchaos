// DASH: varias pantallas que se pasan deslizando, cada una con los bloques que elijas.
// Rejilla: en vertical 6×8 casillas y en horizontal 12×4; cada tamaño ocupa lo suyo en cada
// orientación y los bloques se colocan solos, en orden, en el primer hueco donde caben (como
// CSS grid «dense», pero calculado aquí para saber qué no cabe y avisarlo en el editor).
import { settings, setSetting } from '../core/store.js'
import { sfx } from '../core/audio.js'
import { WIDGETS, GROUPS, SIZE_NAMES, sample } from './widgets.js'
import { esc, html, layer, toast } from './util.js'

export const GRID = { p: { cols: 6, rows: 8 }, l: { cols: 12, rows: 4 } }
export const SPANS = {
  p: { s: [2, 1], m: [3, 1], l: [3, 3], w: [6, 2], xl: [6, 3], max: [6, 6] },
  l: { s: [2, 1], m: [3, 1], l: [3, 2], w: [6, 2], xl: [6, 4], max: [12, 3] },
}

export const TEMPLATES = [
  { id: 'road', name: 'CARRETERA', desc: 'Velocidad, datos del viaje, inclinación y G', items: [['speed', 'xl'], ['trip', 's'], ['time', 's'], ['avg', 's'], ['alt', 's'], ['heading', 's'], ['odo', 's'], ['lean', 'l'], ['gforce', 'l']] },
  { id: 'track', name: 'CIRCUITO', desc: 'Inclinación y G en grande, con los máximos', items: [['speed', 'xl'], ['lean', 'l'], ['gforce', 'l'], ['leanmax', 'm'], ['gmax', 'm'], ['top', 'm'], ['clock', 'm']] },
  { id: 'minimal', name: 'MINIMA', desc: 'Solo la velocidad, enorme', items: [['speed', 'max'], ['clock', 'm'], ['gps', 'm'], ['rec', 'm'], ['top', 'm']] },
  { id: 'trip', name: 'VIAJE', desc: 'Hora, distancias, gráficas y altitud', items: [['clock', 'm'], ['trip', 'm'], ['time', 'm'], ['avg', 'm'], ['speedtrace', 'w'], ['alttrace', 'w'], ['heading', 'm'], ['alt', 'm'], ['odo', 'm'], ['top', 'm']] },
  { id: 'empty', name: 'NUEVA', desc: 'Empieza con el velocímetro y añade lo que quieras', items: [['speed', 'xl']] },
]

const uid = () => Math.random().toString(36).slice(2, 9)
const fromTemplate = (t) => ({ id: uid(), name: t.name, items: t.items.map(([w, size]) => ({ id: uid(), w, size })) })
export const defaultPages = () => ['road', 'track', 'minimal'].map((id) => fromTemplate(TEMPLATES.find((t) => t.id === id)))
// Los nombres van en letra de recreativa, que no tiene tildes
const cleanName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ·-]/g, '').trim().slice(0, 14)

function normalize(pages) {
  if (!Array.isArray(pages) || !pages.length) return defaultPages()
  return pages.map((p) => ({
    id: p.id || uid(),
    name: cleanName(p.name) || 'PANTALLA',
    items: (p.items || []).filter((i) => WIDGETS[i.w]).map((i) => ({ id: i.id || uid(), w: i.w, size: WIDGETS[i.w].sizes.includes(i.size) ? i.size : WIDGETS[i.w].sizes[0] })),
  }))
}

/** Coloca los bloques en orden en el primer hueco donde caben. */
export function pack(items, o) {
  const { cols, rows } = GRID[o]
  const occ = Array.from({ length: rows }, () => new Array(cols).fill(false))
  const fits = (r, c, w, h) => {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (occ[y][x]) return false
    return true
  }
  const out = items.map((item) => {
    const [w, h] = SPANS[o][item.size]
    for (let r = 0; r + h <= rows; r++)
      for (let c = 0; c + w <= cols; c++)
        if (fits(r, c, w, h)) {
          for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) occ[y][x] = true
          return { item, r, c, w, h }
        }
    return { item, hidden: true }
  })
  out.free = (size = 's') => {
    const [w, h] = SPANS[o][size]
    for (let r = 0; r + h <= rows; r++) for (let c = 0; c + w <= cols; c++) if (fits(r, c, w, h)) return { r, c, w, h }
    return null
  }
  return out
}

const fitsBoth = (items) => ({ p: !pack(items, 'p').some((x) => x.hidden), l: !pack(items, 'l').some((x) => x.hidden) })

/** Dibujo pequeño de cómo queda una pantalla en vertical (bloques coloreados por grupo). */
export function miniLayout(items, o = 'p') {
  const { cols, rows } = GRID[o]
  const placed = pack(items, o)
  const col = (w) => ['cyan', 'pink', 'yellow', 'green', 'violet'][GROUPS.indexOf(WIDGETS[w].group)] || 'dim'
  return `<svg class="mini" viewBox="0 0 ${cols * 10} ${rows * 10}">${placed
    .filter((p) => !p.hidden)
    .map((p) => `<rect x="${p.c * 10 + 1}" y="${p.r * 10 + 1}" width="${p.w * 10 - 2}" height="${p.h * 10 - 2}" style="fill:var(--${col(p.item.w)})"/>`)
    .join('')}</svg>`
}

/** Icono del hueco que ocupa un tamaño (en vertical). */
const sizeIcon = (sz) => {
  const [w, h] = SPANS.p[sz]
  let cells = ''
  for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++) cells += `<rect x="${x * 5 + 0.5}" y="${y * 5 + 0.5}" width="4" height="4" class="${x < w && y < h ? 'on' : ''}"/>`
  return `<svg class="szi" viewBox="0 0 30 40">${cells}</svg>`
}

// Lápiz de 7x7 para el botón de editar
const PENCIL = '<svg viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M5 0h1v1h1v1h-1v1h-1v1h-1v1h-1v1h-1v1h-2v-2h1v-1h1v-1h1v-1h1v-1h1z"/></svg>'

export function mountDash(el, { onTitle = () => {} } = {}) {
  let pages = normalize(settings.dashPages)
  let cur = Math.max(0, Math.min(pages.length - 1, settings.dashPage | 0))
  let editing = false
  let views = []
  let visible = false
  const land = matchMedia('(orientation: landscape)')
  const o = () => (land.matches ? 'l' : 'p')

  el.innerHTML = `
    <div class="dpages" data-k="pages"></div>
    <nav class="dnav" data-k="nav"></nav>
    <div class="dedit" data-k="edit" hidden>
      <div class="ed-info"><span class="lbl">EDITANDO</span><b data-k="edname"></b><span class="ed-warn" data-k="warn"></span></div>
      <div class="ed-btns">
        <button class="btn small cyan" data-ed="add">+ BLOQUE</button>
        <button class="btn small ghost" data-ed="pages">PANTALLAS</button>
        <button class="btn small" data-ed="done">LISTO</button>
      </div>
    </div>`
  const pagesEl = el.querySelector('[data-k="pages"]')
  const navEl = el.querySelector('[data-k="nav"]')
  const editEl = el.querySelector('[data-k="edit"]')

  const save = () => {
    setSetting('dashPages', pages)
    setSetting('dashPage', cur)
  }

  // ---------- Pintar ----------
  function pageEl(pi) {
    const pg = pages[pi]
    const { cols, rows } = GRID[o()]
    const section = html(`<section class="dpage" data-p="${pi}"><div class="dgrid" style="grid-template-columns:repeat(${cols},minmax(0,1fr));grid-template-rows:repeat(${rows},minmax(0,1fr))"></div></section>`)
    const grid = section.firstChild
    const placed = pack(pg.items, o())
    const list = []
    for (const p of placed) {
      if (p.hidden) continue
      const W = WIDGETS[p.item.w]
      const box = html(`<div class="panel wdg w-${p.item.w} sz-${p.item.size}" data-id="${p.item.id}"></div>`)
      box.style.gridArea = `${p.r + 1} / ${p.c + 1} / span ${p.h} / span ${p.w}`
      grid.append(box)
      list.push({ item: p.item, el: box, api: W.make(box, p.item.size) })
      if (editing && pi === cur) addOverlay(box, p.item)
    }
    if (editing && pi === cur) {
      const slot = placed.free('s')
      if (slot) {
        const add = html(`<button class="wadd" aria-label="Añadir un bloque"><span>+</span><small>NUEVO</small></button>`)
        add.style.gridArea = `${slot.r + 1} / ${slot.c + 1} / span ${slot.h} / span ${slot.w}`
        add.onclick = () => (sfx.click(), addSheet())
        grid.append(add)
      }
      const hidden = placed.filter((p) => p.hidden)
      const warn = el.querySelector('[data-k="warn"]')
      warn.innerHTML = hidden.length
        ? `No caben ${land.matches ? 'en horizontal' : 'en vertical'}: ${hidden.map((p) => `<button data-hid="${p.item.id}">${esc(WIDGETS[p.item.w].title)}</button>`).join(' ')}`
        : ''
    }
    for (const v of list) v.api.frame(0)
    return { section, list }
  }

  function render() {
    pagesEl.innerHTML = ''
    views = pages.map((_, pi) => {
      const { section, list } = pageEl(pi)
      pagesEl.append(section)
      return list
    })
    renderNav()
    pagesEl.scrollLeft = cur * pagesEl.clientWidth
    onTitle(pages[cur].name)
  }

  function renderPage(pi) {
    const { section, list } = pageEl(pi)
    pagesEl.children[pi].replaceWith(section)
    views[pi] = list
  }

  function renderNav() {
    navEl.innerHTML = `
      <div class="dots">${pages.map((p, i) => `<button class="dot ${i === cur ? 'on' : ''}" data-go="${i}" aria-label="${esc(p.name)}"></button>`).join('')}</div>
      <button class="dedit-btn" data-edit aria-label="Editar el DASH">${PENCIL}<span>EDITAR</span></button>`
  }

  // ---------- Pasar de pantalla ----------
  let scrollT = 0
  pagesEl.addEventListener('scroll', () => {
    clearTimeout(scrollT)
    scrollT = setTimeout(() => {
      const i = Math.round(pagesEl.scrollLeft / Math.max(1, pagesEl.clientWidth))
      if (i === cur || editing) return
      cur = Math.max(0, Math.min(pages.length - 1, i))
      setSetting('dashPage', cur)
      renderNav()
      onTitle(pages[cur].name)
    }, 90)
  })
  navEl.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    sfx.click()
    if (b.dataset.go != null) goPage(Number(b.dataset.go))
    if (b.hasAttribute('data-edit')) enterEdit()
  })
  function goPage(i, smooth = true) {
    cur = Math.max(0, Math.min(pages.length - 1, i))
    pagesEl.scrollTo({ left: cur * pagesEl.clientWidth, behavior: smooth ? 'smooth' : 'instant' })
    setSetting('dashPage', cur)
    renderNav()
    onTitle(pages[cur].name)
  }

  // ---------- Editor ----------
  function enterEdit() {
    if (editing) return
    editing = true
    document.body.classList.add('dash-edit')
    navEl.hidden = true
    editEl.hidden = false
    el.querySelector('[data-k="edname"]').textContent = pages[cur].name
    renderPage(cur)
    pagesEl.scrollLeft = cur * pagesEl.clientWidth
  }
  function exitEdit() {
    editing = false
    document.body.classList.remove('dash-edit')
    navEl.hidden = false
    editEl.hidden = true
    save()
    render()
  }
  editEl.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    sfx.click()
    if (b.dataset.ed === 'add') addSheet()
    if (b.dataset.ed === 'pages') pagesSheet()
    if (b.dataset.ed === 'done') exitEdit()
    if (b.dataset.hid) widgetSheet(pages[cur].items.find((i) => i.id === b.dataset.hid))
  })

  const items = () => pages[cur].items
  function moveItem(id, to) {
    const list = items()
    const from = list.findIndex((i) => i.id === id)
    if (from < 0) return
    to = Math.max(0, Math.min(list.length - 1, to))
    if (to === from) return
    const [it] = list.splice(from, 1)
    list.splice(to, 0, it)
    renderPage(cur)
    save()
  }

  /** Capa de edición sobre un bloque: tocar abre sus opciones, arrastrar lo cambia de sitio. */
  function addOverlay(box, item) {
    const ov = html(`<div class="wedit"><b>${esc(WIDGETS[item.w].title)}</b><span>${SIZE_NAMES[item.size]}</span></div>`)
    box.append(ov)
    ov.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      const sx = e.clientX
      const sy = e.clientY
      let dragging = false
      let last = 0
      const move = (ev) => {
        if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) {
          dragging = true
          pagesEl.querySelector(`.wdg[data-id="${item.id}"]`)?.classList.add('dragging')
        }
        if (!dragging || performance.now() - last < 220) return
        const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.wdg')
        if (!t || t.dataset.id === item.id) return
        last = performance.now()
        moveItem(item.id, items().findIndex((i) => i.id === t.dataset.id))
        pagesEl.querySelector(`.wdg[data-id="${item.id}"]`)?.classList.add('dragging')
      }
      const up = () => {
        removeEventListener('pointermove', move)
        removeEventListener('pointercancel', up)
        pagesEl.querySelector('.wdg.dragging')?.classList.remove('dragging')
        if (!dragging) (sfx.click(), widgetSheet(item))
      }
      addEventListener('pointermove', move)
      addEventListener('pointerup', up, { once: true })
      addEventListener('pointercancel', up, { once: true })
    })
  }

  // Hoja que sube desde abajo
  function sheet(title, body) {
    const ly = layer(`<div class="panel sheet"><header class="sh-head"><h3 class="title">${title}</h3><button class="sh-x" data-close aria-label="Cerrar">×</button></header><div class="sh-body">${body}</div></div>`, 'sheet-layer')
    ly.addEventListener('click', (e) => {
      if (e.target === ly || e.target.closest('[data-close]')) (sfx.click(), ly.remove())
    })
    return ly
  }

  function fitNote(list) {
    const f = fitsBoth(list)
    return f.p && f.l ? '' : `No cabe en ${!f.p && !f.l ? 'ninguna orientación' : !f.p ? 'vertical' : 'horizontal'}`
  }

  function widgetSheet(item) {
    if (!item) return
    const W = WIDGETS[item.w]
    const ly = sheet(
      esc(W.title),
      `<p class="tip">${esc(W.desc)}</p>
       <h4 class="lbl">MEDIDA</h4>
       <div class="sizes" data-k="sizes"></div>
       <h4 class="lbl">SITIO</h4>
       <div class="actions"><button class="btn small ghost" data-mv="-1">◀ ANTES</button><button class="btn small ghost" data-mv="1">DESPUES ▶</button></div>
       <div class="actions"><button class="btn small ghost danger" data-rm>QUITAR</button><button class="btn small" data-close>HECHO</button></div>`,
    )
    const sizesEl = ly.querySelector('[data-k="sizes"]')
    const paint = () => {
      sizesEl.innerHTML = W.sizes
        .map((sz) => {
          const note = fitNote(items().map((i) => (i.id === item.id ? { ...i, size: sz } : i)))
          return `<button class="size-opt ${sz === item.size ? 'on' : ''}" data-size="${sz}">${sizeIcon(sz)}<b>${SIZE_NAMES[sz]}</b>${note ? `<small>${note}</small>` : ''}</button>`
        })
        .join('')
    }
    paint()
    ly.addEventListener('click', (e) => {
      const b = e.target.closest('button')
      if (!b) return
      if (b.dataset.size) {
        sfx.click()
        item.size = b.dataset.size
        paint()
        renderPage(cur)
        save()
      } else if (b.dataset.mv) {
        sfx.click()
        moveItem(item.id, items().findIndex((i) => i.id === item.id) + Number(b.dataset.mv))
      } else if (b.hasAttribute('data-rm')) {
        sfx.click()
        pages[cur].items = items().filter((i) => i.id !== item.id)
        renderPage(cur)
        save()
        ly.remove()
      }
    })
  }

  /** Catálogo de bloques con vista previa en vivo. */
  function addSheet() {
    const PREV = { s: 's', m: 'm', l: 'l', w: 'w', xl: 'w', max: 'w' }
    const ly = sheet(
      'NUEVO BLOQUE',
      GROUPS.map(
        (g) => `<h4 class="lbl">${g}</h4><div class="cat">${Object.entries(WIDGETS)
          .filter(([, W]) => W.group === g)
          .map(([id, W]) => `<button class="cat-card" data-add="${id}"><div class="panel wdg prev pv-${PREV[W.sizes[0]]} w-${id} sz-${W.sizes[0]}" data-prev="${id}"></div><b>${esc(W.name)}</b><small>${esc(W.desc)}</small></button>`)
          .join('')}</div>`,
      ).join(''),
    )
    const prevs = [...ly.querySelectorAll('[data-prev]')].map((box) => WIDGETS[box.dataset.prev].make(box, WIDGETS[box.dataset.prev].sizes[0]))
    let t = 0
    const tick = setInterval(() => {
      if (!ly.isConnected) return clearInterval(tick)
      t += 0.25
      for (const p of prevs) p.frame(0.25)
    }, 250)
    prevs.forEach((p) => p.frame(1))
    ly.addEventListener('click', (e) => {
      const b = e.target.closest('[data-add]')
      if (!b) return
      sfx.click()
      const W = WIDGETS[b.dataset.add]
      // El primer tamaño que quepa aquí (y mejor si cabe en las dos orientaciones)
      const tryAdd = (sz) => [...items(), { id: 'x', w: b.dataset.add, size: sz }]
      const order = [...W.sizes].sort((a, z) => Object.keys(SIZE_NAMES).indexOf(a) - Object.keys(SIZE_NAMES).indexOf(z))
      const size = W.sizes.find((sz) => !Object.values(fitsBoth(tryAdd(sz))).includes(false)) || order.find((sz) => !pack(tryAdd(sz), o()).some((x) => x.hidden)) || order[0]
      const it = { id: uid(), w: b.dataset.add, size }
      items().push(it)
      renderPage(cur)
      save()
      ly.remove()
      const note = fitNote(items())
      toast(note ? `${W.title}: ${note.toUpperCase().replace('Ó', 'O')}. QUITA ALGO O ELIGE OTRA MEDIDA` : `${W.title} EN LA PANTALLA`)
      pagesEl.querySelector(`.wdg[data-id="${it.id}"]`)?.classList.add('fresh')
    })
  }

  /** Pantallas: nombre, orden, borrar y añadir desde plantillas. */
  function pagesSheet() {
    const ly = sheet('PANTALLAS', '<div data-k="list"></div><h4 class="lbl">NUEVA PANTALLA</h4><div class="tpls" data-k="tpls"></div><div class="actions"><button class="btn small ghost" data-reset>VOLVER A LAS DE FABRICA</button><button class="btn small" data-close>HECHO</button></div>')
    const listEl = ly.querySelector('[data-k="list"]')
    const paint = () => {
      listEl.innerHTML = pages
        .map(
          (p, i) => `<div class="pg-row ${i === cur ? 'on' : ''}">
            <button class="pg-go" data-pgo="${i}">${miniLayout(p.items)}</button>
            <input class="pg-name" data-name="${i}" value="${esc(p.name)}" maxlength="14" aria-label="Nombre de la pantalla">
            <button class="btn small ghost" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Subir">▲</button>
            <button class="btn small ghost" data-down="${i}" ${i === pages.length - 1 ? 'disabled' : ''} aria-label="Bajar">▼</button>
            <button class="btn small ghost danger" data-del="${i}" ${pages.length === 1 ? 'disabled' : ''} aria-label="Borrar">×</button>
          </div>`,
        )
        .join('')
    }
    ly.querySelector('[data-k="tpls"]').innerHTML = TEMPLATES.map((t) => `<button class="tpl" data-tpl="${t.id}">${miniLayout(t.items.map(([w, size]) => ({ w, size })))}<b>${t.name}</b><small>${esc(t.desc)}</small></button>`).join('')
    paint()
    const rerender = () => {
      save()
      render()
      el.querySelector('[data-k="edname"]').textContent = pages[cur].name
      pagesEl.scrollLeft = cur * pagesEl.clientWidth
    }
    ly.addEventListener('change', (e) => {
      const i = e.target.dataset.name
      if (i == null) return
      pages[i].name = cleanName(e.target.value) || pages[i].name
      e.target.value = pages[i].name
      rerender()
    })
    ly.addEventListener('click', (e) => {
      const b = e.target.closest('button')
      if (!b || b.hasAttribute('data-close')) return
      sfx.click()
      const d = b.dataset
      const swap = (a, z) => {
        ;[pages[a], pages[z]] = [pages[z], pages[a]]
        if (cur === a) cur = z
        else if (cur === z) cur = a
      }
      if (d.pgo != null) cur = Number(d.pgo)
      else if (d.up != null) swap(Number(d.up), Number(d.up) - 1)
      else if (d.down != null) swap(Number(d.down), Number(d.down) + 1)
      else if (d.del != null) {
        if (!confirm(`¿Borrar la pantalla ${pages[d.del].name}?`)) return
        pages.splice(Number(d.del), 1)
        cur = Math.min(cur, pages.length - 1)
      } else if (d.tpl) {
        pages.push(fromTemplate(TEMPLATES.find((t) => t.id === d.tpl)))
        cur = pages.length - 1
      } else if (b.hasAttribute('data-reset')) {
        if (!confirm('¿Volver a las pantallas de fábrica? Se pierden las tuyas.')) return
        pages = defaultPages()
        cur = 0
      } else return
      paint()
      rerender()
    })
  }

  land.addEventListener('change', () => visible && render())

  let slow = 0
  return {
    show() {
      visible = true
      pages = normalize(settings.dashPages ?? pages)
      render()
    },
    hide() {
      visible = false
      if (editing) exitEdit()
    },
    edit() {
      enterEdit()
    },
    title: () => pages[cur]?.name || 'DASH',
    frame(dt) {
      sample(dt)
      for (const v of views[cur] || []) v.api.frame(dt)
      // Las de los lados, de vez en cuando, por si las deslizas
      if ((slow += dt) > 0.5) {
        slow = 0
        for (const i of [cur - 1, cur + 1]) for (const v of views[i] || []) v.api.frame(0.5)
      }
    },
  }
}
