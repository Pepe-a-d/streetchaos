// Ayuda para quien empieza: qué es cada dato y cómo se lee. Se usa en los «?» y en los títulos que salen
// al pasar el ratón por encima de cada canal, recuadro y pestaña.

/** Una línea por canal (título al pasar el ratón) y la explicación larga (ayuda). */
export const GLOSS = {
  v: ['Velocidad', 'La del GPS, afinada con el acelerómetro entre posición y posición.'],
  lean: ['Inclinación', 'Cuánto va tumbada la moto respecto a la vertical (+ derecha). En carretera, 20-30° ya es ir rápido en curva; en circuito se llega a 45-55°.'],
  gLong: ['G longitudinal', 'Acelerar (+) y frenar (−), en «g» (1 g es la gravedad, 9,8 m/s²). Una frenada fuerte en moto ronda 0,8-1 g; acelerar una 125, 0,3-0,4 g.'],
  gLat: ['G lateral', 'La fuerza de la curva. En una curva redonda va con la inclinación: 30° de inclinación son unos 0,58 g.'],
  alt: ['Altitud', 'La del GPS: sirve para ver subidas y bajadas, con unos ±10 m de error.'],
  yaw: ['Giro', 'Lo que cambia el rumbo de la moto, en grados por segundo (+ derecha). Alto y corto: una curva cerrada.'],
  vib: ['Vibración', 'Lo que tiembla el móvil (motor, baches, soporte). Picos sueltos suelen ser baches.'],
  acc: ['Precisión del GPS', 'El error de la posición en metros: cuanto más bajo, mejor. Por encima de 15 m, desconfía de esa zona.'],
  hdg: ['Rumbo', 'Hacia dónde va la moto: 000° norte, 090° este, 180° sur, 270° oeste.'],
  t: ['Tiempo', 'Desde que empezó a grabar la salida.'],
  clock: ['Hora', 'La hora del día en ese momento.'],
  d: ['Distancia', 'Recorrida desde el principio de la salida.'],
}
export const tip = (k) => (GLOSS[k] ? `${GLOSS[k][0]}: ${GLOSS[k][1]}` : '')

/** Explicación corta encima del diagrama G-G. */
export const GG_HELP =
  'Cada punto es un instante: arriba aceleras, abajo frenas y a los lados vas en curva. Un piloto fino «redondea» el dibujo: sigue frenando un poco al tumbar y abre gas al levantar la moto. El color es la velocidad.'

/** La ayuda completa (botón «?» de arriba). */
export function helpHtml() {
  const g = Object.entries(GLOSS)
    .filter(([k]) => !['t', 'clock', 'd'].includes(k))
    .map(([, [n, d]]) => `<dt>${n}</dt><dd>${d}</dd>`)
    .join('')
  return `<h2>COMO SE LEEN TUS DATOS</h2>
    <h3 class="h">LO BASICO</h3>
    <ol class="help-steps">
      <li><b>Elige una salida</b> a la izquierda: verás el recorrido en el mapa y sus gráficas debajo.</li>
      <li><b>Mueve el ratón</b> por el mapa o las gráficas: los recuadros de arriba a la derecha dicen qué pasaba en ese momento.</li>
      <li><b>Arrastra sobre una gráfica</b> para quedarte con un tramo (una carretera, una vuelta). El resumen, las curvas, las frenadas y la potencia pasan a ser de ese tramo.</li>
      <li><b>Pulsa una curva o una frenada</b> en su pestaña (o el número de la curva en el mapa) para verla de cerca. Con ◀ ▶ pasas a la siguiente sin perder el tramo, y <b>← ATRAS</b> vuelve.</li>
      <li><b>COMPARAR</b> busca otras veces que pasaste por lo que estás viendo y te dice, metro a metro, dónde ganas o pierdes tiempo.</li>
      <li><b>GUARDAR TRAMO</b> lo cronometra solo en todas tus salidas, como un segmento de Strava.</li>
      <li><b>COMPARTIR</b> da un código para que un amigo se compare contigo en ese tramo; con <b>PASADA DE UN AMIGO</b> (a la izquierda) abres el suyo y ves dónde te gana.</li>
      <li><b>VIDEO</b> (debajo del mapa): elige el vídeo de tu GoPro y se sincroniza solo con su GPS. Al mover el cursor, el vídeo va a ese momento; al reproducirlo, los datos le siguen.</li>
    </ol>
    <h3 class="h">OTROS APARATOS</h3>
    <p class="note">Puedes importar (o soltar en la página) el CSV de <b>RaceBox</b> o <b>RaceChrono</b>, un <b>VBO</b> de VBOX, un <b>GPX</b> o un registro <b>NMEA</b>. Con 10-25 posiciones por segundo los tiempos y las velocidades son mucho más finos que con el móvil. Si el aparato da su propia inclinación o G (RaceBox en modo moto, RaceChrono), se usa la suya.</p>
    <p class="note">Vídeo: las GoPro desde la HERO5 graban su GPS dentro del vídeo y se sincronizan solas. Con otra cámara se usa su hora de grabación; ajústalo con −1 s / +1 s o, mejor, pon el vídeo y el cursor en el mismo momento (una frenada, un paso por meta) y pulsa <b>AQUI</b>. El vídeo no se sube a ningún sitio.</p>
    <h3 class="h">QUE ES CADA DATO</h3>
    <dl class="gloss">${g}</dl>
    <h3 class="h">LAS PESTAÑAS</h3>
    <dl class="gloss">
      <dt>Resumen</dt><dd>Lo mejor de la salida o del tramo y sus cifras. Las tarjetas con borde llevan a ese momento.</dd>
      <dt>G-G</dt><dd>${GG_HELP}</dd>
      <dt>Curvas</dt><dd>Cada vez que la moto va tumbada más de 12° al menos 1 s. ENTRA, MIN y SALE son la velocidad al entrar, la más baja y al salir: entrar más despacio y salir más rápido suele ser más rápido en total.</dd>
      <dt>Frenadas</dt><dd>Cada vez que frenas más de 0,25 g al menos 0,6 s: de qué velocidad a cuál, la fuerza máxima y los metros que te costó.</dd>
      <dt>Pasadas</dt><dd>Las salidas desde parado del crono (0-100, 1/8 de milla...), con sus parciales.</dd>
      <dt>Potencia</dt><dd>Con cada aceleración a fondo de al menos 2,5 s, la potencia que llega a la rueda (estimada con la masa y la aerodinámica). Sirve para comparar antes y después de tocar la moto.</dd>
      <dt>Calidad</dt><dd>De dónde sale cada dato y cómo de fiable es la salida.</dd>
    </dl>
    <h3 class="h">ATAJOS</h3>
    <dl class="gloss keys">
      <dt>Arrastrar</dt><dd>elegir un tramo</dd>
      <dt>Ctrl/⌘ + rueda</dt><dd>acercar o alejar</dd>
      <dt>Esc</dt><dd>volver atrás</dd>
      <dt>Doble clic</dt><dd>toda la salida</dd>
      <dt>← →</dt><dd>mover el cursor (con Mayús, de 1 s en 1 s)</dd>
      <dt>[ ]</dt><dd>curva o frenada anterior y siguiente</dd>
      <dt>Espacio</dt><dd>reproducir o parar el vídeo</dd>
    </dl>
    <p class="note">Ojo con la precisión: el GPS del móvil da una posición por segundo, así que los parciales muy cortos (60 ft) son orientativos. La inclinación va a ±4° y la velocidad a ±1 km/h.</p>
    <div class="actions"><button class="btn small" data-close>ENTENDIDO</button></div>`
}
