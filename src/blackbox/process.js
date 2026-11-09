// Análisis de una sesión de la caja negra (formato en docs/telemetria.md): de los flujos en bruto a
// canales limpios a 10 Hz. Es offline, así que puede mirar hacia delante y hacia atrás (filtros sin
// retraso, curvas entre fixes de GPS), cosa que la app del móvil en marcha no puede.
//
// Qué hace:
// 1. GPS: quita fixes malos, congela el baile de la posición parado y traza la curva entre fixes con
//    un spline de Hermite que respeta el rumbo y la velocidad de cada fix (a 1 Hz la recta corta las curvas).
//    La velocidad es la del GPS (Doppler); donde el móvil no la dio, NO se saca de las posiciones (con
//    15-25 m de error eso daba saltos de 130 km/h parado): se rellena entre vecinos o se pone a 0.
// 2. Retraso del GPS: el del iPhone llega ~1 s tarde. Se mide comparando su aceleración con la del
//    acelerómetro y se descuenta, para que todo vaya en el mismo reloj.
// 3. Postura del móvil en el soporte: «arriba» es la gravedad media y «adelante» sale de comparar el
//    acelerómetro con lo que acelera el GPS. No hace falta saber cómo está puesto ni el convenio de
//    cada navegador (el iPhone da la gravedad y los ejes del giroscopio distintos que el estándar: se
//    prueban las dos asignaciones y se queda la que cuadra con los giros del GPS).
// 4. Inclinación: con la gravedad que calcula el propio móvil (acelerómetro + giroscopio) es directa;
//    si no la hay, asin(v·giro/g) fusionada con el giro de alabeo; y si tampoco, el rumbo del GPS.
// 5. G longitudinal del acelerómetro (calibrado con el GPS), velocidad GPS afinada con el acelerómetro.
// 6. Curvas, frenadas, pasadas del crono y estadísticas de cualquier tramo.

import { STREAMS } from '../core/blackbox.js'
import { screenRight } from '../core/mount.js'

export const G = 9.80665
export const DT = 0.1 // s entre muestras del análisis (10 Hz)
// Súbelo cada vez que el análisis cambie lo que sale (velocidades, tiempos, curvas): los tiempos de los
// tramos guardados en el navegador se rehacen con él
export const ANALYSIS_VERSION = 3
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
  const F = { n: m, t: new Float64Array(m), x: new Float64Array(m), y: new Float64Array(m), v: new Float64Array(m), hdg: new Float64Array(m), alt: new Float64Array(m), acc: new Float64Array(m), seg: new Int32Array(m), vOk: new Uint8Array(m) }
  if (!m) return F
  F.lat0 = g.lat[idx[0]]
  F.lon0 = g.lon[idx[0]]
  F.kx = Math.cos(F.lat0 * RAD) * R_EARTH * RAD
  F.ky = R_EARTH * RAD
  let seg = 0
  let doppler = 0
  for (let k = 0; k < m; k++) {
    const i = idx[k]
    if (k && g.t[i] - F.t[k - 1] > GAP) seg++
    F.t[k] = g.t[i]
    F.x[k] = (g.lon[i] - F.lon0) * F.kx
    F.y[k] = (g.lat[i] - F.lat0) * F.ky
    // La velocidad del GPS tal cual (speed); `v` es la que usó la app, que antes la inventaba con las
    // posiciones cuando faltaba
    const sp = Number.isFinite(g.speed[i]) && g.speed[i] >= 0 ? g.speed[i] : NaN
    F.v[k] = sp
    if (Number.isFinite(sp)) (doppler++, (F.vOk[k] = 1))
    F.hdg[k] = Number.isFinite(sp) && Number.isFinite(g.heading[i]) && g.heading[i] >= 0 ? g.heading[i] : Number.isFinite(g.hdg[i]) && Number.isFinite(sp) ? g.hdg[i] : NaN
    F.alt[k] = g.alt[i]
    F.acc[k] = Number.isFinite(g.acc[i]) ? g.acc[i] : 10
    F.seg[k] = seg
  }
  F.doppler = doppler / m
  if (F.doppler > 0.3) {
    // Huecos de velocidad: entre dos vecinos con velocidad (a menos de 3 s), en línea recta; si no, parado
    for (let k = 0; k < m; k++) {
      if (F.vOk[k]) continue
      let a = k - 1
      let b = k + 1
      while (a >= 0 && !F.vOk[a]) a--
      while (b < m && !F.vOk[b]) b++
      const okA = a >= 0 && F.seg[a] === F.seg[k] && F.t[k] - F.t[a] <= 3
      const okB = b < m && F.seg[b] === F.seg[k] && F.t[b] - F.t[k] <= 3
      F.v[k] = okA && okB ? F.v[a] + ((F.v[b] - F.v[a]) * (F.t[k] - F.t[a])) / (F.t[b] - F.t[a]) : 0
    }
  } else {
    // Un móvil que no da velocidad nunca: la de la cuerda entre fixes, sin saltos imposibles
    for (let k = 0; k < m; k++) {
      const a = Math.max(0, k - 1)
      const b = Math.min(m - 1, k + 1)
      const d = Math.hypot(F.x[b] - F.x[a], F.y[b] - F.y[a])
      const v = b > a ? d / (F.t[b] - F.t[a]) : 0
      F.v[k] = Number.isFinite(F.v[k]) ? F.v[k] : d < F.acc[k] ? 0 : Math.min(v, 90)
    }
  }
  // Parado: la posición baila unos metros; se queda quieta en la última buena
  let anchor = null
  for (let k = 0; k < m; k++) {
    if (k && F.seg[k] !== F.seg[k - 1]) anchor = null
    if (anchor && F.v[k] < 1 && Math.hypot(F.x[k] - anchor[0], F.y[k] - anchor[1]) < Math.max(6, F.acc[k])) [F.x[k], F.y[k]] = anchor
    else anchor = [F.x[k], F.y[k]]
  }
  return F
}

/**
 * Retraso del GPS respecto a los sensores (s): el desfase con el que la aceleración que marca su
 * velocidad cuadra mejor con el acelerómetro. En el iPhone sale ~1 s (la app ya lo descuenta en las
 * sesiones nuevas, y entonces sale ~0).
 */
function estimateLag(F, imu) {
  if (imu.n < 500 || F.n < 30) return { lag: 0, r2: 0 }
  const t0 = F.t[0]
  const n = Math.floor((F.t[F.n - 1] - t0) / DT) + 1
  const S = [new Float64Array(n), new Float64Array(n), new Float64Array(n)]
  const c = new Float64Array(n)
  for (let j = 0; j < imu.n; j++) {
    const b = Math.round((imu.t[j] - t0) / DT)
    if (b < 0 || b >= n || !Number.isFinite(imu.ax[j]) || !Number.isFinite(imu.ay[j]) || !Number.isFinite(imu.az[j])) continue
    S[0][b] += imu.ax[j]
    S[1][b] += imu.ay[j]
    S[2][b] += imu.az[j]
    c[b]++
  }
  for (const a of S) for (let b = 0; b < n; b++) a[b] = c[b] ? a[b] / c[b] : NaN
  const Q = S.map((a) => movAvg(a, 11))
  // Aceleración y velocidad del GPS entre fixes (con velocidad de verdad)
  const aG = new Float64Array(n).fill(NaN)
  const vG = new Float64Array(n).fill(NaN)
  for (let k = 1; k < F.n; k++) {
    const dt = F.t[k] - F.t[k - 1]
    if (!(dt > 0.3) || dt > 1.6 || !F.vOk[k] || !F.vOk[k - 1]) continue
    for (let b = Math.ceil((F.t[k - 1] - t0) / DT); b < (F.t[k] - t0) / DT && b < n; b++) {
      aG[b] = (F.v[k] - F.v[k - 1]) / dt
      vG[b] = F.v[k - 1]
    }
  }
  let best = { lag: 0, r2: -1 }
  let r0 = 0
  for (let L = -5; L <= 20; L++) {
    const M = Array.from({ length: 4 }, () => [0, 0, 0, 0])
    const r = [0, 0, 0, 0]
    let cnt = 0
    let sy = 0
    let syy = 0
    for (let i = 0; i < n; i++) {
      const j = i + L
      if (j < 0 || j >= n || !(vG[j] > 2) || !Number.isFinite(aG[j])) continue
      const x = [1, Q[0][i], Q[1][i], Q[2][i]]
      if (!x.every(Number.isFinite)) continue
      for (let a = 0; a < 4; a++) {
        r[a] += x[a] * aG[j]
        for (let b = 0; b < 4; b++) M[a][b] += x[a] * x[b]
      }
      sy += aG[j]
      syy += aG[j] * aG[j]
      cnt++
    }
    if (cnt < 200) continue
    const sol = solveN(M, r)
    if (!sol) continue
    let fit = 0
    for (let a = 0; a < 4; a++) fit += sol[a] * r[a]
    const sst = syy - (sy * sy) / cnt
    const r2 = sst > 0 ? (fit - (sy * sy) / cnt) / sst : 0
    if (L === 0) r0 = r2
    if (r2 > best.r2) best = { lag: L * DT, r2 }
  }
  // Solo si cuadra claramente mejor que sin desfase
  return best.r2 > 0.3 && best.r2 > r0 + 0.03 ? best : { lag: 0, r2: Math.max(0, r0) }
}

function solveN(M, r) {
  const n = r.length
  const A = M.map((row, i) => [...row, r[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let q = c + 1; q < n; q++) if (Math.abs(A[q][c]) > Math.abs(A[p][c])) p = q
    if (Math.abs(A[p][c]) < 1e-12) return null
    ;[A[c], A[p]] = [A[p], A[c]]
    for (let q = 0; q < n; q++) {
      if (q === c) continue
      const f = A[q][c] / A[c][c]
      for (let k = c; k <= n; k++) A[q][k] -= f * A[c][k]
    }
  }
  return A.map((row, i) => row[n] / row[i])
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
  // 0-2 aceleración con gravedad, 3-5 giroscopio tal cual (alpha, beta, gamma), 6-8 gravedad del sistema
  const S = Array.from({ length: 9 }, () => new Float64Array(n))
  const cnt = new Float64Array(n)
  const cntSys = new Float64Array(n)
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
    S[3][b] += Number.isFinite(imu.ra[j]) ? imu.ra[j] : 0
    S[4][b] += Number.isFinite(imu.rb[j]) ? imu.rb[j] : 0
    S[5][b] += Number.isFinite(imu.rg[j]) ? imu.rg[j] : 0
    if (Number.isFinite(imu.lx[j]) && Number.isFinite(imu.ly[j]) && Number.isFinite(imu.lz[j])) {
      S[6][b] += ax - imu.lx[j]
      S[7][b] += ay - imu.ly[j]
      S[8][b] += az - imu.lz[j]
      cntSys[b]++
    }
    const mag = Math.hypot(ax, ay, az)
    m1[b] += mag
    m2[b] += mag * mag
    cnt[b]++
  }
  const vib = new Float64Array(n)
  let sysBins = 0
  let bins = 0
  for (let b = 0; b < n; b++) {
    const c = cnt[b]
    for (let k = 0; k < 6; k++) S[k][b] = c ? S[k][b] / c : NaN
    for (let k = 6; k < 9; k++) S[k][b] = cntSys[b] ? S[k][b] / cntSys[b] : NaN
    if (c) bins++
    if (cntSys[b]) sysBins++
    vib[b] = c > 1 ? Math.sqrt(Math.max(0, m2[b] / c - (m1[b] / c) ** 2)) : NaN
  }
  // Huecos cortos (≤ 0,5 s): se rellenan en línea recta
  for (const a of [...S, vib]) fillShortGaps(a, 5)
  const [ax, ay, az, ra, rb, rg, gx, gy, gz] = S
  return { ax, ay, az, ra, rb, rg, gx, gy, gz, sys: bins ? sysBins / bins : 0, vib, count: cnt }
}

/** Giro en ejes del móvil (°/s) con una asignación de ejes: 'w3c' (el estándar) o 'xyz' (iPhone). */
function gyroOf(B, axes) {
  return axes === 'xyz' ? { wx: B.ra, wy: B.rb, wz: B.rg } : { wx: B.rb, wy: B.rg, wz: B.ra }
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

  // El GPS al mismo reloj que los sensores
  const hasImu = imu.n > 50
  const lagFit = hasImu ? estimateLag(F, imu) : { lag: 0, r2: 0 }
  if (lagFit.lag) for (let k = 0; k < F.n; k++) F.t[k] -= lagFit.lag

  const T0 = F.t[0]
  const n = Math.floor((F.t[F.n - 1] - T0) / DT) + 1
  const t = new Float64Array(n)
  for (let i = 0; i < n; i++) t[i] = T0 + i * DT
  const P = trajectory(F, t)
  const { valid } = P
  // GPS tan espaciado (más de 5 s) que no queda ninguna muestra buena: no hay nada que enseñar
  if (!valid.some((x) => x)) return { meta, n: 0, empty: true, events: session.ev || [] }

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
  const B = hasImu ? binImu(imu, T0, n) : null
  // Sin velocidad Doppler, la de las cuerdas cae en las curvas y torcía «adelante» ~30°: solo rectas
  const straightOnly = F.doppler < 0.5 ? (i) => Math.abs(yawGps[i]) < 3 : null
  const mount = B ? mountFrom(B, straightOnly ? Uint8Array.from(valid, (x, i) => (x && straightOnly(i) ? 1 : 0)) : valid, P.v, aGpsS) : null
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
    gpsLag: lagFit.lag,
    gpsLagR2: lagFit.r2,
    appLag: meta?.calib?.gpsLag ?? 0,
    doppler: F.doppler,
    sysGravity: B ? B.sys : 0,
    gyroAxes: null,
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
    // Las dos asignaciones de ejes del giroscopio: se queda la que cuadra con los giros del GPS
    let W = null
    let ys = { corr: -1, sign: 1 }
    for (const axes of ['w3c', 'xyz']) {
      const w = gyroOf(B, axes)
      const u = new Float64Array(n)
      for (let i = 0; i < n; i++) u[i] = dot([w.wx[i], w.wy[i], w.wz[i]], mount.up)
      const bU = bias(u)
      for (let i = 0; i < n; i++) u[i] -= bU
      const c = corrSign(u, yawGps, (i) => valid[i] && v[i] > 5)
      if (c.corr > ys.corr) (ys = c), (W = { ...w, up: u }), (info.gyroAxes = axes)
    }
    const wUp = W.up
    info.yawCorr = ys.corr
    if (ys.corr > 0.3) {
      yaw = new Float64Array(n)
      for (let i = 0; i < n; i++) yaw[i] = ys.sign * wUp[i]
      info.leanFrom = 'gyro'
      if (mount.fwd) {
        roll = new Float64Array(n)
        for (let i = 0; i < n; i++) roll[i] = dot([W.wx[i], W.wy[i], W.wz[i]], mount.fwd)
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
    // Con el rumbo del GPS, despacio el giro es ruido: solo a partir de ~15-30 km/h
    leanDyn[i] = Number.isFinite(phi) ? phi * (info.leanFrom === 'gyro' ? smoothstep(2, 6, v[i]) : smoothstep(4, 8, v[i])) : 0
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

  // Con la gravedad que calcula el propio móvil (acelerómetro + giroscopio fusionados por el sistema),
  // la inclinación es directa: el giro de la vertical del mundo alrededor del eje de avance. Vale a
  // cualquier velocidad. El sentido se comprueba con los giros del GPS.
  if (B && B.sys > 0.5 && mount) {
    let su = [0, 0, 0]
    let cu = 0
    for (let pass = 0; pass < 2 && !cu; pass++)
      for (let i = 0; i < n; i++) {
        if (!valid[i] || !(v[i] > 8) || !Number.isFinite(B.gx[i])) continue
        if (pass === 0 && !(Math.abs(yawGps[i]) < 3)) continue
        const g = norm([B.gx[i], B.gy[i], B.gz[i]])
        su = [su[0] + g[0], su[1] + g[1], su[2] + g[2]]
        cu++
      }
    if (cu > 50) {
      const U = norm(su)
      const ortho = (a) => {
        const d = dot(a, U)
        return norm([a[0] - d * U[0], a[1] - d * U[1], a[2] - d * U[2]])
      }
      const angle = { 'landscape-primary': 90, 'portrait-secondary': 180, 'landscape-secondary': 270 }[meta?.device?.orientation] ?? 0
      const R = mount.fwd ? norm(cross(ortho(mount.fwd), U)) : ortho(screenRight(angle))
      const lg = new Float64Array(n).fill(NaN)
      for (let i = 0; i < n; i++) if (Number.isFinite(B.gx[i])) lg[i] = Math.atan2(dot([B.gx[i], B.gy[i], B.gz[i]], R), dot([B.gx[i], B.gy[i], B.gz[i]], U))
      const rs = corrSign(lg, yawGps, (i) => valid[i] && v[i] > 6 && Math.abs(yawGps[i]) > 3)
      if (rs.corr > 0.3) {
        const sm = movAvg(lg, 3)
        lean = new Float64Array(n)
        for (let i = 0; i < n; i++) lean[i] = Number.isFinite(sm[i]) ? rs.sign * sm[i] : leanDyn[i]
        info.leanFrom = 'gravity'
        info.leanCorr = rs.corr
        info.mount.upSys = U
      }
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
    // G lateral de la curva (+ derecha): en una curva redonda, tan φ; parado no la hay
    A.gLat[i] = Math.tan(clamp(lean[i], -1.2, 1.2)) * smoothstep(3, 8, v[i])
    A.alt[i] = alt[i]
    A.hdg[i] = hdg[i]
    A.yaw[i] = yaw[i]
    A.vib[i] = B ? B.vib[i] : NaN
    A.acc[i] = acc[i]
  }

  // En las salidas de antes de que el móvil descontara el retraso del GPS, las pasadas y los duelos
  // se apuntaron con la hora del GPS (tarde): se adelantan lo mismo que el GPS
  const evShift = lagFit.lag && !(meta?.calib?.gpsLag > 0) ? lagFit.lag : 0
  const SHIFT = new Set(['run', 'launch', 'race', 'abort'])
  A.events = (session.ev || []).map((e) => {
    const t = SHIFT.has(e.type) ? e.t - evShift : e.t
    return { ...e, t, i: clamp(Math.round((t - T0) / DT), 0, n - 1) }
  })
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
  // Solo en marcha: con la inclinación de la gravedad, la moto en la pata de cabra (~10°) alargaba la
  // última curva toda la parada final
  const ok = (i, s) => valid[i] && v[i] > 2 && Math.sign(lean[i]) === s && Math.abs(lean[i]) >= edge
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
    while (a > 0 && valid[a - 1] && v[a - 1] > 2 && gLong[a - 1] <= edge) a--
    while (b < n - 1 && valid[b + 1] && v[b + 1] > 2 && gLong[b + 1] <= edge) b++
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
