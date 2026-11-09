// Análisis de salidas en segundo plano: con la página libre mientras tanto (una hora de moto son
// ~300 ms de cálculo, y comparar o cronometrar tramos analiza muchas seguidas).
import { analyze } from './process.js'

self.onmessage = (e) => {
  const { job, session } = e.data
  try {
    self.postMessage({ job, A: analyze(session) })
  } catch (err) {
    self.postMessage({ job, error: String(err?.message || err) })
  }
}
