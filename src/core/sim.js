// GPS simulado para probar sin moverse: una moto en una recta con gas, freno y dirección.
// Emite muestras como un móvil real (a 1 Hz por defecto, con ruido) y guarda la "verdad"
// exacta para comparar con lo que calcula el cronómetro.

import { BIKES, createBike, stepBike } from './physics.js'
import { destination } from './geo.js'
import { KMH, MILE } from './perf.js'

// Recta frente al mar en A Coruña (cualquier sitio vale)
const BASE = [43.3712, -8.4022]

export function createSimGps({ hz = 1, bike = 'sport', seed = Math.random() } = {}) {
  const st = createBike(BIKES[bike] || BIKES.sport)
  // Cada pestaña sale unos metros desplazada para que en el lobby se vean a distancia realista
  let [lat, lon] = destination(BASE[0], BASE[1], 0, 3 + (seed % 1) * 6)
  let heading = 78
  let alt = 18
  const input = { throttle: 0, brake: 0, steer: 0 }
  let timer = null
  let lastT = 0
  let nextEmit = 0
  let thrOn = 0
  const truth = { launch: null, k100: null, q: null, d0: 0 }
  let auto = null

  const rnd = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.8

  function physics(dt, t) {
    // Rampa de embrague al soltar desde parado
    let thr = input.throttle
    if (thr > 0) {
      thrOn += dt
      if (st.v < 8) thr *= Math.min(1, 0.35 + thrOn / 0.25)
    } else thrOn = 0
    const v0 = st.v
    const d0 = st.d
    stepBike(st, dt, thr, input.brake)
    if (v0 === 0 && st.v > 0) {
      truth.launch = t - dt
      truth.k100 = null
      truth.q = null
      truth.d0 = d0
    }
    if (truth.launch != null) {
      if (truth.k100 == null && st.v >= 100 * KMH) truth.k100 = t - truth.launch
      if (truth.q == null && st.d - truth.d0 >= MILE / 4) truth.q = { t: t - truth.launch, v: st.v }
    }
    heading = (heading + input.steer * Math.min(40, 300 / Math.max(st.v, 4)) * dt + 360) % 360
    const ds = st.d - d0
    if (ds > 0) [lat, lon] = destination(lat, lon, heading, ds)
    alt += ds * 0.004 // ligera subida
  }

  function loop() {
    const t = performance.now() / 1000
    let rest = Math.min(2, t - lastT)
    let tt = lastT
    lastT = t
    // Subpasos finos aunque el temporizador vaya a saltos (pestaña en segundo plano)
    while (rest > 1e-6) {
      const dt = Math.min(0.005, rest)
      tt += dt
      rest -= dt
      if (auto) runAuto(tt)
      physics(dt, tt)
      if (tt >= nextEmit) {
        nextEmit = tt + 1 / hz
        emit(tt)
      }
    }
  }

  let onFix = () => {}
  function emit(t) {
    const moving = st.v > 0.2
    const [la, lo] = destination(lat, lon, Math.random() * 360, Math.abs(rnd()) * 1.2)
    const v = Math.max(0, st.v + (moving ? rnd() * 0.15 : Math.abs(rnd()) * 0.05))
    const hdg = moving && st.v > 1 ? heading : null
    onFix({
      t,
      lat: la,
      lon: lo,
      v,
      acc: 3.5 + Math.random() * 1.5,
      alt: alt + rnd() * 1.5,
      heading: hdg,
      ts: Date.now() - Math.round((performance.now() / 1000 - t) * 1000),
      altAcc: 3,
      speedRaw: v,
      headingRaw: hdg,
    })
  }

  function runAuto(t) {
    const e = t - auto.t
    if (e < auto.wait) {
      input.throttle = 0
      input.brake = 0
    } else if (e < auto.wait + auto.hold) input.throttle = 1
    else {
      input.throttle = 0
      input.brake = 0.6
      if (st.v === 0) {
        input.brake = 0
        auto = null
      }
    }
  }

  return {
    kind: 'sim',
    input,
    truth,
    state: st,
    start(fn) {
      onFix = fn
      lastT = performance.now() / 1000
      nextEmit = lastT
      timer = setInterval(loop, 20)
    },
    stop() {
      clearInterval(timer)
      timer = null
    },
    /** Pasada automática: espera `wait` s parado, gas a fondo `hold` s y frena. */
    autoRun({ wait = 2.5, hold = 14 } = {}) {
      auto = { t: performance.now() / 1000, wait, hold }
    },
    setHz(h) {
      hz = h
    },
  }
}
