// Análisis de una sesión de la caja negra (formato en docs/telemetria.md): de los flujos en bruto a
// canales limpios a 10 Hz. Es offline, así que puede mirar hacia delante y hacia atrás (filtros sin
// retraso, curvas entre fixes de GPS), cosa que la app del móvil en marcha no puede.
//
// Qué hace:
// 1. GPS: quita fixes malos, congela el baile de la posición parado y traza la curva entre fixes con
//    un spline de Hermite que respeta el rumbo y la velocidad de cada fix (a 1 Hz la recta corta las curvas).
// 2. Postura del móvil en el soporte: «arriba» es la gravedad aparente media (en una curva bien trazada
//    sigue el eje vertical de la moto) y «adelante» sale de comparar el acelerómetro con lo que acelera
//    el GPS. No hace falta saber cómo está puesto ni el signo que usa cada navegador.
// 3. Con eso: G longitudinal del acelerómetro (calibrado con el GPS), giro del giroscopio, inclinación
//    = asin(v·giro/g) fusionada con el giro de alabeo, velocidad GPS afinada con el acelerómetro.
// 4. Curvas, frenadas, pasadas del crono y estadísticas de cualquier tramo.

import { STREAMS } from '../core/blackbox.js'

export const G = 9.80665
export const DT = 0.1 // s entre muestras del análisis (10 Hz)
const GAP = 5 // s sin GPS que cortan la traza
const R_EARTH = 6371008.8
const RAD = Math.PI / 180

const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a) => {
  const m = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / m, a[1] / m, a[2] / m]
}

/** Filas planas → una columna por campo. */
export function unpack(flat, spec) {
  const f = spec.fields
  const w = f.length
  const n = flat ? Math.floor(flat.length / w) : 0
  const out = { n }
  for (let j = 0; j < w; j++) {
    const c = new Float64Array(n)
    for (let i = 0; i < n; i++) c[i] = flat[i * w + j]
    out[f[j]] = c
  }
  return out
}

/** Media móvil centrada de `win` muestras que ignora los NaN. */
export function movAvg(a, win) {
  const n = a.length
  const out = new Float64Array(n)
  const h = Math.floor(win / 2)
  let s = 0
  let c = 0
  for (let i = 0; i < Math.min(n, h); i++) if (Number.isFinite(a[i])) (s += a[i], c++)
  for (let i = 0; i < n; i++) {
    const add = i + h
    const del = i - h - 1
    if (add < n && Number.isFinite(a[add])) (s += a[add], c++)
    if (del >= 0 && Number.isFinite(a[del])) (s -= a[del], c--)
    out[i] = c > 0 && Number.isFinite(a[i]) ? s / c : NaN
  }
  return out
}

// ---------- 1. GPS ----------

function cleanFixes(g) {
  const idx = []
  let lastT = -Infinity
  for (let i = 0; i < g.n; i++) {
    if (!Number.isFinite(g.lat[i]) || !Number.isFinite(g.lon[i]) || !Number.isFinite(g.t[i])) continue
    if (Number.isFinite(g.acc[i]) && g.acc[i] > 60) continue
    if (g.t[i] <= lastT + 0.05) continue
    idx.push(i)
    lastT = g.t[i]
  }
  const m = idx.length
  const F = { n: m, t: new Float64Array(m), x: new Float64Array(m), y: new Float64Array(m), v: new Float64Array(m), hdg: new Float64Array(m), alt: new Float64Array(m), acc: new Float64Array(m), seg: new Int32Array(m) }
  if (!m) return F
  F.lat0 = g.lat[idx[0]]
  F.lon0 = g.lon[idx[0]]
  F.kx = Math.cos(F.lat0 * RAD) * R_EARTH * RAD
  F.ky = R_EARTH * RAD
  let anchor = null
  let seg = 0
  for (let k = 0; k < m; k++) {
    const i = idx[k]
    let px = (g.lon[i] - F.lon0) * F.kx
    let py = (g.lat[i] - F.lat0) * F.ky
    const v = Number.isFinite(g.v[i]) && g.v[i] >= 0 ? g.v[i] : Number.isFinite(g.speed[i]) && g.speed[i] >= 0 ? g.speed[i] : NaN
    const acc = Number.isFinite(g.acc[i]) ? g.acc[i] : 10
    if (k && g.t[i] - F.t[k - 1] > GAP) (seg++, (anchor = null))
    // Parado: la posición baila unos metros; se queda quieta en la última buena
    if (anchor && v < 1 && Math.hypot(px - anchor[0], py - anchor[1]) < Math.max(6, acc)) [px, py] = anchor
    else anchor = [px, py]
    F.t[k] = g.t[i]
    F.x[k] = px
    F.y[k] = py
    F.v[k] = v
    F.hdg[k] = Number.isFinite(g.hdg[i]) ? g.hdg[i] : g.heading[i]
    F.alt[k] = g.alt[i]
    F.acc[k] = acc
    F.seg[k] = seg
  }
  // Sin velocidad del móvil: la de la cuerda entre fixes
  for (let k = 0; k < m; k++) {
    if (Number.isFinite(F.v[k])) continue
    const a = Math.max(0, k - 1)
    const b = Math.min(m - 1, k + 1)
    F.v[k] = b > a ? Math.hypot(F.x[b] - F.x[a], F.y[b] - F.y[a]) / (F.t[b] - F.t[a]) : 0
  }
  return F
}

/** Posición y velocidad en cada instante de `t` entre fixes (spline de Hermite). */
function trajectory(F, t) {
  const n = t.length
  const T = { x: new Float64Array(n), y: new Float64Array(n), v: new Float64Array(n).fill(NaN), valid: new Uint8Array(n), seg: new Int32Array(n).fill(-1), k: new Int32Array(n).fill(-1) }
  // Dirección en cada fix: el rumbo del GPS si va en marcha; si no, la de sus vecinos
  const tx = new Float64Array(F.n)
  const ty = new Float64Array(F.n)
  for (let k = 0; k < F.n; k++) {
    if (Number.isFinite(F.hdg[k]) && F.v[k] >= 2) {
      tx[k] = Math.sin(F.hdg[k] * RAD)
      ty[k] = Math.cos(F.hdg[k] * RAD)
      continue
    }
    const a = k > 0 && F.seg[k - 1] === F.seg[k] ? k - 1 : k
    const b = k < F.n - 1 && F.seg[k + 1] === F.seg[k] ? k + 1 : k
    const dx = F.x[b] - F.x[a]
    const dy = F.y[b] - F.y[a]
    const m = Math.hypot(dx, dy)
    if (m > 0.3) (tx[k] = dx / m), (ty[k] = dy / m)
  }
  let k = 0
  for (let i = 0; i < n; i++) {
    while (k < F.n - 2 && F.t[k + 1] <= t[i]) k++
    const ta = F.t[k]
    const tb = F.t[k + 1]
    const dt = tb - ta
    if (!(dt > 0) || dt > GAP || t[i] < ta || t[i] > tb) continue
    const tau = t[i] - ta
    const vA = F.v[k]
    const vB = F.v[k + 1]
    T.v[i] = vA + ((vB - vA) * tau) / dt
    // Avance a lo largo del tramo según la velocidad (con aceleración constante), no según el tiempo
    const sTot = ((vA + vB) / 2) * dt
    const s = sTot > 0.1 ? clamp((vA * tau + ((vB - vA) * tau * tau) / (2 * dt)) / sTot, 0, 1) : tau / dt
    const ax = F.x[k]
    const ay = F.y[k]
    const cx = F.x[k + 1] - ax
    const cy = F.y[k + 1] - ay
    const c = Math.hypot(cx, cy)
    if (c < 0.5) {
      T.x[i] = ax + cx * s
      T.y[i] = ay + cy * s
    } else {
      // Tangentes con la longitud de la cuerda; si el rumbo contradice la cuerda, la cuerda
      let mAx = tx[k] * c
      let mAy = ty[k] * c
      let mBx = tx[k + 1] * c
      let mBy = ty[k + 1] * c
      if (mAx * cx + mAy * cy <= 0.2 * c * c) (mAx = cx), (mAy = cy)
      if (mBx * cx + mBy * cy <= 0.2 * c * c) (mBx = cx), (mBy = cy)
      const s2 = s * s
      const s3 = s2 * s
      const h00 = 2 * s3 - 3 * s2 + 1
      const h10 = s3 - 2 * s2 + s
      const h01 = -2 * s3 + 3 * s2
      const h11 = s3 - s2
      T.x[i] = h00 * ax + h10 * mAx + h01 * F.x[k + 1] + h11 * mBx
      T.y[i] = h00 * ay + h10 * mAy + h01 * F.y[k + 1] + h11 * mBy
    }
    T.valid[i] = 1
    T.seg[i] = F.seg[k]
    T.k[i] = k
  }
  return T
}

// ---------- 2. Sensores ----------

/** Medias de cada 0,1 s del acelerómetro y el giroscopio, y la vibración (desviación de |a|). */
function binImu(imu, t0, n) {
  const S = Array.from({ length: 6 }, () => new Float64Array(n))
  const cnt = new Float64Array(n)
  const m1 = new Float64Array(n)
  const m2 = new Float64Array(n)
  for (let j = 0; j < imu.n; j++) {
    const b = Math.round((imu.t[j] - t0) / DT)
    if (b < 0 || b >= n) continue
    const ax = imu.ax[j]
    const ay = imu.ay[j]
    const az = imu.az[j]
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az)) continue
    S[0][b] += ax
    S[1][b] += ay
    S[2][b] += az
    // Giro en ejes del móvil: beta sobre x, gamma sobre y, alpha sobre z (°/s)
    S[3][b] += Number.isFinite(imu.rb[j]) ? imu.rb[j] : 0
    S[4][b] += Number.isFinite(imu.rg[j]) ? imu.rg[j] : 0
    S[5][b] += Number.isFinite(imu.ra[j]) ? imu.ra[j] : 0
    const mag = Math.hypot(ax, ay, az)
    m1[b] += mag
    m2[b] += mag * mag
    cnt[b]++
  }
  const vib = new Float64Array(n)
  for (let b = 0; b < n; b++) {
    const c = cnt[b]
    for (const a of S) a[b] = c ? a[b] / c : NaN
    vib[b] = c > 1 ? Math.sqrt(Math.max(0, m2[b] / c - (m1[b] / c) ** 2)) : NaN
  }
  // Huecos cortos (≤ 0,5 s): se rellenan en línea recta
  for (const a of [...S, vib]) fillShortGaps(a, 5)
  return { ax: S[0], ay: S[1], az: S[2], wx: S[3], wy: S[4], wz: S[5], vib, count: cnt }
}

function fillShortGaps(a, maxLen) {
  const n = a.length
  let i = 0
  while (i < n) {
    if (Number.isFinite(a[i])) {
      i++
      continue
    }
    let j = i
    while (j < n && !Number.isFinite(a[j])) j++
    if (i > 0 && j < n && j - i <= maxLen) for (let q = i; q < j; q++) a[q] = a[i - 1] + ((a[j] - a[i - 1]) * (q - i + 1)) / (j - i + 1)
    i = j
  }
}

/**
 * Postura del móvil: «arriba» (gravedad aparente media) y «adelante» (la dirección del plano
 * perpendicular cuyo acelerómetro mejor explica lo que acelera el GPS). Regresión con término
 * independiente para absorber que «arriba» no sea perfecto.
 */
function mountFrom(B, valid, v, aGps) {
  const n = v.length
  let s = [0, 0, 0]
  let c = 0
  for (let i = 0; i < n; i++) {
    const a = [B.ax[i], B.ay[i], B.az[i]]
    const m = Math.hypot(...a)
    if (!(m > 6 && m < 14)) continue
    s = [s[0] + a[0] / m, s[1] + a[1] / m, s[2] + a[2] / m]
    c++
  }
  if (c < 50) return null
  const up = norm(s)
  const pick = Math.abs(up[0]) < 0.6 ? [1, 0, 0] : [0, 1, 0]
  const e1 = norm(cross(up, pick))
  const e2 = cross(up, e1)
  const p1 = new Float64Array(n)
  const p2 = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = [B.ax[i], B.ay[i], B.az[i]]
    p1[i] = dot(a, e1)
    p2[i] = dot(a, e2)
  }
  // El GPS ve la aceleración suavizada ~1 s: se compara con el acelerómetro suavizado igual
  const q1 = movAvg(p1, 11)
  const q2 = movAvg(p2, 11)
  // Mínimos cuadrados a = c0 + c1·q1 + c2·q2
  const M = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  const r = [0, 0, 0]
  let used = 0
  let sa = 0
  let sa2 = 0
  for (let i = 0; i < n; i++) {
    if (!valid[i] || !(v[i] > 2) || !Number.isFinite(q1[i]) || !Number.isFinite(q2[i]) || !Number.isFinite(aGps[i])) continue
    const x = [1, q1[i], q2[i]]
    for (let a = 0; a < 3; a++) {
      r[a] += x[a] * aGps[i]
      for (let b = 0; b < 3; b++) M[a][b] += x[a] * x[b]
    }
    sa += aGps[i]
    sa2 += aGps[i] ** 2
    used++
  }
  const varA = used ? sa2 / used - (sa / used) ** 2 : 0
  if (used < 100 || varA < 0.05) return { up, fwd: null, r2: 0, used }
  const sol = solve3(M, r)
  if (!sol) return { up, fwd: null, r2: 0, used }
  const [c0, c1, c2] = sol
  let ssr = 0
  for (let i = 0; i < n; i++) {
    if (!valid[i] || !(v[i] > 2) || !Number.isFinite(q1[i]) || !Number.isFinite(q2[i]) || !Number.isFinite(aGps[i])) continue
    ssr += (aGps[i] - (c0 + c1 * q1[i] + c2 * q2[i])) ** 2
  }
  const r2 = 1 - ssr / (varA * used)
  const k = Math.hypot(c1, c2)
  const fwd = norm([c1 * e1[0] + c2 * e2[0], c1 * e1[1] + c2 * e2[1], c1 * e1[2] + c2 * e2[2]])
  return { up, fwd, right: cross(fwd, up), k, c0, r2, used, aImu: (i) => c0 + c1 * p1[i] + c2 * p2[i] }
}

function solve3(M, r) {
  const A = M.map((row, i) => [...row, r[i]])
  for (let c = 0; c < 3; c++) {
    let p = c
    for (let q = c + 1; q < 3; q++) if (Math.abs(A[q][c]) > Math.abs(A[p][c])) p = q
    if (Math.abs(A[p][c]) < 1e-12) return null
    ;[A[c], A[p]] = [A[p], A[c]]
    for (let q = 0; q < 3; q++) {
      if (q === c) continue
      const f = A[q][c] / A[c][c]
      for (let k = c; k < 4; k++) A[q][k] -= f * A[c][k]
    }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]]
}

/** Correlación sin centrar (lo que importa es el signo y si se parecen). */
function corrSign(a, b, use) {
  let ab = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < a.length; i++) {
    if (!use(i) || !Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue
    ab += a[i] * b[i]
    aa += a[i] * a[i]
    bb += b[i] * b[i]
  }
  const c = aa && bb ? ab / Math.sqrt(aa * bb) : 0
  return { sign: c >= 0 ? 1 : -1, corr: Math.abs(c) }
}

function interp(tq, ts, vs) {
  const n = tq.length
  const out = new Float64Array(n).fill(NaN)
  if (!ts.length) return out
  let k = 0
  for (let i = 0; i < n; i++) {
    const t = tq[i]
    if (t < ts[0] || t > ts[ts.length - 1]) continue
    while (k < ts.length - 2 && ts[k + 1] < t) k++
    const a = ts[k]
    const b = ts[k + 1] ?? a
    out[i] = b > a ? vs[k] + ((vs[k + 1] - vs[k]) * (t - a)) / (b - a) : vs[k]
  }
  return out
}

// ---------- 3. Sesión completa ----------

/**
 * @param {{meta: object, gps: Float64Array, imu: Float32Array, calc: Float32Array, ev: object[]}} session
 */
export function analyze(session) {
  const gps = unpack(session.gps, STREAMS.gps)
  const imu = unpack(session.imu, STREAMS.imu)
  const calc = unpack(session.calc, STREAMS.calc)
  const F = cleanFixes(gps)
  const meta = session.meta
  if (F.n < 2) return { meta, n: 0, empty: true, events: session.ev || [] }

  const T0 = F.t[0]
  const n = Math.floor((F.t[F.n - 1] - T0) / DT) + 1
  const t = new Float64Array(n)
  for (let i = 0; i < n; i++) t[i] = T0 + i * DT
  const P = trajectory(F, t)
  const { valid } = P

  // Rumbo y su ritmo de cambio desde la trayectoria (°/s, + derecha)
  const hdg = new Float64Array(n).fill(NaN)
  let last = NaN
  for (let i = 0; i < n; i++) {
    if (!valid[i]) {
      last = NaN
      continue
    }
    const a = i > 0 && valid[i - 1] && P.seg[i - 1] === P.seg[i] ? i - 1 : i
    const b = i < n - 1 && valid[i + 1] && P.seg[i + 1] === P.seg[i] ? i + 1 : i
    const dx = P.x[b] - P.x[a]
    const dy = P.y[b] - P.y[a]
    if (Math.hypot(dx, dy) > 0.05) last = Math.atan2(dx, dy) / RAD
    hdg[i] = last
  }
  // El rumbo que da el GPS (Doppler) es mucho más fino que el que sale de las posiciones: entre dos
  // fixes con rumbo, su diferencia; si no, el de la trayectoria
  const wrap = (d) => ((d + 540) % 360) - 180
  const hRate = new Float64Array(n).fill(NaN)
  for (let i = 1; i < n - 1; i++) {
    if (!valid[i]) continue
    const k = P.k[i]
    if (P.v[i] <= 3) {
      hRate[i] = 0
      continue
    }
    if (Number.isFinite(F.hdg[k]) && Number.isFinite(F.hdg[k + 1]) && F.v[k] >= 2 && F.v[k + 1] >= 2) hRate[i] = wrap(F.hdg[k + 1] - F.hdg[k]) / (F.t[k + 1] - F.t[k])
    else if (valid[i - 1] && valid[i + 1] && Number.isFinite(hdg[i - 1]) && Number.isFinite(hdg[i + 1])) hRate[i] = wrap(hdg[i + 1] - hdg[i - 1]) / (2 * DT)
  }
  const yawGps = movAvg(hRate, 11)

  // Aceleración que ve el GPS (de su velocidad)
  const vS = movAvg(P.v, 5)
  const aGps = new Float64Array(n).fill(NaN)
  for (let i = 1; i < n - 1; i++) if (valid[i - 1] && valid[i + 1]) aGps[i] = (vS[i + 1] - vS[i - 1]) / (2 * DT)
  const aGpsS = movAvg(aGps, 5)

  // Sensores
  const hasImu = imu.n > 50
  const B = hasImu ? binImu(imu, T0, n) : null
  const mount = B ? mountFrom(B, valid, P.v, aGpsS) : null
  const info = {
    hasImu,
    imuHz: hasImu ? imu.n / Math.max(1, imu.t[imu.n - 1] - imu.t[0]) : 0,
    gpsHz: (F.n - 1) / Math.max(1, F.t[F.n - 1] - F.t[0]),
    fixes: F.n,
    accMean: F.acc.reduce((s, a) => s + a, 0) / F.n,
    mount: mount && { up: mount.up, fwd: mount.fwd, r2: mount.r2, k: mount.k, used: mount.used },
    longFrom: 'gps',
    leanFrom: 'gps',
    yawCorr: 0,
  }

  // G longitudinal: acelerómetro calibrado si se fía de la postura; si no, la del GPS
  let aLong = aGpsS
  if (mount?.fwd && mount.r2 > 0.3) {
    const raw = new Float64Array(n)
    for (let i = 0; i < n; i++) raw[i] = mount.aImu(i)
    aLong = movAvg(raw, 3)
    // Donde faltan sensores (app en segundo plano), la del GPS
    for (let i = 0; i < n; i++) if (!Number.isFinite(aLong[i])) aLong[i] = aGpsS[i]
    info.longFrom = 'imu'
  }

  // Velocidad: la del GPS, con la forma que marca el acelerómetro entre fix y fix
  const v = Float64Array.from(P.v)
  if (info.longFrom === 'imu') fuseSpeed(v, P, F, t, aLong)

  // Giro (°/s, + derecha) e inclinación
  let yaw = yawGps
  let roll = null
  if (mount) {
    const bias = (w) => {
      let s = 0
      let c = 0
      for (let i = 0; i < n; i++) if (valid[i] && P.v[i] < 0.5 && Number.isFinite(w[i])) (s += w[i]), c++
      return c > 20 ? s / c : 0
    }
    const wUp = new Float64Array(n)
    for (let i = 0; i < n; i++) wUp[i] = dot([B.wx[i], B.wy[i], B.wz[i]], mount.up)
    const bU = bias(wUp)
    for (let i = 0; i < n; i++) wUp[i] -= bU
    const ys = corrSign(wUp, yawGps, (i) => valid[i] && v[i] > 5)
    info.yawCorr = ys.corr
    if (ys.corr > 0.3) {
      yaw = new Float64Array(n)
      for (let i = 0; i < n; i++) yaw[i] = ys.sign * wUp[i]
      info.leanFrom = 'gyro'
      if (mount.fwd) {
        roll = new Float64Array(n)
        for (let i = 0; i < n; i++) roll[i] = dot([B.wx[i], B.wy[i], B.wz[i]], mount.fwd)
        const bR = bias(roll)
        for (let i = 0; i < n; i++) roll[i] -= bR
      }
    }
  }

  // Inclinación dinámica: sen φ = v·giro/g con el giro medido sobre el eje de la moto (giroscopio);
  // tan φ = v·giro/g con el giro del rumbo (GPS)
  const leanDyn = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const w = Number.isFinite(yaw[i]) ? yaw[i] * RAD : 0
    const lat = (v[i] * w) / G
    const phi = info.leanFrom === 'gyro' ? Math.asin(clamp(lat, -0.97, 0.97)) : Math.atan(lat)
    leanDyn[i] = Number.isFinite(phi) ? phi * smoothstep(2, 6, v[i]) : 0
  }
  let lean = leanDyn
  if (roll) {
    // El alabeo del giroscopio da las transiciones; la física del giro, el nivel. Ida y vuelta: sin retraso
    const dLean = new Float64Array(n)
    for (let i = 1; i < n - 1; i++) dLean[i] = (leanDyn[i + 1] - leanDyn[i - 1]) / (2 * DT)
    const rs = corrSign(roll, dLean, (i) => valid[i] && v[i] > 5)
    if (rs.corr > 0.3) {
      const p = roll.map((r) => (Number.isFinite(r) ? rs.sign * r * RAD : 0))
      lean = complementary(leanDyn, p, valid, 0.6)
      info.leanFrom = 'gyro+roll'
      info.rollCorr = rs.corr
    }
  }

  // Altitud suavizada, precisión del GPS y lo que calculaba el móvil
  const alt = movAvg(interp(t, F.t, F.alt), 31)
  const acc = interp(t, F.t, F.acc)
  const appV = interp(t, calc.t, calc.v)
  const appGLong = interp(t, calc.t, calc.gLong)
  const appGLat = interp(t, calc.t, calc.gLat)
  const appLean = interp(t, calc.t, calc.lean)

  // Canales finales
  const f32 = () => new Float32Array(n).fill(NaN)
  const A = {
    meta,
    info,
    n,
    T0,
    t: new Float64Array(n),
    valid,
    seg: P.seg,
    lat: new Float64Array(n).fill(NaN),
    lon: new Float64Array(n).fill(NaN),
    d: new Float64Array(n),
    v: f32(),
    lean: f32(),
    gLong: f32(),
    gLat: f32(),
    alt: f32(),
    hdg: f32(),
    yaw: f32(),
    vib: f32(),
    acc: f32(),
    appV,
    appGLong,
    appGLat,
    appLean,
  }
  let dist = 0
  for (let i = 0; i < n; i++) {
    A.t[i] = t[i]
    if (i && valid[i] && valid[i - 1] && P.seg[i] === P.seg[i - 1]) dist += ((v[i] + v[i - 1]) / 2) * DT
    A.d[i] = dist
    if (!valid[i]) continue
    A.lat[i] = F.lat0 + P.y[i] / F.ky
    A.lon[i] = F.lon0 + P.x[i] / F.kx
    A.v[i] = v[i]
    A.lean[i] = lean[i] / RAD
    A.gLong[i] = aLong[i] / G
    A.gLat[i] = Math.tan(clamp(leanDyn[i], -1.4, 1.4)) // + derecha
    A.alt[i] = alt[i]
    A.hdg[i] = hdg[i]
    A.yaw[i] = yaw[i]
    A.vib[i] = B ? B.vib[i] : NaN
    A.acc[i] = acc[i]
  }

  A.events = (session.ev || []).map((e) => ({ ...e, i: clamp(Math.round((e.t - T0) / DT), 0, n - 1) }))
  A.corners = findCorners(A)
  A.brakes = findBrakes(A)
  A.runs = A.events.filter((e) => e.type === 'run')
  A.stats = rangeStats(A, 0, n - 1)
  return A
}

/** Velocidad del GPS (exacta en cada fix) con la forma del acelerómetro entre medias. */
function fuseSpeed(v, P, F, t, aLong) {
  const n = v.length
  let i = 0
  while (i < n) {
    const k = P.k[i]
    if (k < 0) {
      i++
      continue
    }
    let j = i
    while (j + 1 < n && P.k[j + 1] === k) j++
    const ta = F.t[k]
    const tb = F.t[k + 1]
    const dt = tb - ta
    // Integral de la aceleración desde el fix A hasta cada muestra y hasta el fix B
    const I = new Float64Array(j - i + 1)
    let acc = (Number.isFinite(aLong[i]) ? aLong[i] : 0) * (t[i] - ta)
    for (let q = i; q <= j; q++) {
      if (q > i) acc += ((aLong[q] + aLong[q - 1]) / 2 || 0) * DT
      I[q - i] = acc
    }
    const IB = acc + (Number.isFinite(aLong[j]) ? aLong[j] : 0) * (tb - t[j])
    const vA = F.v[k]
    const vB = F.v[k + 1]
    for (let q = i; q <= j; q++) {
      const tau = t[q] - ta
      v[q] = Math.max(0, vA + I[q - i] + (tau / dt) * (vB - vA - IB))
    }
    i = j + 1
  }
}

/** Filtro complementario hacia delante y hacia atrás (sin retraso). */
function complementary(target, rate, valid, tau) {
  const n = target.length
  const k = DT / (tau + DT)
  const f = new Float64Array(n)
  const b = new Float64Array(n)
  for (let i = 0; i < n; i++) f[i] = i && valid[i] && valid[i - 1] ? (1 - k) * (f[i - 1] + rate[i] * DT) + k * target[i] : target[i]
  for (let i = n - 1; i >= 0; i--) b[i] = i < n - 1 && valid[i] && valid[i + 1] ? (1 - k) * (b[i + 1] - rate[i] * DT) + k * target[i] : target[i]
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = (f[i] + b[i]) / 2
  return out
}

// ---------- 4. Curvas, frenadas y estadísticas ----------

/** Curvas: tramos con la moto tumbada al mismo lado (pico ≥ 12°, al menos 1 s por encima de 4°). */
export function findCorners(A, { peak = 12, edge = 4, minDur = 1 } = {}) {
  const out = []
  const { n, valid, lean, v } = A
  const ok = (i, s) => valid[i] && Math.sign(lean[i]) === s && Math.abs(lean[i]) >= edge
  let i = 0
  while (i < n) {
    if (!(valid[i] && v[i] > 5 && Math.abs(lean[i]) >= peak)) {
      i++
      continue
    }
    const s = Math.sign(lean[i])
    let a = i
    let b = i
    while (a > 0 && ok(a - 1, s)) a--
    while (b < n - 1 && ok(b + 1, s)) b++
    if ((b - a) * DT >= minDur) {
      let apex = a
      let vMin = Infinity
      let iMin = a
      let gMax = 0
      for (let q = a; q <= b; q++) {
        if (Math.abs(lean[q]) > Math.abs(lean[apex])) apex = q
        if (v[q] < vMin) (vMin = v[q]), (iMin = q)
        gMax = Math.max(gMax, Math.abs(A.gLat[q]))
      }
      out.push({ i0: a, i1: b, apex, iMin, dir: s > 0 ? 'R' : 'L', lean: Math.abs(lean[apex]), vIn: v[a], vMin, vOut: v[b], gLat: gMax, dur: (b - a) * DT, len: A.d[b] - A.d[a] })
    }
    i = b + 1
  }
  out.forEach((c, k) => (c.n = k + 1))
  return out
}

/** Frenadas: al menos 0,6 s por debajo de -0,25 g (se alargan hasta -0,08 g). */
export function findBrakes(A, { peak = -0.25, edge = -0.08, minDur = 0.6 } = {}) {
  const out = []
  const { n, valid, gLong, v } = A
  let i = 0
  while (i < n) {
    if (!(valid[i] && gLong[i] <= peak && v[i] > 3)) {
      i++
      continue
    }
    let a = i
    let b = i
    while (a > 0 && valid[a - 1] && gLong[a - 1] <= edge) a--
    while (b < n - 1 && valid[b + 1] && gLong[b + 1] <= edge) b++
    if ((b - a) * DT >= minDur) {
      let gMin = 0
      let iMax = a
      for (let q = a; q <= b; q++) if (gLong[q] < gMin) (gMin = gLong[q]), (iMax = q)
      out.push({ i0: a, i1: b, iMax, g: -gMin, vIn: v[a], vOut: v[b], dur: (b - a) * DT, len: A.d[b] - A.d[a] })
    }
    i = b + 1
  }
  out.forEach((c, k) => (c.n = k + 1))
  return out
}

/** Estadísticas de un tramo [i0, i1]. */
export function rangeStats(A, i0, i1) {
  const S = { i0, i1, dist: A.d[i1] - A.d[i0], dur: A.t[i1] - A.t[i0], moving: 0, vMax: 0, iVMax: i0, leanL: 0, iLeanL: -1, leanR: 0, iLeanR: -1, brake: 0, iBrake: -1, accel: 0, iAccel: -1, gLat: 0, gTot: 0, altMin: Infinity, altMax: -Infinity, climb: 0, descent: 0, vib: 0, leaned30: 0, fixes: 0, accSum: 0 }
  let vibN = 0
  let ref = NaN
  for (let i = i0; i <= i1; i++) {
    if (!A.valid[i]) continue
    const v = A.v[i]
    if (v > 1) S.moving += DT
    if (v > S.vMax) (S.vMax = v), (S.iVMax = i)
    if (v > 3) {
      const l = A.lean[i]
      if (-l > S.leanL) (S.leanL = -l), (S.iLeanL = i)
      if (l > S.leanR) (S.leanR = l), (S.iLeanR = i)
      if (Math.abs(l) >= 30) S.leaned30 += DT
      const gl = A.gLong[i]
      if (-gl > S.brake) (S.brake = -gl), (S.iBrake = i)
      if (gl > S.accel) (S.accel = gl), (S.iAccel = i)
      S.gLat = Math.max(S.gLat, Math.abs(A.gLat[i]))
      S.gTot = Math.max(S.gTot, Math.hypot(A.gLat[i], gl))
    }
    const alt = A.alt[i]
    if (Number.isFinite(alt)) {
      S.altMin = Math.min(S.altMin, alt)
      S.altMax = Math.max(S.altMax, alt)
      // Subida y bajada con histéresis de 2 m para no sumar el ruido
      if (!Number.isFinite(ref)) ref = alt
      else if (alt - ref > 2) (S.climb += alt - ref), (ref = alt)
      else if (ref - alt > 2) (S.descent += ref - alt), (ref = alt)
    }
    if (Number.isFinite(A.vib[i])) (S.vib += A.vib[i]), vibN++
    if (Number.isFinite(A.acc[i])) (S.accSum += A.acc[i]), S.fixes++
  }
  S.vAvg = S.moving > 0 ? S.dist / S.moving : 0
  S.vib = vibN ? S.vib / vibN : NaN
  S.accMean = S.fixes ? S.accSum / S.fixes : NaN
  if (!Number.isFinite(S.altMin)) S.altMin = S.altMax = NaN
  return S
}

/** Muestra más cercana a un instante (segundos de la sesión). */
export const indexAt = (A, t) => clamp(Math.round((t - A.T0) / DT), 0, A.n - 1)
