# Street Chaos

Web app (PWA) para llevar en la moto: dashboard por GPS, cronómetro de aceleración y *drag races* contra otros pilotos que tengan la app abierta cerca. Estética de arcade de carreras retro. Funciona en vertical y en horizontal.

## Arrancar

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests del cronometraje, la telemetría y la caja negra
npm run build      # versión de producción en dist/
```

En el móvil: el GPS y los sensores solo funcionan con HTTPS. `npm run dev:movil` sirve la app con un certificado autofirmado en la red local (abre la URL `https://<ip-del-mac>:5173` y acepta el aviso).

Sin moverte: **Garaje → Fuente GPS → Simulador**. Aparecen los mandos GAS / FRENO / ◀ ▶ (también flechas o WASD).

## Pantallas

- **DASH**: varias pantallas que se pasan deslizando (de fábrica CARRETERA, CIRCUITO y MINIMA), hechas con bloques: velocímetro, inclinómetro, círculo G, inclinación y G en número con barra, hora, brújula, gráficas de velocidad (1 min) y de altitud (10 min), viaje, tiempo, media, punta, máximos, altitud, rumbo, total, récords, última pasada, GPS y caja negra. **EDITAR** (abajo a la derecha) deja añadir bloques desde un catálogo con vista previa en vivo, tocar uno para cambiar su medida o quitarlo, arrastrarlo para moverlo, y en PANTALLAS renombrar, ordenar, borrar o crear pantallas desde plantillas (también VIAJE). La rejilla es de 6×8 casillas en vertical y 12×4 en horizontal; los bloques se colocan solos en orden (`src/ui/dash.js`, `src/ui/widgets.js`) y el editor avisa si algo no cabe en una orientación.
- **Apariencia** (Garaje): temas de color para toda la app (SYNTHWAVE, LCD VERDE, AMBAR, TOKIO, CARRERAS, OCASO y SOL, claro y sin sombras para leer a pleno sol), números del DASH en LCD, PIXEL o LIMPIO, el color de tu moto como acento y el efecto CRT (`src/ui/themes.js`: cada tema redefine las variables de color de `style.css`).
- **CRONO**: se arma solo al parar la moto y cronometra al salir. Una pasada mide a la vez 0-50/100/150/200, 100-200, 60 ft, 330 ft, 1/8 de milla, 1000 ft y 1/4 de milla con velocidad de trampa. Rollout de 1 pie opcional. Récords y ticket de cada pasada.
- **VS**: radar de pilotos cercanos (radio 0,5 / 1,5 / 3 km), retos a 1/8, 1/4 o 0-100, y duelos contra la CPU (4 clases de moto inventadas) o contra tu fantasma (tu mejor pasada).
- **GARAJE**: tu piloto (nombre, moto, color), récords, duelos ganados/perdidos, historial y ajustes.
- **Pantalla negra** (la luna de la barra de arriba): todo en negro con solo un punto «REC» tenue que cambia de sitio. La app sigue en primer plano y graba igual (GPS, sensores, crono, caja negra), gasta poca batería en pantallas OLED, deja de dibujar lo de debajo e ignora los toques; se sale manteniendo pulsado 1,6 s. Es lo más parecido a «segundo plano» que permite una web: con el móvil bloqueado o con otra app delante, el navegador congela la app.

## Cómo se cronometra

Los móviles dan GPS a ~1 Hz, así que el motor (`src/core/perf.js`) no espera a "la muestra que pasa de 100":

- interpola la velocidad entre muestras y resuelve el cruce exacto de cada velocidad;
- integra la distancia con esa misma curva y resuelve el cruce de cada distancia (ecuación de segundo grado);
- extrapola el instante de salida con la aceleración de las dos primeras muestras, o con el tirón del acelerómetro si lo hay.

Con una moto simulada muestreada a 1 Hz con ruido, el error peor ronda **0,08 s** en 0-100, 1/8 y 1/4 (`npm test`). Con un GPS externo de 10 Hz mejoraría, pero no hace falta para jugar.

La inclinación sale de la física del giro: `sen(ángulo) = velocidad × giro / g`, con el giroscopio (su signo se alinea solo con el rumbo del GPS) o con el rumbo del GPS si no hay giroscopio. Parado usa la gravedad. «Poner a 0» en Garaje calibra con la moto recta.

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
- **Subir a la nube** y **Abrir en el ordenador**: ver «Blackbox» más abajo.
- **Exportar**: un `.json` con la telemetría, las pasadas y los duelos, para pasarlo al ordenador (AirDrop, Drive, correo).
- **Enviar para análisis**: solo las pasadas y los duelos, sin posición ni telemetría, a la tabla `analysis_uploads` de Supabase (ver `supabase/migrations/`: la app solo puede insertar, nadie puede leerlos con la clave pública). Cada pasada lleva los parciales, la traza desde la salida y las muestras GPS en bruto (tiempo, velocidad, precisión y altitud).
- **Borrar** la telemetría (para liberar espacio después de exportarla) o el historial.

## Blackbox: el analizador

En **`/blackbox`** (https://pepe-a-d.github.io/streetchaos/blackbox/) hay un analizador para el ordenador. Sueltas el `.json` exportado y se queda guardado en ese navegador. Para cada salida:

- **Mapa** con la traza coloreada por velocidad, inclinación, G longitudinal, G lateral o altitud, y las curvas numeradas.
- **Gráficas apiladas** (velocidad, inclinación, G, altitud, giro, vibración, precisión del GPS) con el cursor sincronizado con el mapa, eje de tiempo o distancia, zoom arrastrando y una tira de vista general. Se puede superponer lo que calculó el móvil en marcha.
- **Pestañas**: estadísticas del tramo elegido, diagrama G-G con su envolvente e histograma de inclinación, curvas (inclinación y velocidades de entrada, mínima y salida), frenadas, pasadas del crono y calidad de los datos.
- **CSV** con los canales a 10 Hz.
- **Comparar**: eliges un tramo, busca otras pasadas por él (vueltas de la misma salida u otras salidas) y las alinea por distancia: diferencia de tiempo metro a metro, velocidad, inclinación y G de las dos, y en el mapa la otra en verde donde gana y en rojo donde pierde. Las pasadas del crono se comparan desde la salida.
- **Tramos**: guardas un tramo y se cronometra solo en todas tus salidas (en un circuito cerrado cuenta vueltas). Los tramos marcados como circuito cerrado se pueden compartir y tienen clasificación entre pilotos; los de carretera abierta se quedan en tu navegador, solo con tus tiempos.
- **Potencia** (banco virtual): con la masa de moto y piloto y la aerodinámica, cada tirón a fondo da una curva de potencia en rueda frente a la velocidad. Es una estimación para comparar antes y después de tocar la moto.

**Nube**: el móvil sube solo cada salida al terminarla (Garaje → Datos → Subir a la nube; se puede apagar) a un almacén privado de Supabase. Solo la lee quien tenga la clave de sincronización de ese móvil: **Garaje → Datos → Abrir en el ordenador** comparte un enlace al Blackbox con la clave (tras `#`, no llega a ningún servidor) y el Blackbox baja solo lo nuevo. La función `supabase/functions/caja-negra` reparte URLs firmadas de subida y bajada y guarda cada móvil en la carpeta de la huella de su clave; la tabla `bb_cloud` no se puede leer con la clave pública. Unos 6-9 MB por hora de moto; el plan gratis de Supabase da 1 GB.

Comparar y tramos usan `src/blackbox/align.js` (proyecta una salida sobre el trazado de otra con una rejilla, encuentra las pasadas de principio a fin en el mismo sentido y las alinea por la distancia que recorre cada moto); la potencia, `src/blackbox/dyno.js`.

El análisis (`src/blackbox/process.js`) es offline y por eso más fino que el del móvil: traza la curva entre fixes de GPS con un spline que respeta su rumbo y velocidad, saca la postura del móvil en el soporte (arriba = gravedad media, adelante = la dirección del acelerómetro que mejor explica lo que acelera el GPS), da la G longitudinal del acelerómetro calibrado, y la inclinación de `sen φ = v·giro/g` fusionada con el giro de alabeo del giroscopio, sin retraso. `src/blackbox/synth.js` inventa salidas con física y ruido realistas para probarlo (`tests/analysis.test.js`: error medio de inclinación < 2,5°) y para la demo (`node scripts/demo-telemetry.mjs` → `public/demo/`).

No se guarda para usar sin conexión: la app del móvil (PWA) deja fuera sus archivos (`bb-*`).

## Publicar

`.github/workflows/publicar.yml` construye y publica en GitHub Pages con cada push a `main`. Para el modo online, añade `VITE_SUPABASE_URL` y `VITE_SUPABASE_KEY` como secretos del repositorio.

## Seguridad

Las carreras, en circuito o pista cerrada. La app se arma y cronometra sola para no tener que tocar el móvil en marcha.

## Créditos

Fuentes: Press Start 2P y VT323 (OFL, vía Fontsource) y DSEG7 de Keshikan (OFL, `public/fonts/DSEG-LICENSE.txt`). Pixel art y sonidos (WebAudio) hechos para la app.

Iconos: se diseñan en Figma (archivo «Street Chaos · Iconos»: componente «Icono app» de 64×64 a 8 px por píxel y componentes «Pestaña/…» de 16×16). El icono de la app se exporta a `public/icons/` (512, 192) y `public/favicon.png` (64); los de la barra a `src/icons/` como SVG con `currentColor`.
