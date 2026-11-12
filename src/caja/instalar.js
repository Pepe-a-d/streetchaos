// Página de la caja DIY (/caja/): instala la prueba de banco (hito H1) en la placa desde Chrome, por el
// USB y sin instalar nada en el Mac (Web Serial + esptool-js), y enseña lo que la placa dice de cada
// pieza. El firmware lo compila GitHub al publicar y lo deja en firmware/prueba/ junto a esta página
// (hardware/caja/firmware/scripts/publicar.mjs). Con ?demo (o ?demo=falla) enseña resultados de
// mentira, para ver cómo es sin placa.
import '@fontsource/press-start-2p'
import '../blackbox/style.css'
import './caja.css'
import { savedProfile, applyProfileTheme } from '../blackbox/theme.js'
import { esc } from '../blackbox/ui.js'
import { PREFIJO, lector, leerInforme, filas, resumen } from './informe.js'

applyProfileTheme(savedProfile())

const MONTAJE = 'https://github.com/Pepe-a-d/streetchaos/blob/main/hardware/caja/montaje.md'
// Espressif (el USB del propio ESP32-S3, también en el modo de instalación) y SparkFun
const FILTROS = [{ usbVendorId: 0x303a }, { usbVendorId: 0x1b4f }]
const FIRMWARE = new URL('firmware/prueba/', document.baseURI)
const SERIE = 'serial' in navigator
const DEMO = new URLSearchParams(location.search).get('demo')

const $ = (s) => document.querySelector(s)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let manifest = null
let puerto = null
let lectorActual = null
let desde = 0
let ultimo = 0
let informe = null
let ocupado = false
const log = []

function render() {
  $('#dl').innerHTML = `
    <header class="dl-top">
      <a class="logo" href="../">STREET<span>CHAOS</span></a><b class="tag">CAJA DIY</b>
      <span class="grow"></span>
      <a class="btn ghost small" href="../blackbox/">BLACKBOX</a>
    </header>
    <main class="dl-main">
      <h1>LA CAJA DIY</h1>
      <p class="dl-lead">Desde aquí se instalan los programas de la caja en su placa, por el cable USB y sin instalar nada en el Mac. Después, la página te dice si cada pieza funciona.</p>
      ${SERIE || DEMO != null ? '' : `<section class="dl-card cj-aviso"><h2>ABRE ESTA PAGINA EN CHROME</h2><p>Este navegador no puede hablar con la placa por el USB. Abre esta misma dirección en <b>Chrome</b> (o Edge) en el Mac: Safari y Firefox no sirven.</p></section>`}
      ${DEMO != null ? '<span class="cj-demo">DEMO: RESULTADOS DE MENTIRA, SIN PLACA</span>' : ''}
      <section class="dl-card" id="prueba">
        <h2>PRUEBA DE BANCO</h2>
        <p>Antes de soldar nada, comprueba la microSD, el GPS y el sensor (<a class="linkish" href="${MONTAJE}#1-pruebas-de-banco-sin-soldar" target="_blank" rel="noopener">montaje, apartado 1</a>).</p>
        <ol class="dl-steps">
          <li>La microSD, formateada en FAT32 («MS-DOS (FAT)»), metida en la ranura de la placa.</li>
          <li>Los cables Qwiic en cadena: placa → GPS → sensor. El sensor, plano sobre la mesa; la antena, junto a una ventana o fuera.</li>
          <li>La placa, conectada al Mac con un cable USB-C de datos.</li>
          <li>Pulsa <b>INSTALAR LA PRUEBA</b> y elige el puerto de la placa: suele salir como <i>USB JTAG/serial debug unit</i>. Tarda menos de un minuto.</li>
        </ol>
        <div class="cj-btns">
          <button class="btn" data-a="instalar">INSTALAR LA PRUEBA</button>
          <button class="btn ghost" data-a="ver">YA ESTA INSTALADA: VER RESULTADOS</button>
        </div>
        <p class="cj-estado" id="estado"></p>
        <div class="cj-barra" id="barra" hidden><i></i></div>
        <details class="dl-more"><summary>¿No sale ningún puerto, o falla la instalación?</summary>
          <ol class="dl-steps">
            <li>Mantén pulsado el botón <b>BOOT</b> de la placa.</li>
            <li>Pulsa y suelta <b>RESET</b>.</li>
            <li>Suelta BOOT y vuelve a pulsar INSTALAR LA PRUEBA.</li>
          </ol>
          <p>Si aun así no sale, prueba con otro cable USB-C: algunos solo cargan y no pasan datos. Cierra también cualquier otro programa o pestaña que esté usando la placa.</p>
          <p>Si después de instalar no salen resultados, pulsa RESET en la placa y luego VER RESULTADOS.</p>
        </details>
        <p class="note" id="version"></p>
      </section>
      <section class="dl-card" id="resultados" hidden>
        <h2>RESULTADOS</h2>
        <div class="cj-resumen espera" id="resumen"><b>ESPERANDO</b><span>Esperando el primer informe de la placa…</span></div>
        <div class="cj-filas" id="filas"></div>
        <div class="cj-btns"><button class="btn ghost small" data-a="repetir">REPETIR LA PRUEBA</button></div>
        <details class="dl-more"><summary>Detalles: lo que dice la placa</summary><pre class="cj-log" id="log"></pre></details>
      </section>
      <section class="dl-card web"><h2>LO QUE VIENE</h2><p>Cuando la placa base esté soldada, aquí saldrá <b>INSTALAR LA CAJA</b>, el programa de verdad, con su prueba de la caja. Y con la pantalla, <b>INSTALAR LA PANTALLA</b>.</p></section>
    </main>`
}

// ---------- Lo que se ve ----------

function estado(texto, error = false) {
  const el = $('#estado')
  el.textContent = texto
  el.classList.toggle('error', error)
}

function barra(f) {
  const el = $('#barra')
  el.hidden = f == null
  if (f != null) el.firstElementChild.style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`
}

function botones() {
  const sin = !SERIE || ocupado
  $('[data-a="instalar"]').disabled = sin || !manifest
  $('[data-a="ver"]').disabled = sin
  $('[data-a="repetir"]').disabled = !puerto
}

function anota(s) {
  for (const l of String(s).split(/\r?\n/)) if (l.trim()) log.push(l)
  if (log.length > 400) log.splice(0, log.length - 400)
  $('#log').textContent = log.join('\n')
}

function pintar() {
  $('#resultados').hidden = false
  if (!informe) return
  const r = resumen(informe)
  const el = $('#resumen')
  el.className = `cj-resumen ${r.estado}`
  el.innerHTML = `<b>${esc(r.titulo)}</b><span>${esc(r.texto)}</span>`
  $('#filas').innerHTML = filas(informe)
    .map((f) => `<div class="cj-fila ${f.estado}"><b>${f.nombre}</b><span class="pill">${esc(f.etiqueta)}</span><span class="txt">${esc(f.texto)}</span>${f.aviso ? `<span class="cj-av">${esc(f.aviso)}</span>` : ''}</div>`)
    .join('')
}

function error(e) {
  barra(null)
  const m = String(e?.message || e)
  anota(`ERROR: ${m}`)
  if (/Failed to open|already open|InvalidState/i.test(m)) estado('El puerto está ocupado: cierra cualquier otro programa o pestaña que use la placa (otra pestaña de esta página, Arduino…) y vuelve a probar.', true)
  else estado(`No se ha podido: ${m}. Prueba con BOOT y RESET (abajo) y vuelve a intentarlo.`, true)
}

// ---------- La placa ----------

const esNuestro = (p) => FILTROS.some((f) => f.usbVendorId === p.getInfo().usbVendorId)

async function cerrar() {
  const p = puerto
  puerto = null
  try {
    await lectorActual?.cancel()
  } catch {}
  await sleep(50)
  try {
    await p?.close()
  } catch {}
}

// Abre el puerto y lee los informes. Tras instalar, la placa se reinicia y el USB desaparece un momento:
// vuelve como otro puerto (con el mismo permiso), así que se buscan todos los suyos
async function leer(port) {
  estado('Esperando a la placa…')
  const fin = Date.now() + 15000
  let abierto = null
  while (!abierto && Date.now() < fin) {
    const otros = (await navigator.serial.getPorts()).filter((p) => p !== port && esNuestro(p))
    for (const p of [port, ...otros]) {
      try {
        await p.open({ baudRate: 115200 })
        abierto = p
        break
      } catch {}
    }
    if (!abierto) await sleep(500)
  }
  if (!abierto) throw new Error('la placa no ha vuelto a aparecer. Desconecta el cable, vuelve a conectarlo y pulsa VER RESULTADOS')
  // Sin tocar las señales de reinicio: que siga la prueba que ya va
  try {
    await abierto.setSignals({ dataTerminalReady: false, requestToSend: false })
  } catch {}
  puerto = abierto
  desde = Date.now()
  ultimo = 0
  barra(null)
  estado('Conectada: leyendo los resultados.')
  pintar()
  botones()
  bucle(abierto)
}

async function bucle(p) {
  const corta = lector()
  const dec = new TextDecoder()
  try {
    while (p.readable && puerto === p) {
      lectorActual = p.readable.getReader()
      try {
        for (;;) {
          const { value, done } = await lectorActual.read()
          if (done) break
          for (const l of corta(dec.decode(value, { stream: true }))) linea(l)
        }
      } catch {
        // Un error de la línea (no de desconexión): se vuelve a leer si el puerto sigue
      } finally {
        lectorActual?.releaseLock()
        lectorActual = null
      }
    }
  } catch {}
  if (puerto === p) {
    puerto = null
    botones()
    estado('Se ha desconectado la placa. Vuelve a conectarla y pulsa VER RESULTADOS.', true)
  }
}

function linea(l) {
  const d = leerInforme(l)
  if (d) {
    informe = d
    ultimo = Date.now()
    pintar()
    if ($('#estado').classList.contains('error')) estado('Conectada: leyendo los resultados.')
  } else if (!l.startsWith(PREFIJO)) anota(l)
}

async function instalar() {
  if (ocupado || !manifest) return
  let port
  try {
    port = await navigator.serial.requestPort({ filters: FILTROS })
  } catch {
    return // no eligió ninguno
  }
  ocupado = true
  botones()
  try {
    await cerrar()
    estado('Bajando la prueba…')
    const partes = await Promise.all(
      manifest.partes.map(async (p) => {
        const r = await fetch(new URL(p.archivo, FIRMWARE))
        if (!r.ok) throw new Error(`no se ha podido bajar ${p.archivo}`)
        return { address: p.dir, data: new Uint8Array(await r.arrayBuffer()) }
      }),
    )
    const { ESPLoader, Transport } = await import('esptool-js')
    const transport = new Transport(port, false)
    const terminal = { clean() {}, writeLine: anota, write: anota }
    const loader = new ESPLoader({ transport, baudrate: 921600, terminal })
    estado('Conectando con la placa…')
    const chip = await loader.main()
    if (!/ESP32-S3/i.test(chip)) throw new Error(`la placa lleva un ${chip}, no un ESP32-S3`)
    const total = partes.reduce((s, p) => s + p.data.length, 0)
    const antes = (i) => partes.slice(0, i).reduce((s, p) => s + p.data.length, 0)
    estado('Instalando la prueba: no desconectes la placa…')
    barra(0)
    await loader.writeFlash({
      fileArray: partes,
      flashMode: 'keep',
      flashFreq: 'keep',
      flashSize: 'keep',
      eraseAll: false,
      compress: true,
      reportProgress: (i, hecho, de) => barra((antes(i) + (de ? hecho / de : 1) * partes[i].data.length) / total),
    })
    barra(1)
    estado('Instalada. Reiniciando la placa…')
    // Reinicio por el USB del ESP32-S3: RTS con DTR suelto (el de esptool-js solo baja RTS)
    try {
      await transport.setDTR(false)
      await transport.setRTS(true)
      await sleep(100)
      await transport.setRTS(false)
    } catch {}
    try {
      await transport.disconnect()
    } catch {}
    await sleep(1500)
    await leer(port)
  } catch (e) {
    error(e)
  } finally {
    ocupado = false
    botones()
  }
}

async function ver() {
  if (ocupado) return
  let port
  try {
    port = await navigator.serial.requestPort({ filters: FILTROS })
  } catch {
    return
  }
  ocupado = true
  botones()
  try {
    await cerrar()
    await leer(port)
  } catch (e) {
    error(e)
  } finally {
    ocupado = false
    botones()
  }
}

async function repetir() {
  if (DEMO != null) return demo()
  if (!puerto?.writable) return
  const w = puerto.writable.getWriter()
  try {
    await w.write(new TextEncoder().encode('PRUEBA\n'))
    anota('> PRUEBA')
  } finally {
    w.releaseLock()
  }
}

// Si la placa deja de mandar informes (no tiene la prueba instalada, o se ha colgado)
setInterval(() => {
  if (!puerto || DEMO != null) return
  const ahora = Date.now()
  if (ahora - desde > 5000 && ahora - (ultimo || desde) > 4000) estado('La placa no manda resultados: ¿está instalada la prueba? Pulsa INSTALAR LA PRUEBA, o RESET en la placa.', true)
}, 1000)

// ---------- Demo, sin placa ----------

function demoInforme(s, falla) {
  if (falla)
    return {
      v: 1, fw: '1.0.0', up: s,
      sd: { st: 'falla', msg: 'No se puede abrir la tarjeta: métela hasta el fondo y comprueba que está en FAT32 (MS-DOS FAT)' },
      gps: { st: 'falla', msg: 'No contesta por el Qwiic (0x42): revisa el cable entre la placa y el GPS' },
      imu: { st: 'falla', msg: 'No contesta por el Qwiic (0x6A): revisa el cable entre el GPS y el sensor' },
    }
  const inclinando = s >= 6 && s < 8
  return {
    v: 1, fw: '1.0.0', up: s,
    sd: s < 2 ? { st: 'prueba' } : { st: 'ok', msg: '', tipo: 'SDHC', gb: 31.9, mbs: 9.8 },
    gps: s < 2 ? { st: 'prueba' } : { st: 'ok', msg: '', mod: 'NEO-M9N', fwv: 'SPG 4.04', pvt: 1, fix: s >= 12 ? 3 : 0, fixok: s >= 12 ? 1 : 0, sats: Math.min(14, 2 + Math.floor(s / 2)), hacc: 1.8, ttff: s >= 12 ? 12 : -1 },
    imu: s < 3 ? { st: 'prueba' } : { st: 'ok', msg: '', addr: 106, a: inclinando ? [6.93, 0.02, 6.93] : [0.04, -0.02, 9.81], g: inclinando ? [0.3, 41.5, 0.2] : [0.1, -0.1, 0.1], incl: s >= 7 ? 1 : 0 },
  }
}

let demoTimer = null
function demo() {
  clearInterval(demoTimer)
  let s = 0
  const paso = () => {
    informe = demoInforme(s, DEMO === 'falla')
    pintar()
    if (++s > 14) clearInterval(demoTimer)
  }
  anota('Prueba de banco de la caja DIY 1.0.0 (demo)')
  paso()
  demoTimer = setInterval(paso, 1000)
  $('[data-a="repetir"]').disabled = false
}

// ---------- Arranque ----------

render()
$('#dl').addEventListener('click', (e) => {
  const a = e.target.closest('[data-a]')?.dataset.a
  if (a === 'instalar') instalar()
  else if (a === 'ver') ver()
  else if (a === 'repetir') repetir()
})
if (SERIE) navigator.serial.addEventListener('disconnect', (e) => {
  if (e.target === puerto) anota('(placa desconectada)')
})
botones()
try {
  const r = await fetch(new URL('manifest.json', FIRMWARE), { cache: 'no-cache' })
  manifest = r.ok ? await r.json() : null
  if (!Array.isArray(manifest?.partes) || !manifest.partes.length) manifest = null
} catch {
  manifest = null
}
$('#version').textContent = manifest
  ? `Prueba ${manifest.version}${manifest.fecha ? ` · compilada el ${new Date(manifest.fecha).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}${manifest.commit ? ` · ${manifest.commit}` : ''}`
  : 'La prueba todavía no está publicada: sale aquí en cuanto se publique la página.'
botones()
if (DEMO != null) demo()
