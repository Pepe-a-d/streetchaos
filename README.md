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

- **DASH**: velocidad grande en LCD de 7 segmentos, barra de velocidad, punta, viaje, tiempo, media, altitud, rumbo, cuentakilómetros total, inclinación (con máximos izquierda/derecha) y círculo de fuerza G.
- **CRONO**: se arma solo al parar la moto y cronometra al salir. Una pasada mide a la vez 0-50/100/150/200, 100-200, 60 ft, 330 ft, 1/8 de milla, 1000 ft y 1/4 de milla con velocidad de trampa. Rollout de 1 pie opcional. Récords y ticket de cada pasada.
- **VS**: radar de pilotos cercanos (radio 0,5 / 1,5 / 3 km), retos a 1/8, 1/4 o 0-100, y duelos contra la CPU (4 clases de moto inventadas) o contra tu fantasma (tu mejor pasada).
- **GARAJE**: tu piloto (nombre, moto, color), récords, duelos ganados/perdidos, historial y ajustes.

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
- **Exportar**: un `.json` con la telemetría, las pasadas y los duelos, para pasarlo al ordenador (AirDrop, Drive, correo).
- **Enviar para análisis**: solo las pasadas y los duelos, sin posición ni telemetría, a la tabla `analysis_uploads` de Supabase (ver `supabase/migrations/`: la app solo puede insertar, nadie puede leerlos con la clave pública). Cada pasada lleva los parciales, la traza desde la salida y las muestras GPS en bruto (tiempo, velocidad, precisión y altitud).
- **Borrar** la telemetría (para liberar espacio después de exportarla) o el historial.

## Publicar

`.github/workflows/publicar.yml` construye y publica en GitHub Pages con cada push a `main`. Para el modo online, añade `VITE_SUPABASE_URL` y `VITE_SUPABASE_KEY` como secretos del repositorio.

## Seguridad

Las carreras, en circuito o pista cerrada. La app se arma y cronometra sola para no tener que tocar el móvil en marcha.

## Créditos

Fuentes: Press Start 2P y VT323 (OFL, vía Fontsource) y DSEG7 de Keshikan (OFL, `public/fonts/DSEG-LICENSE.txt`). Pixel art y sonidos (WebAudio) hechos para la app.

Iconos: se diseñan en Figma (archivo «Street Chaos · Iconos»: componente «Icono app» de 64×64 a 8 px por píxel y componentes «Pestaña/…» de 16×16). El icono de la app se exporta a `public/icons/` (512, 192) y `public/favicon.png` (64); los de la barra a `src/icons/` como SVG con `currentColor`.
