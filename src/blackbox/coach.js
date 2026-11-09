// Dónde ganas y pierdes: con dos pasadas alineadas (align.compare), cuánto tiempo se va en cada curva de
// la referencia (desde la frenada de antes hasta la salida) y por qué: frenar antes, pasar más despacio,
// tumbar menos o salir con menos velocidad. Lo que pasa entre curvas cuenta como recta (la aceleración).

const APPROACH = 70 // m antes de la curva que cuentan como su frenada

/** Primer k (en la rejilla de la comparación) con iA[k] ≥ i. */
function kOf(iA, i) {
  let lo = 0
  let hi = iA.length - 1
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (iA[m] < i) lo = m + 1
    else hi = m
  }
  return lo
}

/** Metros desde el inicio de la comparación donde empieza la frenada de esa zona (G < −0,2), o null. */
function brakePoint(C, X, idx, k0, k1) {
  for (let k = k0; k <= k1; k++) {
    const i = idx[k]
    if (X.valid[i] && X.gLong[i] < -0.2) return C.s[k]
  }
  return null
}

/**
 * Zonas (curvas de A y las rectas entre ellas) con el tiempo que la comparada (B) gana o pierde en cada
 * una (+ = B pierde) y lo que lo explica. Ordenadas de más a menos tiempo.
 */
export function whereTime(C, A, B) {
  const zones = []
  const corners = A.corners.filter((c) => c.i1 >= C.iA[0] && c.i0 <= C.iA[C.n - 1]).sort((a, b) => a.i0 - b.i0)
  const pre = Math.round(APPROACH / C.step)
  let lastOut = 0
  for (const c of corners) {
    const kIn = kOf(C.iA, c.i0)
    const kOut = Math.max(kIn, kOf(C.iA, c.i1))
    const kPre = Math.max(lastOut, kIn - pre)
    // La recta de antes (desde la salida de la curva anterior hasta la frenada de esta)
    if (kPre - lastOut > 5) zones.push(straight(C, A, B, lastOut, kPre))
    let vA = Infinity
    let vB = Infinity
    let lA = 0
    let lB = 0
    for (let k = kIn; k <= kOut; k++) {
      const a = C.iA[k]
      const b = C.iB[k]
      if (A.valid[a]) (vA = Math.min(vA, A.v[a])), (lA = Math.max(lA, Math.abs(A.lean[a])))
      if (B.valid[b]) (vB = Math.min(vB, B.v[b])), (lB = Math.max(lB, Math.abs(B.lean[b])))
    }
    const bA = brakePoint(C, A, C.iA, kPre, kIn)
    const bB = brakePoint(C, B, C.iB, kPre, kIn)
    const exitA = A.v[C.iA[kOut]]
    const exitB = B.v[C.iB[kOut]]
    zones.push({
      kind: 'corner',
      n: c.n,
      dir: c.dir,
      k0: kPre,
      k1: kOut,
      at: C.iA[Math.round((kIn + kOut) / 2)],
      dt: C.delta[kOut] - C.delta[kPre],
      vMinA: vA,
      vMinB: vB,
      leanA: lA,
      leanB: lB,
      exitA,
      exitB,
      // + = B frena antes (más lejos de la curva)
      brake: bA != null && bB != null ? bA - bB : null,
    })
    lastOut = kOut
  }
  if (C.n - 1 - lastOut > 5) zones.push(straight(C, A, B, lastOut, C.n - 1))
  return zones.sort((a, b) => Math.abs(b.dt) - Math.abs(a.dt))
}

function straight(C, A, B, k0, k1) {
  let maxA = 0
  let maxB = 0
  for (let k = k0; k <= k1; k++) {
    if (A.valid[C.iA[k]]) maxA = Math.max(maxA, A.v[C.iA[k]])
    if (B.valid[C.iB[k]]) maxB = Math.max(maxB, B.v[C.iB[k]])
  }
  return { kind: 'straight', k0, k1, at: C.iA[Math.round((k0 + k1) / 2)], dt: C.delta[k1] - C.delta[k0], vMaxA: maxA, vMaxB: maxB, len: C.s[k1] - C.s[k0] }
}

/** Las razones, en frases cortas (de la comparada respecto a la referencia). */
export function reasons(z, { speed, unit }) {
  const out = []
  const sp = (dv) => `${Math.abs(Math.round(speed(dv)))} ${unit}`
  if (z.kind === 'corner') {
    if (z.brake != null && Math.abs(z.brake) >= 5) out.push(z.brake > 0 ? `frena ${Math.round(z.brake)} m antes` : `frena ${Math.round(-z.brake)} m más tarde`)
    if (Number.isFinite(z.vMinA) && Number.isFinite(z.vMinB) && Math.abs(speed(z.vMinB - z.vMinA)) >= 2) out.push(`${z.vMinB < z.vMinA ? 'pasa' : 'pasa'} ${sp(z.vMinB - z.vMinA)} ${z.vMinB < z.vMinA ? 'más despacio' : 'más rápido'}`)
    if (Math.abs(z.leanB - z.leanA) >= 3) out.push(`${Math.round(Math.abs(z.leanB - z.leanA))}° ${z.leanB < z.leanA ? 'menos' : 'más'} tumbada`)
    if (Number.isFinite(z.exitA) && Number.isFinite(z.exitB) && Math.abs(speed(z.exitB - z.exitA)) >= 3) out.push(`sale ${sp(z.exitB - z.exitA)} ${z.exitB < z.exitA ? 'más despacio' : 'más rápido'}`)
  } else if (Math.abs(speed(z.vMaxB - z.vMaxA)) >= 3) out.push(`punta ${sp(z.vMaxB - z.vMaxA)} ${z.vMaxB < z.vMaxA ? 'menos' : 'más'}`)
  return out
}
