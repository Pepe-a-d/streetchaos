// Página de descarga del Blackbox: elige la versión para tu ordenador (Windows o Mac, chip M o Intel),
// con lo que pesa, la versión publicada y cómo abrirla la primera vez (no están firmadas: Windows y macOS
// avisan). Los archivos salen de las Releases de GitHub con nombres fijos, así el enlace es siempre a la
// última. Usa el tema de colores de tu móvil si este navegador ya está vinculado.
import '@fontsource/press-start-2p'
import './style.css'
import { savedProfile, applyProfileTheme } from './theme.js'
import { esc } from './ui.js'

applyProfileTheme(savedProfile())

const REPO = 'Pepe-a-d/streetchaos'
const RELEASES = `https://github.com/${REPO}/releases`
const FILES = {
  setup: 'Blackbox-StreetChaos-Setup.exe',
  portable: 'Blackbox-StreetChaos-portable.exe',
  macArm: 'Blackbox-StreetChaos-mac-arm64.dmg',
  macIntel: 'Blackbox-StreetChaos-mac-x64.dmg',
}
const url = (f) => `${RELEASES}/latest/download/${f}`
const QUARANTINE = 'xattr -dr com.apple.quarantine "/Applications/Blackbox Street Chaos.app"'

/** Qué ordenador es: { os: 'win' | 'mac' | 'other', arm: true | false | null } */
async function detect() {
  const ua = navigator.userAgent
  const plat = navigator.userAgentData?.platform || navigator.platform || ''
  const os = /win/i.test(plat) || /Windows/.test(ua) ? 'win' : /mac/i.test(plat) || /Macintosh/.test(ua) ? 'mac' : 'other'
  let arm = null
  if (os === 'mac') {
    // Chrome y Edge lo dicen; Safari no (dice «Intel» siempre): se mira la tarjeta gráfica
    try {
      const h = await navigator.userAgentData?.getHighEntropyValues?.(['architecture'])
      if (h?.architecture) arm = h.architecture === 'arm'
    } catch {}
    if (arm == null) {
      try {
        const gl = document.createElement('canvas').getContext('webgl')
        const ext = gl?.getExtension('WEBGL_debug_renderer_info')
        const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ''
        if (/Apple M\d|Apple GPU/i.test(r)) arm = true
        else if (/Intel|AMD|Radeon/i.test(r)) arm = false
      } catch {}
    }
  }
  return { os, arm }
}

const mb = (b) => (b ? `${Math.round(b / 1048576)} MB` : '')

function render(me, rel) {
  const size = (f) => mb(rel?.assets?.find((a) => a.name === f)?.size)
  const ver = rel?.tag_name ? `Versión <b>${esc(rel.tag_name.replace(/^v/, ''))}</b>${rel.published_at ? ` · ${new Date(rel.published_at).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}` : 'La última versión publicada'
  const macRec = me.os === 'mac' ? (me.arm === false ? 'intel' : 'arm') : null
  const card = (id, on, html) => `<section class="dl-card ${on ? 'rec' : ''}" id="${id}">${on ? '<span class="dl-rec">PARA ESTE ORDENADOR</span>' : ''}${html}</section>`
  const btn = (f, label, sub, cls = '') => `<a class="btn ${cls}" href="${url(f)}" rel="noopener">⬇ ${label}<small>${[sub, size(f)].filter(Boolean).join(' · ')}</small></a>`
  const win = card(
    'windows',
    me.os === 'win',
    `<h2>WINDOWS</h2>
    <p>Windows 10 u 11 (64 bits).</p>
    <div class="dl-btns">${btn(FILES.setup, 'INSTALADOR', 'se actualiza solo')}${btn(FILES.portable, 'PORTABLE', 'sin instalar', 'ghost')}</div>
    <ol class="dl-steps">
      <li>Abre el instalador. Windows puede decir que <i>protegió tu PC</i> (no está firmada): pulsa <b>Más información → Ejecutar de todas formas</b>.</li>
      <li>Elige dónde instalarla y listo. Las versiones nuevas se instalan solas.</li>
    </ol>`,
  )
  const mac = card(
    'mac',
    me.os === 'mac',
    `<h2>MAC</h2>
    <p>macOS 11 o más nuevo. ¿Qué Mac tienes? En el menú de la manzana (arriba a la izquierda) → <b>Acerca de este Mac</b>: pone <i>Chip Apple M…</i> o <i>Procesador Intel</i>.</p>
    <div class="dl-btns">${btn(FILES.macArm, 'MAC CON CHIP M', 'M1, M2, M3, M4…', macRec === 'intel' ? 'ghost' : '')}${btn(FILES.macIntel, 'MAC CON INTEL', 'hasta 2020', macRec === 'intel' ? '' : 'ghost')}</div>
    <ol class="dl-steps">
      <li>Abre el .dmg y arrastra <b>Blackbox Street Chaos</b> a <b>Aplicaciones</b>.</li>
      <li>Ábrela. La primera vez macOS dirá que <i>no puede comprobar que esté libre de malware</i> (no está firmada por Apple): pulsa <b>Hecho</b>.</li>
      <li>Ve a <b>Ajustes del Sistema → Privacidad y seguridad</b>, baja hasta el final y pulsa <b>Abrir igualmente</b> (te pide tu contraseña). Desde entonces se abre normal.</li>
    </ol>
    <details class="dl-more"><summary>¿Dice que está dañada o no sale «Abrir igualmente»?</summary>
      <p>Abre la app <b>Terminal</b>, pega esto y pulsa Intro; después ábrela otra vez:</p>
      <div class="dl-code"><code>${esc(QUARANTINE)}</code><button class="btn small ghost" data-copy>COPIAR</button></div>
    </details>
    <p class="note">En el Mac no se actualiza sola: al abrirla te avisa si hay una versión nueva y te trae aquí.</p>`,
  )
  const order = me.os === 'mac' ? [mac, win] : [win, mac]
  document.getElementById('dl').innerHTML = `
    <header class="dl-top">
      <a class="logo" href="../">STREET<span>CHAOS</span></a><b class="tag">BLACKBOX</b>
      <span class="grow"></span>
      <a class="btn ghost small" href="../">← VOLVER AL BLACKBOX</a>
    </header>
    <main class="dl-main">
      <h1>DESCARGAR EL BLACKBOX</h1>
      <p class="dl-lead">El mismo Blackbox de la web como programa: va más suelto, funciona sin conexión (salvo el mapa y la nube) y pone el mapa, las gráficas, los datos y el vídeo cada uno en su pantalla, acordándose de dónde los dejas.</p>
      <p class="note">${ver} · <a class="linkish" href="${RELEASES}" target="_blank" rel="noopener">todas las versiones</a></p>
      <div class="dl-grid">${order.join('')}</div>
      <section class="dl-card web"><h2>SIN INSTALAR NADA</h2><p>El Blackbox también va en el navegador (mejor en Chrome, Edge o Safari): <a class="linkish" href="../">abrirlo aquí</a>.</p></section>
      <p class="note">Tu móvil se vincula igual en todas: con el código de 6 letras de <i>Garaje → Datos → Vincular el ordenador</i>. Las salidas que tengas en este navegador no pasan solas a la app: bájalas de la nube o impórtalas.</p>
    </main>`
  document.querySelector('[data-copy]')?.addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(QUARANTINE)
      e.target.textContent = 'COPIADO'
    } catch {
      e.target.textContent = 'SELECCIONA Y COPIA'
    }
  })
}

const me = await detect()
render(me, null)
// La versión y lo que pesa cada archivo (si GitHub contesta; si no, los enlaces valen igual)
try {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
  if (r.ok) render(me, await r.json())
} catch {}
if (location.hash) document.querySelector(location.hash)?.scrollIntoView()
