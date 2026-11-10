// Temperatura estimada de los neumáticos. NO se mide (haría falta un sensor): se calcula con un modelo
// térmico sencillo a partir de lo que sí medimos (velocidad, G y, sobre todo, la inclinación) y de lo que
// tú le dices (tipo de neumático, medidas, presiones, pesos) y el tiempo que hace. Calibrado con tus
// medidas de termómetro, el error baja; sin calibrar, fíate más de las tendencias que del número.
//
// Cada rueda tiene una carcasa (se calienta y se enfría en minutos) y la superficie de la banda en tres
// zonas: centro y hombros izquierdo y derecho (en segundos). La inclinación decide qué zona pisa el
// suelo. Calienta: la deformación al rodar (más con poca presión y carga) y el deslizamiento de la goma
// al frenar, acelerar y hacer curva (con las fuerzas que salen de tus G). Enfrían: el aire (más cuanto
// más rápido vas) y el asfalto (o el agua, si llueve).

export const TIRE_TYPES = {
  calle: { name: 'CALLE', desc: 'De calle o turismo', ok: [30, 70], heat: 1 },
  sport: { name: 'SPORT', desc: 'Deportivo de carretera', ok: [45, 85], heat: 1.25 },
  circuito: { name: 'CIRCUITO', desc: 'Para circuito (track-day o slick)', ok: [65, 100], heat: 1.5 },
}

/** Ajustes por defecto (los de una Ninja 125 de serie; se cambian en Garaje → Opciones avanzadas). */
export function defaultTireSettings() {
  return { enabled: false, type: 'calle', front: '100/80-17', rear: '130/70-17', pFront: 2.0, pRear: 2.25, bikeKg: 150, riderKg: 85, frontPct: 48, weather: true, airManual: 15, k: 1, cals: [] }
}
export const tireSettings = (s) => ({ ...defaultTireSettings(), ...(s || {}) })

const G = 9.80665
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** «130/70-17» → medidas en metros y lo que pesa y abulta la goma. */
export function parseSize(txt, fallback = '130/70-17') {
  const m = /(\d{2,3})\s*\/\s*(\d{2})\s*[-\sZRBR]*\s*(\d{2})/i.exec(String(txt || '')) || /(\d{2,3})\s*\/\s*(\d{2})\s*[-\sZRBR]*\s*(\d{2})/i.exec(fallback)
  const W = Number(m[1]) / 1000
  const side = W * (Number(m[2]) / 100)
  const rim = Number(m[3]) * 0.0254
  const D = rim + 2 * side
  const tread = Math.PI * D * W // m² de banda
  const walls = (Math.PI / 2) * (D * D - rim * rim) // m² de los dos flancos
  return { W, D, tread, walls, mass: 20 * tread + 6 * walls } // kg (una 130/70-17, ~5 kg)
}

/** Lo que el modelo necesita de los ajustes. */
export function modelConfig(settings) {
  const s = tireSettings(settings)
  return {
    type: TIRE_TYPES[s.type] ? s.type : 'calle',
    f: { size: parseSize(s.front, '100/80-17'), p: Number(s.pFront) || 2 },
    r: { size: parseSize(s.rear, '130/70-17'), p: Number(s.pRear) || 2.25 },
    mass: (Number(s.bikeKg) || 150) + (Number(s.riderKg) || 85),
    front: clamp((Number(s.frontPct) || 48) / 100, 0.3, 0.7),
    k: clamp(Number(s.k) || 1, 0.1, 10),
  }
}

/** Temperatura de la carretera: el aire, más el sol que calienta el asfalto; mojada, como el aire. */
export function roadTemp({ tAir = 15, sun = 0, wet = false } = {}) {
  return wet ? tAir - 1 : tAir + 0.018 * Math.max(0, sun)
}

/**
 * Un modelo para ir paso a paso (en directo) o por toda una salida (runSeries).
 * @param {object} cfg  modelConfig(...)
 * @param {number|object} init  temperatura de partida (todo igual) o un estado guardado
 */
export function createTireModel(cfg, init = 15) {
  const H = 0.62 // m, altura del centro de gravedad con piloto
  const L = 1.37 // m, distancia entre ejes
  const CRR = 0.018
  const heat = TIRE_TYPES[cfg.type].heat
  const wheel = (w) => {
    const sz = cfg[w].size
    return {
      sz,
      p: cfg[w].p,
      cCore: sz.mass * 1500 * 0.8, // J/K
      cZone: (sz.tread / 3) * 0.003 * 1100 * 1700, // J/K: 3 mm de goma de cada zona
      aZone: sz.tread / 3,
    }
  }
  const W = { f: wheel('f'), r: wheel('r') }
  const T = typeof init === 'object' && init ? JSON.parse(JSON.stringify(init)) : { f: { L: init, C: init, R: init, core: init }, r: { L: init, C: init, R: init, core: init } }

  /**
   * dt (s) con { v (m/s), gLong (g, + acelera), gLat (g, + derecha), lean (°, + derecha) } y el tiempo
   * { tAir, sun (W/m²), wet }.
   */
  function step(dt, inp, env = {}) {
    const v = Math.max(0, Number.isFinite(inp.v) ? inp.v : 0)
    const gLong = Number.isFinite(inp.gLong) ? clamp(inp.gLong, -1.5, 1.5) : 0
    const gLat = Number.isFinite(inp.gLat) ? clamp(inp.gLat, -1.5, 1.5) : 0
    const lean = Number.isFinite(inp.lean) ? clamp(inp.lean, -65, 65) : 0
    const tAir = Number.isFinite(env.tAir) ? env.tAir : 15
    const tRoad = Number.isFinite(env.tRoad) ? env.tRoad : roadTemp(env)
    const wet = !!env.wet
    // Cargas: el peso repartido, lo que pasa a la delantera al frenar y lo que aprieta la curva
    const mg = cfg.mass * G
    const curve = Math.sqrt(1 + gLat * gLat)
    const fzF = clamp(cfg.front - (H / L) * gLong, 0.05, 0.95) * mg * curve
    const fzR = Math.max(0.05 * mg, mg * curve - fzF)
    // Fuerza de frenar o acelerar: frenando, sobre todo la delantera; acelerando, toda la trasera
    const fx = cfg.mass * G * gLong
    const beta = gLong < 0 ? clamp(fzF / (mg * curve), 0.5, 0.85) : 0
    const fxF = gLong < 0 ? fx * beta : 0
    const fxR = gLong < 0 ? fx * (1 - beta) : fx
    // Qué zona pisa el suelo: el centro hasta ~12°, los hombros a partir de ~32°
    const side = smooth(12, 32, Math.abs(lean))
    const zw = { C: 1 - side, L: lean < 0 ? side : 0, R: lean > 0 ? side : 0 }
    // El aire enfría más cuanto más rápido vas; mojado, mucho más
    const h = (8 + 7 * Math.pow(v, 0.78)) * (wet ? 2.5 : 1)
    const hRoad = wet ? 6000 : 2000
    for (const [w, fz, fxw] of [
      ['f', fzF, fxF],
      ['r', fzR, fxR],
    ]) {
      const P = W[w]
      const t = T[w]
      const press = Math.pow(2.2 / clamp(P.p, 0.8, 4), 0.6) // poca presión: más flexión, más calor
      const rolling = v > 0.3 ? CRR * fz * v * press * heat * cfg.k : 0
      // Deslizamiento: la energía de la goma que resbala al transmitir la fuerza (con la rigidez de la huella)
      const fyw = fz * Math.abs(gLat) / curve
      const slip = v > 0.3 ? v * ((fxw * fxw) / (15 * fz) + (fyw * fyw) / (60 * fz)) * heat * cfg.k : 0
      // Carcasa: se lleva el 70 % de la deformación y se enfría por los flancos
      const coreIn = 0.7 * rolling - h * P.sz.walls * (t.core - tAir)
      let toCore = 0
      for (const z of ['L', 'C', 'R']) {
        const gSc = 4 // W/K entre la superficie de una zona y la carcasa
        const inZone = (0.3 * rolling + slip) * zw[z]
        const air = h * P.aZone * (t[z] - tAir)
        // La parte que pisa el suelo en cada vuelta (un 5 % de la zona) le pasa calor al asfalto
        const road = hRoad * P.aZone * 0.05 * zw[z] * (t[z] - tRoad) * (v > 0.3 ? 1 : 0.2)
        const cond = gSc * (t[z] - t.core)
        t[z] += (dt * (inZone - air - road - cond)) / P.cZone
        toCore += cond
      }
      t.core += (dt * (coreIn + toCore)) / P.cCore
    }
    return T
  }

  return {
    step,
    get state() {
      return T
    },
  }
}

/**
 * Toda una salida: { n, dt, v[], gLong[], gLat[], lean[] } → por rueda y zona, la temperatura en cada
 * muestra (Float32Array). env: el tiempo que hacía. init: de qué temperatura partían.
 */
export function runSeries(series, cfg, env = {}, init = null) {
  const m = createTireModel(cfg, init ?? (Number.isFinite(env.tAir) ? env.tAir : 15))
  const out = {}
  for (const w of ['f', 'r']) for (const z of ['L', 'C', 'R', 'core']) out[w + z] = new Float32Array(series.n)
  for (let i = 0; i < series.n; i++) {
    const inp = { v: series.v[i], gLong: series.gLong[i], gLat: series.gLat[i], lean: series.lean[i] }
    // Hueco sin datos (sin GPS): parado
    m.step(series.dt, Number.isFinite(inp.v) ? inp : { v: 0 }, env)
    const s = m.state
    for (const w of ['f', 'r']) for (const z of ['L', 'C', 'R', 'core']) out[w + z][i] = s[w][z]
  }
  out.end = JSON.parse(JSON.stringify(m.state))
  return out
}

/** Cómo está una temperatura para ese tipo de neumático: 'frio' | 'templado' | 'ok' | 'caliente'. */
export function tireState(t, type = 'calle') {
  const [lo, hi] = TIRE_TYPES[type]?.ok || TIRE_TYPES.calle.ok
  if (!Number.isFinite(t)) return 'frio'
  if (t < lo - 10) return 'frio'
  if (t < lo) return 'templado'
  if (t <= hi) return 'ok'
  return 'caliente'
}
export const STATE_NAMES = { frio: 'FRIO', templado: 'TEMPLADO', ok: 'A TEMPERATURA', caliente: 'CALIENTE' }

/** La temperatura que manda en una rueda: la de la zona que estás usando (o el centro, en recta). */
export function workingTemp(w, lean = 0) {
  const side = Math.abs(lean) > 20 ? (lean > 0 ? 'R' : 'L') : null
  return side ? Math.max(w.C, w[side]) : w.C
}

/**
 * Calibra con tus medidas de termómetro al terminar una salida: el factor de calor que mejor cuadra.
 * meas: { fL, fC, fR, rL, rC, rR } (°C, las que tengas); after: minutos entre parar y medir.
 * @returns {{ k, before, after, n }} error medio (°C) antes (con el factor de ahora) y después
 */
export function calibrate(series, settings, env, meas, { after = 1 } = {}) {
  const keys = Object.entries(meas).filter(([, v]) => Number.isFinite(v))
  if (!keys.length) return null
  const cfg0 = modelConfig(settings)
  const err = (k) => {
    const cfg = { ...cfg0, k }
    const r = runSeries(series, cfg, env)
    // Lo que tarda en medir: parado, enfriándose
    const m = createTireModel(cfg, r.end)
    for (let t = 0; t < after * 60; t += 1) m.step(1, { v: 0 }, env)
    const s = m.state
    let e = 0
    for (const [key, v] of keys) e += (s[key[0]][key[1]] - v) ** 2
    return Math.sqrt(e / keys.length)
  }
  const before = err(cfg0.k)
  // Búsqueda en escala logarítmica y luego fina
  let best = { k: cfg0.k, e: before }
  for (let lk = Math.log(0.15); lk <= Math.log(8); lk += 0.1) {
    const e = err(Math.exp(lk))
    if (e < best.e) best = { k: Math.exp(lk), e }
  }
  for (let d = 0.05; d >= 0.005; d /= 2)
    for (const s of [-1, 1]) {
      const k = best.k * Math.exp(s * d)
      const e = err(k)
      if (e < best.e) best = { k, e }
    }
  return { k: best.k, before, after: best.e, n: keys.length }
}

/**
 * El factor de calor con todas tus calibraciones { k, mins } (las más nuevas pesan más, y las medidas
 * tomadas al momento más que las de un rato después, que se han enfriado).
 */
export function combinedK(cals = []) {
  if (!cals.length) return 1
  let s = 0
  let w = 0
  cals.slice(-8).forEach((c, i, arr) => {
    const wt = (i + 1) / arr.length / Math.max(1, c.mins || 1)
    s += Math.log(c.k) * wt
    w += wt
  })
  return Math.exp(s / w)
}

/**
 * Lo que guarda la caja negra del móvil (calc: [t, v, gLong, gLat, lean°] seguidos) en una serie a 10 Hz
 * sin huecos: donde no hay datos, parado.
 */
export function seriesFromCalc(calc, dt = 0.1) {
  const W = 5
  const rows = Math.floor((calc?.length || 0) / W)
  if (!rows) return { n: 0, dt, v: new Float32Array(0), gLong: new Float32Array(0), gLat: new Float32Array(0), lean: new Float32Array(0) }
  const tEnd = calc[(rows - 1) * W]
  const n = Math.max(1, Math.min(200000, Math.round(tEnd / dt) + 1))
  const out = { n, dt, v: new Float32Array(n).fill(NaN), gLong: new Float32Array(n), gLat: new Float32Array(n), lean: new Float32Array(n) }
  for (let r = 0; r < rows; r++) {
    const o = r * W
    const i = Math.round(calc[o] / dt)
    if (!(i >= 0 && i < n)) continue
    out.v[i] = calc[o + 1]
    out.gLong[i] = Number.isFinite(calc[o + 2]) ? calc[o + 2] : 0
    out.gLat[i] = Number.isFinite(calc[o + 3]) ? calc[o + 3] : 0
    out.lean[i] = Number.isFinite(calc[o + 4]) ? calc[o + 4] : 0
  }
  // Huecos cortos (menos de 1 s): lo de antes
  let last = -1
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(out.v[i])) {
      if (last >= 0 && i - last > 1 && i - last <= 10)
        for (let j = last + 1; j < i; j++) (out.v[j] = out.v[last]), (out.gLong[j] = out.gLong[last]), (out.gLat[j] = out.gLat[last]), (out.lean[j] = out.lean[last])
      last = i
    }
  }
  return out
}

/** Una de cada f muestras (para calibrar más rápido: el modelo va bien con pasos de medio segundo). */
export function decimate(series, f = 5) {
  if (f <= 1) return series
  const n = Math.ceil(series.n / f)
  const pick = (a) => Float32Array.from({ length: n }, (_, j) => a[j * f])
  return { n, dt: series.dt * f, v: pick(series.v), gLong: pick(series.gLong), gLat: pick(series.gLat), lean: pick(series.lean) }
}

/** Segundos parado al final de la serie (la caja negra sigue grabando un rato después de parar). */
export function trailingStop(series) {
  let k = 0
  for (let i = series.n - 1; i >= 0 && !(series.v[i] > 1); i--) k++
  return k * series.dt
}

// ---------- Uso de la banda ----------
// Qué parte del neumático pisa el suelo sale directo de la inclinación (se mide a ±4°). Un neumático de
// moto llega con el borde de la banda a unos 52-55°: con eso se calcula la tira que queda sin estrenar.
const EDGE = 54 // °

/**
 * leanAt(i), valid(i), v(i) para i en [i0, i1] (10 por segundo) → tiempo en cada zona, el máximo a cada
 * lado y los mm de banda sin usar en cada lado (estimación).
 */
export function treadUsage({ i0, i1, lean, valid, v, dt = 0.1 }, widthM = 0.13) {
  const bins = new Float64Array(24) // de −60° a 60°, de 5 en 5
  let maxL = 0
  let maxR = 0
  let tC = 0
  let tL = 0
  let tR = 0
  for (let i = i0; i <= i1; i++) {
    if (!valid(i) || !(v(i) > 3)) continue
    const l = lean(i)
    if (!Number.isFinite(l)) continue
    bins[clamp(Math.floor((l + 60) / 5), 0, 23)] += dt
    if (l < 0) maxL = Math.max(maxL, -l)
    else maxR = Math.max(maxR, l)
    const side = smooth(12, 32, Math.abs(l))
    tC += (1 - side) * dt
    if (l < 0) tL += side * dt
    else tR += side * dt
  }
  // Desde el centro, el punto de contacto se va hacia fuera con el seno de la inclinación
  const unused = (m) => Math.max(0, Math.round((widthM / 2) * 1000 * (1 - Math.sin((Math.min(m, EDGE) * Math.PI) / 180) / Math.sin((EDGE * Math.PI) / 180))))
  const tot = tC + tL + tR || 1
  return { bins, maxL, maxR, share: { L: tL / tot, C: tC / tot, R: tR / tot }, unusedL: unused(maxL), unusedR: unused(maxR), time: tot }
}
