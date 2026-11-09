# Street Chaos

Web app (PWA) para llevar en la moto: dashboard por GPS, cronómetro de aceleración y *drag races* contra otros pilotos que tengan la app abierta cerca. Estética de arcade de carreras retro. Funciona en vertical y en horizontal.

## Arrancar

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests del cronometraje, la telemetría, la caja negra, el Blackbox y los logros
npm run build      # versión de producción en dist/
```

En el móvil: el GPS y los sensores solo funcionan con HTTPS. `npm run dev:movil` sirve la app con un certificado autofirmado en la red local (abre la URL `https://<ip-del-mac>:5173` y acepta el aviso).

Sin moverte: **Garaje → Fuente GPS → Simulador**. Aparecen los mandos GAS / FRENO / ◀ ▶ (también flechas o WASD).

## Pantallas

- **DASH**: varias pantallas que se pasan deslizando (de fábrica CARRETERA, CIRCUITO y MINIMA), hechas con bloques: velocímetro, inclinómetro, círculo G, inclinación y G en número con barra, hora, brújula, gráficas de velocidad (1 min) y de altitud (10 min), viaje, tiempo, media, punta, máximos, altitud, rumbo, total, récords, última pasada, GPS y caja negra. **EDITAR** (abajo a la derecha) deja añadir bloques desde un catálogo con vista previa en vivo, tocar uno para cambiar su medida o quitarlo, arrastrarlo para moverlo, y en PANTALLAS renombrar, ordenar, borrar o crear pantallas desde plantillas (también VIAJE). La rejilla es de 6×8 casillas en vertical y 12×4 en horizontal; los bloques se colocan solos en orden (`src/ui/dash.js`, `src/ui/widgets.js`) y el editor avisa si algo no cabe en una orientación.
- **Voz** (Garaje → Voz): la app habla con la voz en español del móvil, por donde suene (el intercomunicador del casco si está conectado): el tiempo de cada pasada y si es récord, el resultado de los duelos, avisos al pasar de las velocidades que elijas, GPS perdido y recuperado, cuándo empieza y guarda la caja negra, los logros y, si se activa, los grados al salir de las curvas fuertes. Cada aviso se puede apagar (`src/core/voice.js`, `src/core/announcer.js`). En iPhone la voz se desbloquea con el primer toque.
- **Logros y nivel** (Garaje → Logros): 30 medallas pixel de bronce, plata y oro por distancia, horas en marcha, noche, velocidad, inclinación, G, crono, duelos y caja negra, con su avance. La experiencia (logros + km + pasadas + victorias) da el nivel, de NOVATO a LEYENDA; al desbloquear sale un cartel con fanfarria y voz (`src/core/achievements.js`, `src/ui/medals.js`, `src/ui/unlock.js`). Lo que ya tenías hecho se apunta sin fiesta la primera vez.
- **Apariencia** (Garaje): temas de color para toda la app (SYNTHWAVE, LCD VERDE, AMBAR, TOKIO, CARRERAS, OCASO y SOL, claro y sin sombras para leer a pleno sol), números del DASH en LCD, PIXEL o LIMPIO, el color de tu moto como acento y el efecto CRT (`src/ui/themes.js`: cada tema redefine las variables de color de `style.css`).
- **CRONO**: se arma solo al parar la moto y cronometra al salir. Una pasada mide a la vez 0-50/100/150/200, 100-200, 60 ft, 330 ft, 1/8 de milla, 1000 ft y 1/4 de milla con velocidad de trampa. Rollout de 1 pie opcional. Récords y ticket de cada pasada.
- **VS**: radar de pilotos cercanos (radio 0,5 / 1,5 / 3 km), retos a 1/8, 1/4 o 0-100, y duelos contra la CPU (4 clases de moto inventadas) o contra tu fantasma (tu mejor pasada).
- **GARAJE**: tu piloto (nombre, moto, color), récords, duelos ganados/perdidos, historial y ajustes.
- **Pantalla negra** (la luna de la barra de arriba): todo en negro con solo un punto «REC» tenue que cambia de sitio. La app sigue en primer plano y graba igual (GPS, sensores, crono, caja negra), gasta poca batería en pantallas OLED, deja de dibujar lo de debajo e ignora los toques; se sale manteniendo pulsado 1,6 s. Es lo más parecido a «segundo plano» que permite una web: con el móvil bloqueado o con otra app delante, el navegador congela la app.

## Cómo se cronometra

Los móviles dan GPS a ~1 Hz, así que el motor (`src/core/perf.js`) no espera a "la muestra que pasa de 100":

- interpola la velocidad entre muestras y resuelve el cruce exacto de cada velocidad; si el acelerómetro ya sabe dónde es «delante», entre muestra y muestra la velocidad sigue su forma (se ven los cambios de marcha) y pasa justo por las del GPS;
- integra la distancia con esa misma curva y resuelve el cruce de cada distancia (ecuación de segundo grado);
- la salida es el tirón del acelerómetro, llevado atrás hasta donde empezó a subir la aceleración; sin acelerómetro, se extrapola con las dos primeras muestras.

El GPS del iPhone llega ~1 s tarde respecto a los sensores: la app se lo descuenta a cada muestra (`gpsLag` en `src/core/telemetry.js`) para que el tirón y la velocidad vayan en el mismo reloj. Si el móvil no da velocidad (parado o muy despacio), no se inventa con las posiciones: con 15-25 m de error eso daba saltos falsos de 130 km/h.

Con una moto simulada muestreada a 1 Hz con ruido, el error peor ronda **0,08 s** en 0-100, 1/8 y 1/4 (`npm test`). Con un GPS externo de 10 Hz mejoraría, pero no hace falta para jugar.

La inclinación sale de la **gravedad que calcula el propio móvil** con el acelerómetro y el giroscopio: el giro de la vertical alrededor del eje de avance de la moto, a cualquier velocidad y sin saltos (de −180° a 180°). La postura del móvil en el soporte se aprende sola y se guarda (`src/core/mount.js`, ajuste `mount`): la vertical al empezar y afinada en recta, el «delante» acelerando y frenando, y el sentido con la primera curva clara del GPS (hasta entonces no hay récords de inclinación). El lateral no sigue a la pantalla en marcha: si el iPhone gira la pantalla al tumbar, el inclinómetro no cambia de sentido. «Poner a 0» (Garaje, o mantener pulsado el inclinómetro) la calibra al momento con la moto recta. Sin esa gravedad, se usa la física del giro (`sen φ = v·giro/g`) con el giroscopio, y sin sensores el rumbo del GPS. El iPhone da la gravedad al revés y los ejes del giroscopio cambiados respecto al estándar: la app lo sabe y además lo comprueba con los giros del GPS. Los récords que se midieron mal antes de esto se rehacen una vez con la caja negra (`src/core/recalc.js`).

## Duelos online

1. El retador ve a los pilotos de su zona (celdas geohash de ~1,2 × 0,6 km y sus vecinas) y manda el reto.
2. Al aceptar, los dos tienen que estar parados ("listos"). El retado sincroniza su reloj con el del retador con pings.
3. Árbol de salida: tres ámbar cada 0,5 s y verde. Salir antes del verde es **salida nula**.
4. Cada móvil mide su reacción y su tiempo; gana quien cruza antes contando desde el verde (reacción + ET).

La red va por **Supabase Realtime** (presencia y mensajes, sin tablas). Crea `.env.local` a partir de `.env.example` con la URL y la clave pública del proyecto. Sin configurar, la app funciona en **modo local**: los retos solo llegan a otras pestañas del mismo navegador (útil para probar). `?local` en la URL fuerza ese modo.

Privacidad: en el radar se comparte la posición redondeada a ~10 m, solo mientras la app está abierta, y se puede apagar en Garaje → «Visible en el radar».

## Datos

**Caja negra**: la app guarda sola, solo en el móvil (IndexedDB), la telemetría en bruto de cada salida en moto: cada fix del GPS con posición, todos los eventos del acelerómetro y el giroscopio, lo que calcula la app a 10 Hz (velocidad, G, inclinación) y eventos como las pasadas del crono. No se enseña en la app: es para analizarla en el ordenador. Empieza al pasar de 9 km/h (con los 30 s de antes) y acaba tras 3 minutos parado. Se apaga en Garaje → Ajustes. Formato y cómo leerlo: [`docs/telemetria.md`](docs/telemetria.md).

**Garaje → Datos**:
- **Subir a la nube**, **Vincular el ordenador** y **Enlace al ordenador**: ver «Blackbox» más abajo.
- **Exportar**: un `.json` con la telemetría, las pasadas y los duelos, para pasarlo al ordenador (AirDrop, Drive, correo).
- **Enviar para análisis**: solo las pasadas y los duelos, sin posición ni telemetría, a la tabla `analysis_uploads` de Supabase (ver `supabase/migrations/`: la app solo puede insertar, nadie puede leerlos con la clave pública). Cada pasada lleva los parciales, la traza desde la salida y las muestras GPS en bruto (tiempo, velocidad, precisión y altitud).
- **Borrar** la telemetría (para liberar espacio después de exportarla) o el historial.

## Blackbox: el analizador

Es la parte del ordenador: abriendo la dirección de la app (https://pepe-a-d.github.io/streetchaos/) en un ordenador se va sola a **`/blackbox`** (con `?app` se queda en la app, para probarla). En el iPhone, abierta en Safari en vez de desde la pantalla de inicio, la app solo enseña cómo añadirla a inicio.

**Vincular**: en el móvil, Garaje → Datos → **Vincular el ordenador** da un código de 6 letras (10 minutos, un solo uso) que se escribe en el Blackbox. Desde entonces llegan solas las salidas que sube el móvil (mira cada minuto mientras está abierto y al volver a la pestaña) y el **perfil** del piloto: nombre, moto, nivel, logros, récords y mejores tiempos del crono, y su **tema de colores**, que el Blackbox usa también (mapa claro con los temas claros). Sigue valiendo importar el `.json` exportado (botón o soltándolo en cualquier parte) y el enlace con la clave larga.

El **inicio** enseña el perfil y las últimas salidas (sin vincular, los tres pasos para hacerlo); la barra de la izquierda, la ficha del piloto, el estado del móvil vinculado y las salidas por días. Para cada salida:

- **Mapa** con la traza coloreada por velocidad, inclinación, G longitudinal, G lateral o altitud, y las curvas numeradas.
- **Gráficas apiladas** (velocidad, inclinación, G, altitud, giro, vibración, precisión del GPS) con el cursor sincronizado con el mapa, eje de tiempo o distancia, zoom arrastrando y una tira de vista general. Se puede superponer lo que calculó el móvil en marcha.
- **Tramo de trabajo**: arrastrando eliges un tramo; las listas de curvas, frenadas y tirones son siempre de ese tramo. Un clic en una curva (en la lista o en su número del mapa), una frenada o una pasada acerca a ella sin perder el tramo, y ◀ ▶ (o `[` `]`) pasan a la anterior y la siguiente. **← ATRÁS** (o Esc) vuelve a lo que veías antes y cada salida recuerda dónde la dejaste. El CSV es del tramo elegido.
- **Mejorar**: en cada tramo guardado, **sectores** (2 a 6 trozos iguales; el mejor de cada uno en morado) y la **vuelta óptima** (la suma de tus mejores sectores) con el sector donde más se te va; al **comparar** dos pasadas, **dónde gana y pierde** curva a curva (desde la frenada hasta la salida) y por qué: frena antes, pasa más despacio, tumba menos o sale con menos velocidad (`src/blackbox/coach.js`).
- **Tu evolución**: en el inicio, inclinación máxima y punta de cada salida y kilómetros por semana; en cada tramo, tu mejor tiempo de cada día.
- **Notas** en cada salida (texto y etiquetas como lluvia, pasajero o reglajes) y exportación a **GPX** (Google Earth, Strava) del tramo o de toda la salida.
- **Para quien empieza**: botón **?** con cómo se leen los datos, glosario y atajos; cada canal, recuadro y pestaña explica qué es al pasar el ratón; el resumen empieza con **lo mejor de la salida** en frases (curva más tumbada, la más rápida, frenada más fuerte, punta, mejor 0-100) con enlace a cada momento y comparado con tus récords; y gráficas preparadas (BÁSICA, CURVAS, FRENADAS, TODO).
- **Pestañas**: resumen de la salida o del tramo elegido en tarjetas (las que tienen borde llevan a ese momento; ★ si iguala o mejora tu récord del móvil), diagrama G-G con su envolvente e histograma de inclinación, curvas (inclinación y velocidades de entrada, mínima y salida), frenadas, pasadas del crono y calidad de los datos.
- **CSV** con los canales a 10 Hz.
- **Comparar**: eliges un tramo, busca otras pasadas por él (vueltas de la misma salida u otras salidas) y las alinea por distancia: diferencia de tiempo metro a metro, velocidad, inclinación y G de las dos, y en el mapa la otra en verde donde gana y en rojo donde pierde. Las pasadas del crono se comparan desde la salida.
- **Tramos**: guardas un tramo y se cronometra solo en todas tus salidas (en un circuito cerrado cuenta vueltas). Los tramos marcados como circuito cerrado se pueden compartir y tienen clasificación entre pilotos; los de carretera abierta se quedan en tu navegador, solo con tus tiempos.
- **Potencia** (banco virtual): con la masa de moto y piloto y la aerodinámica, cada tirón a fondo da una curva de potencia en rueda frente a la velocidad. Es una estimación para comparar antes y después de tocar la moto.

**Nube**: el móvil sube solo cada salida al terminarla (Garaje → Datos → Subir a la nube; se puede apagar) a un almacén privado de Supabase. Solo la lee quien tenga la clave de sincronización de ese móvil (o un código de vincular aún sin usar). La función `supabase/functions/caja-negra` reparte URLs firmadas de subida y bajada, guarda cada móvil en la carpeta de la huella de su clave, guarda el perfil (`bb_profile`) y cambia los códigos de 6 letras por la clave (`bb_pair`); ninguna de esas tablas se puede leer con la clave pública. Unos 6-9 MB por hora de moto; el plan gratis de Supabase da 1 GB.

Comparar y tramos usan `src/blackbox/align.js` (proyecta una salida sobre el trazado de otra con una rejilla, encuentra las pasadas de principio a fin en el mismo sentido y las alinea por la distancia que recorre cada moto); la potencia, `src/blackbox/dyno.js`.

**Rendimiento**: el análisis va en un worker (`analyze.worker.js`, la página no se para) y se guarda en el navegador junto con la salida (se rehace si la salida crece o cambia `ANALYSIS_VERSION`); el G-G dibuja su fondo una vez y solo mueve el cursor; el cursor del mapa es un marcador.

El análisis (`src/blackbox/process.js`) es offline y por eso más fino que el del móvil: traza la curva entre fixes de GPS con un spline que respeta su rumbo y velocidad, saca la postura del móvil en el soporte (arriba = gravedad media, adelante = la dirección del acelerómetro que mejor explica lo que acelera el GPS), da la G longitudinal del acelerómetro calibrado, mide el retraso del GPS respecto a los sensores y lo descuenta, prueba las dos asignaciones de ejes del giroscopio (estándar e iPhone), y saca la inclinación de la gravedad del propio móvil (o, si no la da, de `sen φ = v·giro/g` fusionada con el giro de alabeo, sin retraso). La velocidad es solo la del GPS: los huecos se rellenan entre vecinos o a 0, nunca con saltos de posición. `src/blackbox/synth.js` inventa salidas con física y ruido realistas para probarlo (`tests/analysis.test.js`: error medio de inclinación < 2,5°) y para la demo (`node scripts/demo-telemetry.mjs` → `public/demo/`).

No se guarda para usar sin conexión: la app del móvil (PWA) deja fuera sus archivos (`bb-*`).

## Blackbox V2: varias pantallas y app de Windows

**Varias ventanas**: el mapa, las gráficas y los datos se pueden abrir cada uno en su ventana (botón **VENTANAS**). Van todas a una (abrir una salida, elegir un tramo, mover el cursor, cambiar unidades o canales) con un `BroadcastChannel`; la principal esconde lo que está en otra ventana y le da el sitio a lo demás. **Repartir en mis pantallas** pone la principal en tu pantalla y el mapa y las gráficas en las otras (en Chrome/Edge con la Window Management API, que pide permiso; en Safari las colocas tú).

**App de Windows** (`desktop/`, Electron): el Blackbox va dentro de la app (servido desde `app://local`, funciona sin conexión salvo el mapa y la nube, con sus propios datos), coloca cada ventana en su pantalla y **recuerda dónde dejas cada una** (`ventanas.json` en los datos de la app). Menú Ventanas con atajos (Ctrl+1/2/3, Ctrl+Mayús+R para repartir). Se actualiza sola desde las Releases de GitHub.

```bash
cd desktop && npm install
npm start               # probarla en el Mac
npm run build:win       # .exe de instalación y portable en desktop/dist (sin icono propio desde el Mac)
```

Las versiones oficiales las construye `.github/workflows/escritorio.yml` en Windows al subir una etiqueta `v*` con la versión de `desktop/package.json` (`v2.0.0`) y las publica en Releases (instalador y portable, con nombres fijos para que el botón **WINDOWS** del Blackbox web baje siempre la última). No está firmada: la primera vez Windows avisa («Más información → Ejecutar de todas formas»).

## Gestos

Como en una app del iPhone (`src/ui/gestures.js`): **deslizar desde el borde izquierdo** vuelve atrás (cierra la ventana abierta, sale del apartado del Garaje o del editor del DASH, o vuelve al DASH desde otra pestaña; en marcha no se sale de una pestaña) y **deslizar hacia abajo** cierra ventanas y hojas. Lo que se cierra sigue al dedo. Las pestañas, los apartados y las ventanas entran con una transición corta y los botones se ven pulsados al momento.

## Voz

La app habla por el intercomunicador con **audios propios** grabados con Piper (voz CC0), que dejan sonar la música a la vez; la voz del sistema del iPhone la paraba. Se puede volver a la del móvil en Garaje → Voz. Cómo funciona y cómo regenerarla: [`docs/voz.md`](docs/voz.md).

## Versión y actualizaciones

Garaje → **Versión** enseña el commit y la fecha de la versión abierta, busca actualizaciones y da las medidas de la pantalla (para depurar cómo encaja). La app instalada se actualiza sola al volver a ella con la moto parada (`src/core/update.js`).

## Si la app no arranca

`index.html` lleva un **modo rescate** aparte del código de la app: si esta no llega a arrancar, enseña el error y deja buscar una versión nueva, reintentar o exportar los datos del móvil (ajustes, pasadas, duelos y la caja negra) en un `.json` que el Blackbox importa. No hay que borrar la app de la pantalla de inicio: en iPhone eso borra sus datos.

## Publicar

`.github/workflows/publicar.yml` construye y publica en GitHub Pages con cada push a `main`. Para el modo online, añade `VITE_SUPABASE_URL` y `VITE_SUPABASE_KEY` como secretos del repositorio.

## Seguridad

Las carreras, en circuito o pista cerrada. La app se arma y cronometra sola para no tener que tocar el móvil en marcha.

## Créditos

Fuentes: Press Start 2P y VT323 (OFL, vía Fontsource) y DSEG7 de Keshikan (OFL, `public/fonts/DSEG-LICENSE.txt`). Pixel art y sonidos (WebAudio) hechos para la app.

Iconos: se diseñan en Figma (archivo «Street Chaos · Iconos»: componente «Icono app» de 64×64 a 8 px por píxel y componentes «Pestaña/…» de 16×16). El icono de la app se exporta a `public/icons/` (512, 192) y `public/favicon.png` (64); los de la barra a `src/icons/` como SVG con `currentColor`.
