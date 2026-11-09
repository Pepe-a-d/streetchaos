// Mapa del analizador: la traza coloreada por el canal elegido, el tramo seleccionado resaltado,
// el cursor sincronizado con las gráficas y marcas (salida, llegada, pasadas, curvas).
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { CHANNELS, rampColor } from './channels.js'
import { pal, isLight, contrast, halo } from './palette.js'

// MapLibre 6 busca su worker junto a su archivo, que Vite mueve
maplibregl.setWorkerUrl(workerUrl)

// CARTO (gratis, sin clave): Dark Matter repintado con el tono del tema, o Positron con un tema claro
const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const BUCKETS = 32
const FONT = ['Montserrat SemiBold', 'Open Sans Bold', 'Noto Sans Regular']

function parseColor(c) {
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c)
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1]
    return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16)).concat(1)
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c)
  return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : null
}

/** Tono (0-360) de un color, para teñir los grises del mapa con el del tema. */
function hueOf(c) {
  const [r, g, b] = (parseColor(c) || [58, 42, 122]).map((x) => x / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 0
  const d = max - min
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return Math.round(((h * 60) + 360) % 360)
}
let HUE = 258

// Los grises pasan al tono del tema con la misma luminosidad
function tint(value) {
  if (typeof value === 'string') {
    const c = parseColor(value)
    if (!c) return value
    const [r, g, b, a] = c
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max - min > 40) return value
    const l = (max + min) / 510
    return isLight() ? `hsla(${HUE}, ${Math.round(10 + 12 * l)}%, ${(l * 98).toFixed(1)}%, ${a})` : `hsla(${HUE}, ${Math.round(18 + 20 * (1 - l))}%, ${(l * 92).toFixed(1)}%, ${a})`
  }
  if (Array.isArray(value)) return value.map(tint)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, tint(v)]))
  return value
}

async function loadStyle() {
  try {
    HUE = hueOf(pal('line'))
    const st = await (await fetch(isLight() ? STYLE_LIGHT : STYLE_URL)).json()
    for (const l of st.layers) {
      if (l.paint) l.paint = tint(l.paint)
      if (l.id === 'background') l.paint['background-color'] = pal('bg')
      if (l.id === 'water') l.paint['fill-color'] = pal('bg2')
    }
    return st
  } catch {
    // Sin conexión: fondo liso, la traza se ve igual
    return { version: 8, glyphs: undefined, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': pal('bg') } }] }
  }
}

export async function createMap(el, { onHover, onPick }) {
  const style = await loadStyle()
  const map = new maplibregl.Map({
    container: el,
    style,
    center: [-8.4, 43.37],
    zoom: 11,
    attributionControl: { compact: true },
    maxPitch: 0,
    dragRotate: false,
    pitchWithRotate: false,
  })
  map.touchZoomRotate.disableRotation()
  map.keyboard.disableRotation()
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right')
  // Basta con el estilo para añadir capas; no hace falta esperar a las teselas
  await new Promise((r) => (map.isStyleLoaded() ? r() : map.once('style.load', r)))
  const hasGlyphs = Boolean(style.glyphs)

  const empty = { type: 'FeatureCollection', features: [] }
  // tolerance 0: sin simplificar, que con poco zoom se comía los tramos cortos y la traza salía a trozos
  map.addSource('track', { type: 'geojson', data: empty, tolerance: 0 })
  map.addSource('cursor', { type: 'geojson', data: empty })
  map.addSource('marks', { type: 'geojson', data: empty })
  const inside = ['case', ['get', 'in'], 1, 0.22]
  map.addLayer({ id: 'track-case', type: 'line', source: 'track', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': halo(), 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 9], 'line-opacity': inside } })
  map.addLayer({ id: 'track', type: 'line', source: 'track', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.2, 16, 5.5], 'line-opacity': inside } })
  map.addLayer({ id: 'marks-dot', type: 'circle', source: 'marks', filter: ['!=', ['get', 'kind'], 'corner'], paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-stroke-color': halo(), 'circle-stroke-width': 2 } })
  if (hasGlyphs)
    map.addLayer({
      id: 'marks-label',
      type: 'symbol',
      source: 'marks',
      minzoom: 0,
      filter: ['any', ['!=', ['get', 'kind'], 'corner'], ['>=', ['zoom'], 13.5]],
      layout: { 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': ['case', ['==', ['get', 'kind'], 'corner'], 10, 11], 'text-offset': [0, -1.2], 'text-anchor': 'bottom', 'text-allow-overlap': false },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': halo(), 'text-halo-width': 1.5 },
    })
  // Comparación: la otra pasada encima, verde donde gana tiempo y roja donde lo pierde
  map.addSource('cmp', { type: 'geojson', data: empty, tolerance: 0 })
  map.addSource('cmp-cursor', { type: 'geojson', data: empty })
  map.addLayer({ id: 'cmp-case', type: 'line', source: 'cmp', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': halo(), 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7] } })
  map.addLayer({ id: 'cmp', type: 'line', source: 'cmp', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 16, 3.5], 'line-dasharray': [2, 1] } })
  map.addLayer({ id: 'cmp-cursor', type: 'circle', source: 'cmp-cursor', paint: { 'circle-radius': 5, 'circle-color': pal('pink'), 'circle-stroke-color': halo(), 'circle-stroke-width': 2 } })
  map.addLayer({ id: 'cursor-halo', type: 'circle', source: 'cursor', paint: { 'circle-radius': 12, 'circle-color': contrast(), 'circle-opacity': 0.18 } })
  map.addLayer({ id: 'cursor', type: 'circle', source: 'cursor', paint: { 'circle-radius': 5.5, 'circle-color': contrast(), 'circle-stroke-color': halo(), 'circle-stroke-width': 2 } })

  let A = null

  // La muestra de la traza más cercana al ratón (solo mira los trozos que hay bajo él)
  function nearest(point) {
    if (!A) return null
    const box = [
      [point.x - 14, point.y - 14],
      [point.x + 14, point.y + 14],
    ]
    const feats = map.queryRenderedFeatures(box, { layers: ['track'] })
    let best = null
    let bd = Infinity
    const seen = new Set()
    for (const f of feats) {
      const { i0, i1 } = f.properties
      if (seen.has(i0)) continue
      seen.add(i0)
      for (let i = i0; i <= i1; i++) {
        if (!A.valid[i]) continue
        const p = map.project([A.lon[i], A.lat[i]])
        const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2
        if (d < bd) (bd = d), (best = i)
      }
    }
    return best
  }
  let raf = 0
  map.on('mousemove', (e) => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      const i = nearest(e.point)
      map.getCanvas().style.cursor = i == null ? '' : 'crosshair'
      if (i != null) onHover(i)
    })
  })
  map.on('click', (e) => {
    const i = nearest(e.point)
    if (i != null) onPick(i)
  })

  return {
    map,
    /** Traza coloreada por `chId`; fuera de [r0, r1] se atenúa. */
    setTrack(an, chId, [r0, r1]) {
      A = an
      const ch = CHANNELS[chId]
      const [lo, hi] = ch.range(A)
      const features = []
      let cur = null
      const close = () => {
        if (cur && cur.geometry.coordinates.length > 1) features.push(cur)
        cur = null
      }
      for (let i = 0; i < A.n; i++) {
        if (!A.valid[i]) {
          close()
          continue
        }
        let val = ch.get(A, i)
        if (ch.abs) val = Math.abs(val)
        const u = Number.isFinite(val) ? (val - lo) / (hi - lo || 1) : 0
        let b = Math.max(0, Math.min(BUCKETS - 1, Math.floor(u * BUCKETS)))
        // Histéresis: no cambia de color por rozar el borde entre dos tonos
        if (cur && Math.abs(u * BUCKETS - (cur.properties.b + 0.5)) < 0.8) b = cur.properties.b
        const ins = i >= r0 && i <= r1
        const pt = [Math.round(A.lon[i] * 1e6) / 1e6, Math.round(A.lat[i] * 1e6) / 1e6]
        if (cur && (cur.properties.b !== b || cur.properties.in !== ins || A.seg[i] !== A.seg[i - 1])) {
          const joined = A.seg[i] === A.seg[i - 1]
          close()
          if (joined) cur = { type: 'Feature', properties: { b, in: ins, i0: i - 1, i1: i, c: rampColor(ch.ramp, (b + 0.5) / BUCKETS) }, geometry: { type: 'LineString', coordinates: [[Math.round(A.lon[i - 1] * 1e6) / 1e6, Math.round(A.lat[i - 1] * 1e6) / 1e6]] } }
        }
        cur ??= { type: 'Feature', properties: { b, in: ins, i0: i, i1: i, c: rampColor(ch.ramp, (b + 0.5) / BUCKETS) }, geometry: { type: 'LineString', coordinates: [] } }
        cur.geometry.coordinates.push(pt)
        cur.properties.i1 = i
      }
      close()
      map.getSource('track').setData({ type: 'FeatureCollection', features })
    },
    setCursor(i) {
      const ok = A && i != null && A.valid[i]
      map.getSource('cursor').setData(ok ? { type: 'Feature', geometry: { type: 'Point', coordinates: [A.lon[i], A.lat[i]] }, properties: {} } : empty)
    },
    /** Marcas: [{i, label, color, kind}] */
    setMarks(list) {
      map.getSource('marks').setData({
        type: 'FeatureCollection',
        features: list.filter((m) => A?.valid[m.i]).map((m) => ({ type: 'Feature', properties: { label: m.label, color: m.color, kind: m.kind }, geometry: { type: 'Point', coordinates: [A.lon[m.i], A.lat[m.i]] } })),
      })
    },
    fit(i0, i1, animate = true) {
      if (!A) return
      let w = Infinity
      let s = Infinity
      let e = -Infinity
      let nn = -Infinity
      for (let i = i0; i <= i1; i++) {
        if (!A.valid[i]) continue
        w = Math.min(w, A.lon[i])
        e = Math.max(e, A.lon[i])
        s = Math.min(s, A.lat[i])
        nn = Math.max(nn, A.lat[i])
      }
      if (Number.isFinite(w))
        map.fitBounds(
          [
            [w, s],
            [e, nn],
          ],
          { padding: 48, maxZoom: 17, duration: animate ? 600 : 0 },
        )
    },
    /** Que el cursor no se salga de la vista. */
    follow(i) {
      if (!A?.valid[i]) return
      const p = map.project([A.lon[i], A.lat[i]])
      const { clientWidth: W, clientHeight: H } = map.getContainer()
      if (p.x < 30 || p.y < 30 || p.x > W - 30 || p.y > H - 30) map.panTo([A.lon[i], A.lat[i]], { duration: 300 })
    },
    /** Otra pasada encima: puntos [lon, lat] y un color por punto (null = quitar). */
    setCompare(coords, colors) {
      if (!coords) {
        map.getSource('cmp').setData(empty)
        map.getSource('cmp-cursor').setData(empty)
        return
      }
      const features = []
      let cur = null
      for (let k = 0; k < coords.length; k++) {
        if (!cur || cur.properties.c !== colors[k]) {
          if (cur) cur.geometry.coordinates.push(coords[k])
          if (cur && cur.geometry.coordinates.length > 1) features.push(cur)
          cur = { type: 'Feature', properties: { c: colors[k] }, geometry: { type: 'LineString', coordinates: [coords[k]] } }
        } else cur.geometry.coordinates.push(coords[k])
      }
      if (cur && cur.geometry.coordinates.length > 1) features.push(cur)
      map.getSource('cmp').setData({ type: 'FeatureCollection', features })
    },
    setCompareCursor(lon, lat) {
      map.getSource('cmp-cursor').setData(Number.isFinite(lon) ? { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} } : empty)
    },
    resize: () => map.resize(),
  }
}
