// Pantalla de «añade la app a la pantalla de inicio». En el iPhone, abierta en Safari, solo se enseña
// esto: sin instalar no hay pantalla completa, el GPS y los sensores se cortan antes y lo que se guarda
// en Safari no lo ve la app instalada (iOS separa sus datos).
import { pixelSvg } from './pixel.js'

const isIPad = () => /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

// Iconos de Safari dibujados a píxel (el de compartir y el de añadir)
const SHARE = pixelSvg(['....X....', '...XXX...', '..X.X.X..', '....X....', 'XX..X..XX', 'X.......X', 'X.......X', 'X.......X', 'XXXXXXXXX'], { X: 'currentColor' })
const ADD = pixelSvg(['XXXXXXXXX', 'X.......X', 'X...X...X', 'X...X...X', 'X.XXXXX.X', 'X...X...X', 'X...X...X', 'X.......X', 'XXXXXXXXX'], { X: 'currentColor' })
const MORE = pixelSvg(['........', '........', '........', 'XX.XX.XX', 'XX.XX.XX', '........', '........', '........'], { X: 'currentColor' })

export function showInstallGate() {
  document.body.classList.add('crt', 'gate')
  const app = document.getElementById('app')
  const ipad = isIPad()
  app.innerHTML = `
    <section class="install">
      <img class="ins-icon" src="icons/apple-touch-icon.png" alt="" width="96" height="96" />
      <h1>INSTALA STREET CHAOS</h1>
      <p class="ins-why">Street Chaos funciona como una app: a pantalla completa, con el GPS y los sensores sin cortes. Para eso hay que abrirla desde su icono, no desde Safari.</p>
      <ol class="ins-steps">
        <li><span class="ins-ico">${SHARE}</span><span>Toca <b>Compartir</b> (el cuadrado con la flecha). Si no lo ves, toca antes <span class="ins-inline">${MORE}</span>.</span></li>
        <li><span class="ins-ico">${ADD}</span><span>Elige <b>Añadir a pantalla de inicio</b>.</span></li>
        <li><span class="ins-ico ins-num">3</span><span>Deja activado <b>Abrir como app web</b> y toca <b>Añadir</b>.</span></li>
        <li><span class="ins-ico ins-num">4</span><span>Abre <b>Street Chaos</b> desde su icono nuevo.</span></li>
      </ol>
      <p class="ins-note">¿Ya la tienes instalada? Ábrela desde su icono: lo que guardes aquí en Safari no lo verá.</p>
      ${ipad ? '' : '<div class="ins-arrow" aria-hidden="true">▼</div>'}
    </section>`
}
