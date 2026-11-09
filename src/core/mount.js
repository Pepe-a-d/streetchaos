// Postura del móvil en la moto e inclinación. Solo matemática: la usan la app (core/telemetry.js) y
// el analizador (blackbox/process.js).
//
// Convenios de los sensores, vistos en datos de verdad (primera salida del 2026-11-09, iPhone):
// - Gravedad. El estándar web da en reposo la aceleración «con gravedad» hacia ARRIBA (+9,8 en el eje
//   que mira al cielo); Safari en iPhone la da hacia ABAJO. `conv` (+1 / -1) la pasa a «hacia arriba»,
//   y lo mismo vale para la aceleración sin gravedad.
// - Giroscopio. El estándar da alpha = giro sobre z, beta = sobre x, gamma = sobre y ('w3c'). Safari en
//   iPhone da alpha = x, beta = y, gamma = z ('xyz'). Con los ejes del estándar, en aquella salida la app
//   tomaba el ritmo al que tumbabas por el giro de la moto y daba 71° donde había 15°.
//
// Ejes del móvil (fijos al aparato, giren o no la pantalla): x a la derecha y y arriba con el móvil en
// vertical, z saliendo de la pantalla.

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = (a) => Math.hypot(a[0], a[1], a[2])
export function norm(a) {
  const m = len(a)
  return m > 0 ? [a[0] / m, a[1] / m, a[2] / m] : null
}
/** Componente de v perpendicular a `up` (unitario), normalizada. */
export function orthoTo(v, up) {
  const d = dot(v, up)
  return norm([v[0] - d * up[0], v[1] - d * up[1], v[2] - d * up[2]])
}
/** Ángulo entre dos vectores unitarios (rad). */
export const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))))

/** Asignación de ejes del giroscopio por defecto. */
export const defaultAxes = (ios) => (ios ? 'xyz' : 'w3c')
/** Convenio de la gravedad por defecto (+1: hacia arriba, el estándar; -1: hacia abajo, iPhone). */
export const defaultConv = (ios) => (ios ? -1 : 1)

/** Giro en ejes del móvil [x, y, z] (°/s) según la asignación de ejes. */
export function gyroVec(rr, axes) {
  return axes === 'xyz' ? [rr.alpha, rr.beta, rr.gamma] : [rr.beta, rr.gamma, rr.alpha]
}

/**
 * El eje del móvil que apunta a la derecha de lo que se ve en pantalla, según cómo esté girada
 * (screen.orientation.angle: 0 vertical, 90 horizontal con la parte de arriba del móvil a la izquierda,
 * 180 al revés, 270 horizontal hacia el otro lado). En un soporte, la derecha de la pantalla es la
 * derecha del piloto.
 */
export function screenRight(angle) {
  const a = (((Math.round((angle || 0) / 90) * 90) % 360) + 360) % 360
  return a === 90 ? [0, -1, 0] : a === 180 ? [-1, 0, 0] : a === 270 ? [0, 1, 0] : [1, 0, 0]
}

/**
 * Inclinación (rad, + a la derecha). wu = vertical del mundo vista por el móvil (unitaria, hacia
 * arriba); up = vertical de la moto recta; right = eje lateral de la moto (perpendicular a up).
 * Es el giro de la vertical del mundo alrededor del eje de avance: va de -180° a 180° sin saltos
 * (el cálculo antiguo se quedaba en ±45° y daba la vuelta).
 */
export function leanAngle(wu, up, right) {
  return Math.atan2(-dot(wu, right), dot(wu, up))
}

/** Eje lateral (+ derecha) a partir del avance y la vertical. */
export const rightFrom = (fwd, up) => norm(cross(fwd, up))
