// Lo que manda la placa por el USB durante la prueba de banco y cómo se enseña. Cada segundo llega una
// línea «@SC {json}» con el estado de las tres piezas (lo escribe hardware/caja/firmware/lib/banco);
// lo demás es texto para leer una persona. Sin nada del navegador: se prueba con vitest.

export const PREFIJO = '@SC '

/** Parte lo que llega por el puerto en líneas enteras; guarda el trozo final hasta que llegue su salto */
export function lector() {
  let resto = ''
  return (texto) => {
    resto += texto
    const partes = resto.split(/\r?\n/)
    resto = partes.pop() ?? ''
    if (resto.length > 4096) resto = '' // basura sin saltos de línea
    return partes
  }
}

/** El informe de una línea, o null si no es una línea de informe (o está cortada) */
export function leerInforme(linea) {
  if (!linea.startsWith(PREFIJO)) return null
  try {
    const d = JSON.parse(linea.slice(PREFIJO.length))
    return d && d.v === 1 && d.sd && d.gps && d.imu ? d : null
  } catch {
    return null
  }
}

// Redondeado antes, para que un -0,02 no salga como «-0,0»
const num = (x, d = 1) => (Math.round((Number.isFinite(x) ? x : 0) * 10 ** d) / 10 ** d || 0).toLocaleString('es', { minimumFractionDigits: d, maximumFractionDigits: d })
const fallo = (p, def) => p.msg || def

/**
 * Una fila por pieza: { id, nombre, estado, etiqueta, texto, aviso }
 * - estado: 'ok' | 'falla' | 'espera' (va bien, pero falta algo que tienes que hacer tú) | 'prueba'
 * - etiqueta: lo que pone la pastilla (va en letra de píxeles: sin mayúsculas con tilde)
 */
export function filas(d) {
  const out = []
  const sd = d.sd
  if (sd.st === 'falla') out.push({ id: 'microsd', nombre: 'MICROSD', estado: 'falla', etiqueta: 'FALLA', texto: fallo(sd, 'No funciona') })
  else if (sd.st === 'ok') out.push({ id: 'microsd', nombre: 'MICROSD', estado: 'ok', etiqueta: 'OK', texto: `${sd.tipo || 'Tarjeta'} de ${num(sd.gb)} GB · escribe a ${num(sd.mbs)} MB/s` })
  else out.push({ id: 'microsd', nombre: 'MICROSD', estado: 'prueba', etiqueta: '...', texto: 'Escribiendo y leyendo un archivo de prueba…' })

  const g = d.gps
  if (g.st === 'falla') out.push({ id: 'gps', nombre: 'GPS', estado: 'falla', etiqueta: 'FALLA', texto: fallo(g, 'No funciona') })
  else if (g.st === 'ok') {
    const quien = [g.mod, g.fwv && `(${g.fwv})`].filter(Boolean).join(' ')
    const extra = g.msg ? ` · ${g.msg}` : ''
    if (g.fixok) {
      const t = g.ttff >= 0 ? ` · la primera en ${g.ttff} s` : ''
      out.push({ id: 'gps', nombre: 'GPS', estado: 'ok', etiqueta: 'OK', texto: `${quien} · posición 3D a ±${num(g.hacc)} m · ${g.sats} satélites${t}${extra}` })
    } else {
      out.push({
        id: 'gps',
        nombre: 'GPS',
        estado: 'espera',
        etiqueta: 'BUSCANDO',
        texto: `${quien} · buscando satélites: ${g.sats} a la vista${extra}`,
        aviso: 'Contesta bien. Falta la posición: lleva la antena junto a una ventana o, mejor, fuera. Con el cielo despejado tarda menos de un minuto.',
      })
    }
  } else out.push({ id: 'gps', nombre: 'GPS', estado: 'prueba', etiqueta: '...', texto: 'Preguntando al GPS qué modelo es…' })

  const s = d.imu
  if (s.st === 'falla') out.push({ id: 'sensor', nombre: 'SENSOR', estado: 'falla', etiqueta: 'FALLA', texto: fallo(s, 'No funciona') })
  else if (s.st === 'ok') {
    const [ax, ay, az] = s.a ?? [0, 0, 0]
    const giro = Math.hypot(...(s.g ?? [0, 0, 0]))
    const medida = `X ${num(ax)} · Y ${num(ay)} · Z ${num(az)} m/s² · giro ${num(giro)} °/s`
    if (s.incl) out.push({ id: 'sensor', nombre: 'SENSOR', estado: 'ok', etiqueta: 'OK', texto: `${medida} · al inclinarlo, cambia` })
    else out.push({ id: 'sensor', nombre: 'SENSOR', estado: 'espera', etiqueta: 'INCLINALO', texto: medida, aviso: 'En reposo mide bien. Ahora inclínalo despacio hacia un lado (más de 30°) y vuelve a dejarlo plano.' })
  } else out.push({ id: 'sensor', nombre: 'SENSOR', estado: 'prueba', etiqueta: '...', texto: 'Déjalo quieto y plano sobre la mesa…' })
  return out
}

/** Lo que dice la página arriba de las filas: { estado, titulo (letra de píxeles), texto } */
export function resumen(d) {
  const fs = filas(d)
  if (fs.some((f) => f.estado === 'falla')) {
    const sinCable = d.gps.st === 'falla' && d.imu.st === 'falla' && /no contesta/i.test(d.gps.msg) && /no contesta/i.test(d.imu.msg)
    return {
      estado: 'falla',
      titulo: 'ALGO FALLA',
      texto:
        (sinCable ? 'Fallan el GPS y el sensor a la vez: mira primero el cable Qwiic entre la placa y el GPS, porque el sensor va detrás. ' : '') +
        'Haz una captura de esta página y mándamela con una foto de cómo está conectado.',
    }
  }
  if (fs.every((f) => f.estado === 'ok')) return { estado: 'ok', titulo: 'TODO OK: EL MATERIAL ESTA BIEN', texto: 'Ya puedes pasar a soldar la placa base (montaje, apartado 2). Haz una captura de esta página y mándamela.' }
  return { estado: 'espera', titulo: 'PROBANDO', texto: 'Sigue lo que pide cada fila.' }
}
