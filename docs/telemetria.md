# Telemetría de Street Chaos (caja negra)

La app graba sola, en el móvil, el GPS y los sensores de cada salida en moto. No enseña nada de esto en pantalla: es la materia prima para la futura app de escritorio de análisis. Este documento es el contrato entre las dos.

Código: `src/core/blackbox.js` (grabación y formato) y `src/core/logger.js` (lo conecta con la app). Exportación: `buildExport()` en `src/core/share.js`. El analizador que lo lee está en `/blackbox` (`src/blackbox/`, ver el README).

## Cómo se graba

- **Sesión** = una salida. Empieza sola cuando el GPS marca ≥ 2,5 m/s (9 km/h) con precisión ≤ 30 m, y se queda con los **30 s anteriores**, así la salida desde parado entra entera.
- Termina tras **3 minutos parado** (< 1 m/s) **o sin datos** (pantalla apagada, app cerrada). La siguiente vez que te muevas empieza otra.
- Se escribe en IndexedDB (`sc-telemetria`) **cada 5 s**. Si la app se cierra o se recarga a mitad, al abrirla la sesión **sigue con el mismo id** si han pasado menos de 3 minutos (`resumed` cuenta cuántas veces) y con un evento `resume`. Si no, se cierra.
- Se apaga en Garaje → Ajustes → Telemetría. Cambiar la fuente de GPS (real/simulador) cierra la sesión: cada sesión tiene una sola `source`.
- En segundo plano el móvil corta el GPS y los sensores: quedan huecos (eventos `hidden` y `visible`).

## Archivo exportado

Garaje → Datos → **EXPORTAR** genera `streetchaos-AAAA-MM-DD-HHMM.json` con todo lo del móvil:

```jsonc
{
  "app": "streetchaos", "format": "streetchaos-export", "version": 1,
  "id": "…",                 // id del móvil (el mismo en todas las exportaciones)
  "exportedAt": "2026-11-09T10:00:00.000Z",
  "device": { "ua": "…", "screen": [w, h, dpr], "viewport": [w, h] },
  "settings": { "units", "rollout", "source", "bike", "mount", "leanSign", "gyroAxes", "gpsLag" },
  "totals": { "odo", "maxV", "maxLeanL", "maxLeanR", "maxG" },
  "runs": [ … ],             // pasadas del crono, como las guarda la app (con traza y muestras GPS en bruto)
  "races": [ … ],            // duelos
  "telemetry": {
    "format": 1,
    "streams": { "gps": { "type": "float64", "fields": [...] }, "imu": {...}, "calc": {...} },
    "sessions": [ { …ficha…, "events": [...], "gps": "<base64>", "imu": "<base64>", "calc": "<base64>" } ]
  }
}
```

Se exporta todo cada vez: la app de escritorio debe deduplicar por `id` de sesión (una sesión `rec` puede reaparecer más larga en la siguiente exportación).

### Ficha de cada sesión

| Campo | Qué es |
| --- | --- |
| `id` | Identificador único |
| `format` | Versión del formato de los flujos (ahora 1) |
| `state` | `done` cerrada, `rec` aún grabando al exportar |
| `start`, `end` | Hora real (ms desde 1970) de `t = 0` y de la última muestra |
| `source` | `real` o `sim` (simulador; `sim` lleva `{hz, bike}`) |
| `calib` | Calibración de la app al empezar (ver abajo). Las sesiones de antes del 2026-11-09 traen `leanZero` y `gyroSign`, que ya no se usan |
| `rider` | Moto y unidades del piloto |
| `device` | Navegador (`ua`), pantalla, orientación al empezar, si estaba instalada |
| `rows` | Filas de cada flujo y número de eventos |
| `dist`, `moving`, `vmax` | Metros, segundos en marcha y m/s máximos (resumen rápido) |
| `imuInterval` | Intervalo que declara el navegador para los sensores, tal cual. **Ojo**: el iPhone lo da en **segundos** (0,0167); el estándar dice milisegundos |
| `resumed` | Veces que siguió tras cerrarse la app |

`calib` (desde el 2026-11-09, `calibration()` en `src/core/telemetry.js`):

| Campo | Qué es |
| --- | --- |
| `conv` | +1 si el móvil da la gravedad hacia arriba (estándar), −1 si hacia abajo (iPhone) |
| `axes` | Asignación del giroscopio: `w3c` (alpha = z, beta = x, gamma = y) o `xyz` (iPhone: alpha = x, beta = y, gamma = z) |
| `yawSign`, `leanSign` | Signos aprendidos con los giros del GPS (giro sobre la vertical e inclinación) |
| `gpsLag` | Segundos de retraso del GPS que la app ya ha descontado en `t` (1 en iPhone, 0 en el resto) |
| `up`, `right`, `fwd` | Postura del móvil en el soporte (vectores unitarios en ejes del móvil, sentido físico): vertical de la moto, lateral (+ derecha) y avance; `fwd` es `null` hasta que lo aprende acelerando y frenando |
| `sys` | Si el navegador da la aceleración sin gravedad (y por tanto su gravedad, que es con la que se mide la inclinación) |

### Flujos

Cada flujo es un array de números en **base64**, **little-endian**, fila tras fila (`fields.length` números por fila). `NaN` = el móvil no dio ese dato. `t` siempre son **segundos desde `start`**, con un reloj monótono (no salta si cambia la hora del móvil).

**`gps`** (`float64`, una fila por fix, ~1 Hz en móviles):

| Campo | Unidad | Qué es |
| --- | --- | --- |
| `t` | s | Hora del fix: la de llegada, menos la antigüedad que declara el móvil, menos el retraso del GPS (`calib.gpsLag`, desde el 2026-11-09). Las posiciones viejas que llegan al volver de segundo plano se descartan |
| `ts` | ms desde 1970 | Hora del fix según el móvil |
| `lat`, `lon` | grados WGS84 | Posición |
| `acc` | m | Precisión horizontal |
| `alt`, `altAcc` | m | Altitud y su precisión (`NaN` si no hay) |
| `speed`, `heading` | m/s, ° desde el norte | Lo que da el móvil, sin tocar |
| `v`, `hdg` | m/s, ° | Lo que usó la app. Si el móvil no da velocidad (el iPhone, parado o muy despacio, ~1 de cada 6 fixes), desde el 2026-11-09 `v` es la última un momento (si ibas a más de 3 m/s) o 0, nunca la de las posiciones; antes salía de las posiciones y con 15-25 m de error daba saltos falsos de hasta 130 km/h. Si no da rumbo, del rumbo entre fixes |

**`imu`** (`float32`, cada evento `devicemotion`: 60 Hz en iPhone, 60-200 Hz en Android):

| Campo | Unidad | Qué es |
| --- | --- | --- |
| `t` | s | Hora del evento |
| `ax`, `ay`, `az` | m/s² | Aceleración **con** gravedad (`accelerationIncludingGravity`) |
| `lx`, `ly`, `lz` | m/s² | Aceleración **sin** gravedad (`acceleration`), si el navegador la da |
| `ra`, `rb`, `rg` | °/s | Giro (`rotationRate`) tal cual: `alpha`, `beta`, `gamma`. El estándar dice alpha sobre z, beta sobre x y gamma sobre y; **Safari en iPhone da alpha sobre x, beta sobre y y gamma sobre z** (comprobado con la primera salida real: con los ejes del estándar el giroscopio y los giros del GPS apenas se parecían) |

Ejes del móvil (W3C): x hacia la derecha de la pantalla, y hacia arriba de la pantalla, z saliendo de la pantalla, fijos al aparato aunque gire la pantalla. Manías vistas: el iPhone da la gravedad **hacia abajo** (−9,8 en el eje que mira al cielo; el estándar, +9,8) y los ejes del giroscopio cambiados como arriba. `ax − lx` (y lo mismo en y, z) es la gravedad que calcula el propio móvil combinando acelerómetro y giroscopio: con ella la inclinación sale directa (giro de la vertical alrededor del eje de avance). La postura del móvil en el soporte va en `calib`; si no, se saca de la gravedad media en recta.

El GPS del iPhone llega **~1 s tarde** respecto a los sensores (las sesiones nuevas ya lo traen descontado en `t`; el Blackbox lo mide en cada sesión y lo enseña).

**`calc`** (`float32`, 10 Hz): lo que calculaba y enseñaba la app en ese momento, para comparar sus algoritmos con los del escritorio.

| Campo | Unidad | Qué es |
| --- | --- | --- |
| `t` | s | |
| `v` | m/s | Velocidad suavizada del velocímetro |
| `gLong` | g | Longitudinal (+ acelera, − frena): del acelerómetro cuando ya sabe dónde es delante; si no, de la velocidad del GPS |
| `gLat` | g | Lateral (+ curva a derecha): tan(inclinación), solo en marcha |
| `lean` | ° | Inclinación (+ derecha). Antes del 2026-11-09, en iPhone estaba mal (ejes del giroscopio cambiados): picos de 70° donde había 35° |

### Eventos

`events` es una lista de `{ type, t, …datos }` (con `t` en segundos desde `start`):

| `type` | Datos |
| --- | --- |
| `launch` | Salida detectada por el crono |
| `run` | Pasada válida: `id` (la de `runs`), `marks` (parcial → segundos), `maxV` (m/s). `t` es el instante de salida |
| `abort` | Pasada cancelada con un toque |
| `race` | Duelo terminado: `mode`, `opp` (`cpu`, `ghost` u `online`), `win`, `me`, `them` |
| `calib` | Cambió la calibración: `mount` (postura), `leanSign`, `gyroAxes`, `yawSign` o `gpsLag` (antes `leanZero` o `gyroSign`) |
| `hidden`, `visible` | La app pasó a segundo plano o volvió |
| `orientation` | El móvil giró la pantalla (`type`) |
| `resume` | Siguió tras cerrarse la app (`gap` en s) |

## Archivo de la nube (`.scb`)

Lo que sube el móvil (una sesión por archivo, comprimido con gzip si el navegador sabe; `packSession`/`unpackSession` en `src/core/blackbox.js`):

| Bytes | Qué es |
| --- | --- |
| 0-3 | `SCB1` |
| 4-7 | Longitud H de la cabecera (uint32 little-endian) |
| 8 … 8+H | Cabecera JSON en UTF-8, rellena con espacios hasta múltiplo de 8: `format`, `streams`, `meta`, `events`, `bytes` {gps, imu, calc}, y `device`, `rider`, `bike` |
| luego | Los bytes de `gps`, `imu` y `calc`, seguidos y tal cual (el mismo formato de flujos que arriba) |

Se guarda en el almacén privado `telemetry` como `<huella de la clave>/<id>.scb`, y su ficha en `bb_cloud`. Para leerlo desde fuera del Blackbox hace falta la clave del móvil y la función `caja-negra` (`action: 'list'` y `'get'`).

## Leerlo en Python

```python
import base64, json
import numpy as np
import pandas as pd

d = json.load(open('streetchaos-2026-11-09-1000.json'))
streams = d['telemetry']['streams']

def stream(session, name):
    spec = streams[name]
    dtype = '<f8' if spec['type'] == 'float64' else '<f4'
    raw = np.frombuffer(base64.b64decode(session[name]), dtype=dtype)
    return pd.DataFrame(raw.reshape(-1, len(spec['fields'])), columns=spec['fields'])

for s in d['telemetry']['sessions']:
    gps, imu, calc = (stream(s, k) for k in ('gps', 'imu', 'calc'))
    t0 = pd.to_datetime(s['start'], unit='ms')
    print(s['id'], t0, len(gps), 'fixes', len(imu), 'muestras IMU', round(s['dist'] / 1000, 1), 'km')
```

## Tamaño

Con sensores a 60 Hz: unos **2,4 KB/s, ~9 MB por hora** en el móvil y ~12 MB por hora en el archivo (base64). El GPS y `calc` son poco al lado. Garaje → Datos dice cuánto ocupa y cuánto queda libre.

## Si cambias el formato

Sube `FORMAT` en `blackbox.js`, actualiza este documento y que la app de escritorio lea las dos versiones. Añadir columnas al final de un flujo o eventos nuevos también es un cambio de formato.
