// La página de la caja (/caja/) lee lo que manda la prueba de banco por el USB. Las líneas de
// fixtures/caja-prueba.txt salen del propio código del firmware (hardware/caja/firmware/lib/banco,
// compilado en el ordenador): si cambia el formato de un lado y no del otro, salta aquí.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { lector, leerInforme, filas, resumen } from '../src/caja/informe.js'

const texto = readFileSync(new URL('./fixtures/caja-prueba.txt', import.meta.url), 'utf8')
const lineas = texto.split('\n').filter(Boolean)
const informes = lineas.map(leerInforme).filter(Boolean)
const estado = (d) => Object.fromEntries(filas(d).map((f) => [f.id, f.estado]))

describe('caja: lector de líneas', () => {
  it('junta los trozos y respeta los saltos de línea de Windows', () => {
    const corta = lector()
    expect(corta('hola\r\nmun')).toEqual(['hola'])
    expect(corta('do\n@SC {"v"')).toEqual(['mundo'])
    expect(corta(':1}\n')).toEqual(['@SC {"v":1}'])
  })

  it('lo que manda la placa, troceado al azar, da los mismos informes', () => {
    const corta = lector()
    const got = []
    let i = 0
    let n = 1
    while (i < texto.length) {
      for (const l of corta(texto.slice(i, i + n))) got.push(l)
      i += n
      n = (n * 7 + 3) % 61 || 1
    }
    expect(got.map(leerInforme).filter(Boolean)).toEqual(informes)
  })
})

describe('caja: informes de la prueba de banco', () => {
  it('lee las líneas del firmware y deja las demás', () => {
    expect(informes).toHaveLength(4)
    expect(leerInforme(lineas[0])).toBeNull() // «Prueba de banco de la caja DIY 1.0.0»
    expect(leerInforme('@SC {"v":1,"sd":{')).toBeNull() // cortada
    expect(leerInforme('@SC {"v":2,"sd":{},"gps":{},"imu":{}}')).toBeNull() // otra versión del formato
    expect(informes[0].fw).toBe('1.0.0')
  })

  it('al arrancar, todo probando', () => {
    expect(estado(informes[0])).toEqual({ microsd: 'prueba', gps: 'prueba', sensor: 'prueba' })
    expect(resumen(informes[0]).estado).toBe('espera')
  })

  it('el GPS contesta pero busca satélites, y el sensor espera que lo inclines', () => {
    const d = informes[1]
    expect(estado(d)).toEqual({ microsd: 'ok', gps: 'espera', sensor: 'espera' })
    const [sd, gps, sensor] = filas(d)
    expect(sd.texto).toBe('SDHC de 31,9 GB · escribe a 9,8 MB/s')
    expect(gps.texto).toContain('NEO-M9N (SPG 4.04)')
    expect(gps.texto).toContain('3 a la vista')
    expect(gps.aviso).toMatch(/ventana/)
    expect(sensor.etiqueta).toBe('INCLINALO')
    expect(sensor.texto).toContain('Z 9,8 m/s²')
  })

  it('todo bien', () => {
    const d = informes[2]
    expect(estado(d)).toEqual({ microsd: 'ok', gps: 'ok', sensor: 'ok' })
    expect(filas(d)[1].texto).toContain('posición 3D a ±1,8 m · 14 satélites · la primera en 34 s')
    const r = resumen(d)
    expect(r.estado).toBe('ok')
    expect(r.titulo).toBe('TODO OK: EL MATERIAL ESTA BIEN')
  })

  it('sin cables: falla todo, y avisa de mirar primero el cable del GPS', () => {
    const d = informes[3]
    expect(estado(d)).toEqual({ microsd: 'falla', gps: 'falla', sensor: 'falla' })
    expect(filas(d)[0].texto).toMatch(/FAT32/)
    const r = resumen(d)
    expect(r.estado).toBe('falla')
    expect(r.texto).toMatch(/entre la placa y el GPS/)
  })

  it('los títulos y pastillas (letra de píxeles) no llevan mayúsculas con tilde', () => {
    const pix = informes.flatMap((d) => [resumen(d).titulo, ...filas(d).flatMap((f) => [f.nombre, f.etiqueta])])
    for (const t of pix) expect(t).not.toMatch(/[ÁÉÍÓÚÜÑ]/)
  })
})
