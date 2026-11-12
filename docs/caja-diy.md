# Caja DIY de Street Chaos: plan de desarrollo (fases 1, 2 y 4)

Plan para fabricar nuestra propia «RaceBox»: una caja que va fija en la moto, graba GPS y sensores mucho mejor que el iPhone y entrega las salidas al Blackbox como si vinieran del móvil. Este documento es el punto de partida para retomarlo: qué se construye, cómo encaja con lo que ya hay, en qué orden, cuánto cuesta y qué falta decidir.

Escrito el 2026-11-10. **Nada de esto está construido ni comprado todavía.** Las fases 3 (temperaturas medidas) y 5 (chasis) quedan fuera por ahora; ver [Qué no entra](#qué-no-entra-por-ahora).

**El prototipo concreto ya está diseñado** en [hardware/caja/](../hardware/caja/README.md):
- [piezas](../hardware/caja/piezas.md): las piezas exactas con referencias, tiendas y precios;
- [conexiones](../hardware/caja/conexiones.md): cómo se conecta todo;
- [montaje](../hardware/caja/montaje.md): el paso a paso, la instalación en la Ninja 125 incluida;
- [esquemas](../hardware/caja/esquemas/): los dibujos.

Las [decisiones pendientes](#8-decisiones-tomadas) están cerradas.

## Índice

1. [Por qué una caja propia](#1-por-qué-una-caja-propia)
2. [Cómo encaja con lo que ya hay](#2-cómo-encaja-con-lo-que-ya-hay)
3. [Fase 1: la caja](#3-fase-1-la-caja)
4. [Fase 2: datos de la moto](#4-fase-2-datos-de-la-moto)
5. [Fase 4: pantalla y luces](#5-fase-4-pantalla-y-luces)
6. [Hitos, en orden](#6-hitos-en-orden)
7. [Presupuesto](#7-presupuesto)
8. [Decisiones tomadas](#8-decisiones-tomadas)
9. [Riesgos y cosas a vigilar](#9-riesgos-y-cosas-a-vigilar)
10. [Qué no entra (por ahora)](#qué-no-entra-por-ahora)
11. [Lo que ya hay en el repo y se reutiliza](#11-lo-que-ya-hay-en-el-repo-y-se-reutiliza)

---

## 1. Por qué una caja propia

Lo que vimos analizando las salidas reales con el iPhone:

| Límite del iPhone | Qué pasa | Con la caja |
| --- | --- | --- |
| GPS a ~1 Hz | El crono 0-100 y las curvas tienen poca resolución | 10-25 posiciones por segundo |
| GPS ~1 s tarde respecto a los sensores | Hay que estimar y descontar el retraso | El GPS marca la hora exacta de cada medida (y con la señal PPS, al microsegundo) |
| ~1 de cada 6 posiciones sin velocidad Doppler | La velocidad se queda «congelada» o a 0 | El receptor da velocidad Doppler siempre |
| El móvil va en el soporte del manillar, con amortiguador | Gira con la dirección y se mueve: la inclinación y las G llevan ruido | Sensores atornillados al chasis |
| Safari no deja usar Bluetooth | No se puede conectar nada a la app en directo | La caja graba sola; en directo, su propia pantalla (fase 4) |
| Hay que acordarse de abrir la app | Salidas perdidas o a medias | Arranca y para sola con el contacto |

Además, con la fase 2 la caja sabe cosas que el móvil no puede saber: cuándo tocas el freno, las revoluciones y la marcha.

---

## 2. Cómo encaja con lo que ya hay

La idea clave: **la caja graba en el mismo formato que la caja negra del móvil** (`docs/telemetria.md`: flujos `gps`, `imu` y `calc`, eventos y ficha, empaquetados en un `.scb`). Así el Blackbox la analiza con todo lo que ya tiene (curvas, frenadas, pasadas, potencia, tramos, comparar, vídeo, neumáticos) sin rehacer nada.

```
                         ┌─────────────────────────────┐
  Antena GPS ──────────► │  CAJA (atornillada al chasis)│
  Sensor de movimiento ─►│  ESP32-S3 + microSD          │
  Freno, RPM (fase 2) ──►│                              │
  12 V con contacto ────►│                              │
                         └──────┬───────────┬──────────┘
                    radio       │           │  por el móvil
                 (ESP-NOW)      │           │  (aparcada)
                                ▼           ▼
                 ┌───────────────────┐   ┌──────────────────────────────┐
                 │ PANTALLA (fase 4) │   │ Nube: función «caja-negra»   │
                 │ en el manillar    │   │ (put/commit con tu clave)    │
                 │ + LEDs + botones  │   └──────────────┬───────────────┘
                 └───────────────────┘                  │
                                                        ▼
            microSD → arrastrar el .scb ──────►  BLACKBOX (web y escritorio)
```

Tres formas de que una salida llegue al Blackbox:

El WiFi de casa no llega a donde aparca la moto, así que las salidas pasan por el móvil. Al quitar el contacto, si hay salidas sin pasar, la caja espera al móvil hasta 10 minutos. Mientras espera, hace las dos cosas a la vez: busca el Compartir Internet del iPhone y levanta su propia red. Luego se apaga. Lo que no se pase espera a la próxima vez; también se puede dar el contacto un momento para encenderla otra vez.

1. **Sola, por el Compartir Internet del iPhone** (la buena):
   - al aparcar, abres Ajustes → Compartir Internet. Tiene que estar puesto «Maximizar compatibilidad», porque la caja solo usa 2,4 GHz;
   - la caja se conecta, sube las salidas nuevas a la nube con la clave de sincronización de tu móvil y se apaga;
   - aparecen en el Blackbox igual que las del iPhone;
   - gasta datos del móvil: unos 23 MB por hora de salida, menos comprimido.
2. **Por la red de la caja, sin internet**:
   - conectas el móvil a «StreetChaos-Caja», abres su página en Safari y bajas las salidas nuevas en un solo archivo;
   - luego, ya con internet, en la app: Garaje → Datos → SUBIR SALIDAS DE LA CAJA. La app las guarda en su caja negra y las sube como las suyas.
   - Una página https (la app) no puede hablar directamente con la caja, que es http y está en la red local (contenido mixto): por eso hay un archivo de por medio.
3. **Tarjeta microSD**: solo si abres la caja, que va cerrada bajo el asiento. Se sueltan los `.scb` en el Blackbox.

**En el prototipo simple** (el primero que se monta) solo están el camino 2 y la microSD: ni Compartir Internet, ni nube, ni vinculación. Lo que baja de la página de la caja es un `.zip` con un `.scb` por salida, que se abre en el Blackbox o con SUBIR SALIDAS DE LA CAJA ([apartado 3.4](#34-firmware-lo-escribo-yo)).

**La app del iPhone no ve la caja en directo**: Safari no deja usar Bluetooth, y una página https no puede hablar con un aparato de la red local (contenido mixto). Lo que se quiera ver en marcha va en la pantalla de la fase 4. Si algún día hacemos la app nativa de iPhone (cuenta de desarrollador de Apple, 99 €/año), se podría conectar por Bluetooth.

---

## 3. Fase 1: la caja

### 3.1 Qué hace

- Graba GPS a 10-25 Hz y sensores de movimiento a 100 Hz en la microSD.
- Empieza sola al moverte y para sola, con **las mismas reglas que la caja negra del móvil** (`RULES` en `src/core/blackbox.js`: 3 posiciones a más de 9 km/h y 40 m recorridos, guarda los 30 s anteriores, se cierra tras 3 min parado, se borra si no llegó a 100 m). Si va conectada al contacto, además arranca y cierra con la llave (evento `ignition`).
- Sobrevive a cortes de corriente sin perder la salida.
- Al aparcar, pasa las salidas a la nube por el móvil ([apartado 2](#2-cómo-encaja-con-lo-que-ya-hay)).

### 3.2 Piezas

Elegidas el 2026-11-10. La lista completa, con referencias, tiendas y precios, está en [hardware/caja/piezas.md](../hardware/caja/piezas.md).

| Pieza | Elegida | Precio |
| --- | --- | --- |
| Placa | **SparkFun Thing Plus ESP32-S3** (WRL-24408): microSD, medidor de batería y Qwiic integrados | 30 € |
| GPS | **u-blox NEO-M9N** (SparkFun GPS-17285): 25 Hz con GPS, Galileo y GLONASS, PPS, alimenta la antena | 82 € |
| Antena | Activa, magnética, 3 m, SMA (SparkFun GPS-14986), con pasamuros SMA estanco y latiguillo | 45 € |
| Sensor de movimiento | **ISM330DHCX** (Adafruit 4502): 6 ejes de ST, FIFO de 9 KB | 21 € |
| microSD | SanDisk High Endurance 32 GB (o Kingston Industrial) | ≈ 12 € |
| Alimentación | **Sin batería**: 12 V permanente con fusible de 2 A, TVS 1.5KE22A, interruptor electrónico Pololu 2809 (lo enciende el contacto y lo apaga la caja) y regulador Pololu D36V28F5 a 5 V | 45 € |
| Entradas | Optoacopladores PC817 (contacto y freno) y 74HC14 (revoluciones), en una placa perforada | 5 € |
| Caja | **Hammond 1555F2F42GY** (IP68, tapa con pestañas para sujetarla), 3 prensaestopas PG7 (el tercero, para el cable de la pantalla) y membrana de ventilación | 38 € |

Los cambios respecto a la primera idea:
- **El NEO-M9N en vez del M10:** 25 Hz con todos los satélites.
- **Sin batería en la caja:** una LiPo bajo el asiento sufre con el calor, y con el interruptor la caja puede subir las salidas con la moto apagada sin gastar nada después.
- **Caja comprada en vez de impresa:** la Hammond es estanca y aguanta el calor. La impresora 3D se usa para el soporte de la caja (sin taladrar la moto), las plantillas y, en la fase 4, la carcasa de la pantalla ([hardware/caja/impresion.md](../hardware/caja/impresion.md)).
- **Sin el sensor del aire (BME280):** queda para más adelante.

**Por qué no un sensor que calcule la orientación solo**: en una curva bien trazada la fuerza centrífuga y la gravedad se suman justo hacia «abajo» de la moto, y el acelerómetro cree que vas recto. La inclinación buena sale del giroscopio corregido con el GPS (inclinación ≈ atan(velocidad × giro / g)), que es lo que ya hace el Blackbox (`leanFrom: 'gyro'` y `'gyro+roll'` en `src/blackbox/process.js`). Por eso basta con un sensor «en bruto» y el análisis lo pone el Blackbox.

**La señal PPS del GPS** (un pulso exacto cada segundo) va a una patilla de la placa: con ella la hora de cada medida del sensor de movimiento cuadra con el GPS al microsegundo, y se acabó el «retraso del GPS» del iPhone.

### 3.3 Montaje en la moto

- **La caja, bien firme y sin gomas**, lo más cerca posible del centro de la moto: las vibraciones se filtran por software, pero si la caja baila, la inclinación y las G salen mal. **En el manillar no**: gira con la dirección.
  - En la Ninja 125, bajo el asiento: el del pasajero si cabe, si no junto a la batería o en el colín. Se prueba antes con una maqueta de cartón.
  - La sujetan dos bridas por las pestañas, o tornillos si se taladra la bandeja. El 3M Dual Lock la asienta y quita holguras.
- **La antena del GPS mirando al cielo**, bajo plástico y a más de 20 cm de la caja: la radio de la placa mete ruido al GPS. Debajo de plástico (colín, asiento) no pasa nada; debajo de metal, del depósito o de ti, sí.
- **Alimentación**:
  - 12 V de la batería con fusible de 2 A junto al borne;
  - el contacto, de la luz de posición trasera;
  - el freno, de la luz de freno;
  - las dos con derivaciones Posi-Tap, sin cortar cables.
- Paso a paso en [montaje.md](../hardware/caja/montaje.md#5-instalación-en-la-ninja-125).

### 3.4 Firmware (lo escribo yo)

PlatformIO con Arduino-ESP32 (o ESP-IDF si hace falta afinar), en el repo bajo `hardware/caja/firmware/`. Tareas de FreeRTOS:

| Módulo | Qué hace |
| --- | --- |
| `gnss` | Configura el receptor por UBX (solo el mensaje NAV-PVT, a 10 o 25 Hz, UART a 230400 baudios, modelo dinámico de automoción o «moto» si lo tiene) y lo lee. Marca la hora con la PPS |
| `imu` | Lee el FIFO del sensor (833 Hz con su filtro paso bajo: el monocilíndrico vibra a ~170 Hz), lo baja a 100 Hz promediando y lo pasa a los ejes del formato |
| `recorder` | La máquina de estados de la sesión con las reglas del móvil: en espera → armando → grabando → cerrando. Calcula la ficha (distancia, en marcha, punta, `from`/`to`, paradas…) |
| `storage` | Mientras graba, añade cada flujo a su archivo dentro de una carpeta por sesión y guarda cada segundo. Al cerrar (o al arrancar, si se cortó la corriente) monta el `.scb` |
| `power` | Contacto (GPIO 6), tensión de la batería de la moto (GPIO 10) y apagado: cierra la salida; si quedan salidas por pasar, espera al móvil hasta 10 min (si no, se apaga en menos de 1 min); y da el pulso de `OFF` (GPIO 21) al interruptor, como mucho 15 min después de quitar el contacto. Las protecciones del apagado ([conexiones, apartado 7](../hardware/caja/conexiones.md#7-datos-para-el-firmware)) van en todos los firmwares desde el de H2, así el primero que se instala en la moto (H3) ya apaga la caja |
| `net` | Se conecta al Compartir Internet del iPhone (o a otra WiFi guardada). Vinculación con el código del móvil, subida a la nube y bajada de los tramos (para la fase 4) |
| `web` | Su propia red WiFi, a la vez que `net` busca la del móvil, con una página para: configurar (la red del móvil, vincular, opciones); ver el estado; bajar las salidas nuevas en un solo archivo, sin internet; y **TALLER**, los datos en directo (contacto, freno, revoluciones, batería de la moto, GPS y sensor) con la calibración de las revoluciones. La red está encendida siempre que la caja no graba y la moto está parada: con el contacto puesto antes de salir (se apaga en cuanto la moto se mueve) y mientras espera al móvil al aparcar. En marcha, apagada: no mete ruido al GPS |
| `config` | Ajustes guardados en la memoria de la placa (NVS), entre ellos la versión (`simple` o `completa`) y la contraseña de su red |

**Prototipo simple** ([conexiones, apartado 7](../hardware/caja/conexiones.md#7-datos-para-el-firmware)). Es el mismo firmware. La versión es un ajuste porque la caja no puede ver qué piezas lleva: de fábrica, `simple`; se cambia en la página de la caja, en AJUSTES, cuando se monte la completa. En la simple:
- **Freno, revoluciones y botón** (GPIO 7, 1 y 14): pull-up interna y no se leen. No hay eventos `brake` ni `mark`, y la PRUEBA DE LA CAJA dice «PROTOTIPO SIMPLE: SIN FRENO, REVOLUCIONES NI BOTON» en vez de dar FALLA.
- **Sin `net`, sin nube y sin vinculación.** El firmware no lleva ninguna clave, así que no hace falta el `secrets.h`.
- **La contraseña de «StreetChaos-Caja»** la crea la caja la primera vez que arranca (10 letras al azar, sin las que se confunden, con el generador de la placa) y la guarda en la NVS. No está en el repo ni en el binario, que es el mismo para todos. La PRUEBA DE LA CAJA la enseña para apuntarla; si se pierde, se vuelve a ver pasando la prueba otra vez por el USB.
- **La página**, en `http://192.168.4.1`:
  - las salidas nuevas, con la fecha y la hora (en la zona del móvil: la caja solo sabe la UTC), la duración y los km;
  - **BAJAR**: un solo `.zip`, sin comprimir, con un `.scb` por salida. Se escribe sobre la marcha, sin copiarlo antes. Una hora de salida (~23 MB) baja en unos 15-30 s;
  - una salida pasa a «bajada» cuando la caja ha mandado el archivo entero. Las bajadas siguen en ANTERIORES hasta que la microSD necesita sitio; entonces se borran primero las más viejas ya bajadas;
  - **APAGAR**: con el contacto quitado, el pulso de `OFF` en el momento; con el contacto puesto, apaga solo la WiFi hasta el próximo contacto;
  - sin DNS para fuera ni portal cautivo: la dirección se escribe o se guarda en favoritos.
- **La WiFi**, encendida:
  - con la moto parada y sin grabar;
  - al quitar el contacto, hasta 10 min si hay salidas sin bajar o un móvil conectado a la red. Si no hay nada, se apaga en menos de 1 min. Siempre dentro de las protecciones (15 min como mucho, 12,0 V);
  - siempre, con solo USB.
- **`calc` lleva solo la velocidad**; la G y la inclinación van a `NaN`. Así el Blackbox las calcula con la postura que aprende: si el aparato trae inclinación, el Blackbox la usa tal cual (`meta.logger` en `process.js`). La caja puede ir en cualquier postura, siempre que vaya firme.

Las pruebas del firmware van en el entorno `native` de PlatformIO (en el ordenador, sin placa): el lector de UBX, la máquina de estados con los mismos casos que las pruebas de la caja negra del móvil, y el `.scb`. Una prueba de vitest lee un `.scb` hecho por el firmware con `unpackSession` y lo analiza: si cambia algo del formato, salta.

### 3.5 Qué graba exactamente

El formato es el de `docs/telemetria.md` (FORMAT 1), así:

- **`gps`**: `t` (s desde el inicio, reloj de la placa corregido con la PPS), `ts` (hora UTC del GPS), `lat`, `lon`, `acc` (hAcc), `alt` (hMSL), `altAcc` (vAcc), `speed` y `v` (gSpeed, Doppler), `heading` y `hdg` (headMot).
- **`imu`** a 100 Hz: `ax, ay, az` con la gravedad en m/s² y sentido estándar (+9,8 en el eje que mira al cielo); `lx, ly, lz` = `NaN` (la placa no calcula la gravedad por su cuenta); `ra, rb, rg` en °/s con los ejes del estándar W3C (alpha sobre z, beta sobre x, gamma sobre y).
- **`calc`** a 10 Hz: velocidad, G e inclinación calculadas en la caja. En la fase 1 pueden ir sencillas; hacen falta de verdad para la pantalla (fase 4).
- **Ficha**: lo mismo que el móvil, más `calib: { conv: 1, axes: 'w3c', gpsLag: 0, sys: false }`, `device: { ua: 'StreetChaosCaja/x.y (ESP32-S3)' }` y `logger: { kind: 'caja', name: 'Caja DIY', hz }` para que la pestaña CALIDAD diga de dónde viene.
- **Eventos**: `ignition`, `resume` (tras un corte), y los de las fases 2 y 4.

El Blackbox aprende solo la postura de la caja (qué es arriba y qué es delante) como hace con el móvil. Tamaño: unos 6,5 KB/s, **~23 MB por hora** sin comprimir. La nube admite 600 MB por clave: unas 25-40 h de salidas; habrá que borrar las viejas o bajar el sensor a 50 Hz en las salidas largas.

### 3.6 Vinculación y nube

Solo en la versión completa: el prototipo simple no tiene vinculación ni nube ([apartado 3.4](#34-firmware-lo-escribo-yo)).

1. En la app, Garaje → Datos → VINCULAR te da un código de 6 letras (vale 10 minutos y un solo uso).
2. Conectas el móvil a la red WiFi de la caja («StreetChaos-Caja», con contraseña) y abres su página.
3. Escribes el código y el nombre y la contraseña de tu Compartir Internet.
4. Vuelves a tu red y enciendes Compartir Internet: el iPhone no puede dar internet y estar conectado a otra WiFi a la vez.
5. La caja se conecta y cambia el código por la clave (`pair-claim`, el mismo camino que el Blackbox). La guarda.
6. Desde entonces, cada vez que se conecta por el móvil, sube las salidas nuevas con `put` (URL firmada) y `commit` (la ficha), y las marca como subidas. Las que bajas con la página de la caja se quedan en la microSD hasta que hace falta sitio. La nube no duplica una salida que ya tiene, así que subirla otra vez no hace daño.

La URL de Supabase y la clave publicable se meten al compilar desde un `secrets.h` que **no se sube al repo** (se genera desde `.env.local`), igual que la web. Quien tenga la clave de sincronización ve tus salidas: la red WiFi de la caja va con contraseña.

### 3.7 Lo que hay que tocar en el Blackbox

- **Importar `.scb` desde el disco**: ahora `importFiles` solo lee texto (`f.text()`); hay que reconocer los binarios (`SCB1` o gzip) y el `.zip` de la página de la caja (sin comprimir: basta leer sus cabeceras), y abrirlos con `unpackSession`.
- Comprobar que el análisis va bien con sensores sin la gravedad del sistema y a 100 Hz (`process.js`), y que `meta.logger` no lo manda por el camino de «el aparato ya da la inclinación».
- Enseñar «Caja DIY» como origen en la lista y en CALIDAD.
- **En la app**, Garaje → Datos → SUBIR SALIDAS DE LA CAJA:
  - abre el `.zip` bajado de la página de la caja, o sus `.scb` sueltos (camino 2 del [apartado 2](#2-cómo-encaja-con-lo-que-ya-hay));
  - mete las salidas en la caja negra del móvil con su origen «Caja DIY»;
  - las sube con la sincronización de siempre.

### 3.8 Pruebas y cuándo está hecha

- **En la mesa**: el GPS da las posiciones por segundo que debe (contadas) y el sensor sus 100 Hz; 2 h grabando sin huecos; cortar la corriente a mitad y que la salida siga entera; la caja al sol a 60 °C sin colgarse.
- **En la moto**: varias salidas con la caja y el iPhone a la vez, y compararlas en el Blackbox (velocidad, inclinación, G, 0-100).
- **Hecha cuando**: 3 salidas seguidas sin perder datos, arranque y parada solos, subida sola por el Compartir Internet del móvil (en el prototipo simple, bajada por la red de la caja), y la inclinación cuadra con la del iPhone (±3°) o mejor.

---

## 4. Fase 2: datos de la moto

Tres señales, sin tocar la centralita ni los frenos.

### 4.1 Freno

- **De dónde**: del cable de la luz de freno (tiene 12 V mientras frenas, con cualquiera de las dos manetas).
- **Cómo**:
  - un optoacoplador (PC817) con su resistencia (1,8 kΩ en la caja) y un diodo de protección;
  - otra resistencia de 1 kΩ en la propia derivación: si el cable se pela y toca masa, no salta el fusible de las luces de la moto;
  - la caja no toca nunca directamente el cable y **la luz de freno sigue funcionando igual**;
  - derivación Posi-Tap, sin cortar el cable;
  - comprobar la luz de freno después.
  - Circuito en [conexiones.md](../hardware/caja/conexiones.md#31-contacto-y-freno-dos-circuitos-iguales).
- **Qué da**: el instante exacto en que tocas el freno (precisión de milisegundos). No distingue delantero y trasero (comparten luz); para eso habría que derivar cada interruptor por separado.
- **En el Blackbox**:
  - en FRENADAS, el tiempo de reacción (de tocar la maneta a que la moto frena de verdad);
  - en CURVAS, si entras frenando y cuánto mantienes el freno tumbado;
  - el freno como canal en las gráficas y en el mapa.

### 4.2 Revoluciones

- **De dónde**: una pinza (8-10 vueltas de cable alrededor del cable de la bujía), sin cortar nada. **La Ninja 125 tiene la bobina sujeta al chasis con un cable hasta la pipa**, así que vale.
  - Alternativa para más adelante: el conector de diagnosis de 4 vías (KDS) de la Ninja 125, que da revoluciones, acelerador y temperaturas. Hay indicadores de marcha comerciales que lo leen, pero necesita un chip de línea K y no está probado con esta centralita.
- **Cómo**:
  - **Circuito:** la pinza pasa por un acondicionador (resistencia, diodos de protección, filtro y un disparador Schmitt) que deja la señal limpia a 3,3 V. La placa mide el tiempo entre chispas con una interrupción y descarta las falsas: más rápido que el máximo de revoluciones, es ruido.
  - **Calibración:** según el motor, salta una chispa por vuelta o una cada dos. Se calibra una vez, con el motor en marcha y la moto parada, en la pestaña TALLER de la página de la caja: se compara con el cuentarrevoluciones de la moto a ralentí y a unas 5000 rpm.
  - **Ruido:** el encendido mete mucho ruido eléctrico. Hace falta cable apantallado y separado del resto.
- **Qué da**: revoluciones a 25 Hz y, comparando con la velocidad, **la marcha**.
  - La relación velocidad/revoluciones es fija en cada marcha, y el Blackbox las aprende solo de tus salidas.
  - La Ninja 125 no tiene sensor de marcha (ni indicador en el cuadro), así que esto es nuevo para ti.
  - Se parte de sus relaciones de cambio, de 3,93 km/h por cada 1000 rpm en 1.ª a 11,59 en 6.ª (tabla en [conexiones.md](../hardware/caja/conexiones.md#7-datos-para-el-firmware)).
- **En el Blackbox**:
  - revoluciones y marcha en las gráficas;
  - en CURVAS, la marcha a la entrada, en el vértice y a la salida;
  - en POTENCIA, la curva frente a las revoluciones y por marchas;
  - el tiempo en cada marcha y los puntos de cambio.

### 4.3 Botón

- El botón B de la pantalla de la fase 4 (llega a la caja por la radio, así que no se puede probar hasta H8). Más adelante se puede añadir un pulsador remoto junto a la piña izquierda.
- **Pulsación corta**: marca ese momento (evento `mark`), que sale en el mapa y en las gráficas para encontrarlo luego.
- **Pulsación larga**: pone ahí la meta de las vueltas, como la «meta marcada» de CRONO → VUELTAS.

### 4.4 Cambios de formato

Añadir datos es un cambio de formato (ver «Si cambias el formato» en `docs/telemetria.md`):

- **Flujo nuevo** `moto` (`float32`, 25 Hz): `t, rpm, brake`. Se pone `FORMAT` a 2 y el Blackbox lee las dos versiones.
- **Eventos nuevos**: `brake` (on/off, con la hora exacta de la interrupción) y `mark`. La caja graba `brake` desde H3, porque la derivación ya está; el Blackbox lo usa en H6. `mark` llega con la pantalla (H8).
- **Canales nuevos del Blackbox**: `rpm`, `gear` y `brake` en `src/blackbox/channels.js`, más la detección de marchas en `process.js`.

### 4.5 Cuándo está hecha

- Revoluciones a ralentí ±50 rpm frente al cuentarrevoluciones.
- La marcha acertada más del 95 % del tiempo en una salida.
- El freno se marca a ±20 ms.
- La luz de freno sigue funcionando.

---

## 5. Fase 4: pantalla y luces

### 5.1 Una unidad aparte en el manillar

La caja tiene que ir en el chasis (por los sensores) y la pantalla en el manillar (para verla), así que son **dos aparatos**:

- **Pantalla**: una placa ESP32-S3 pequeña con su pantalla, 2 botones estancos, una tira de LEDs y un sensor de luz.
- **Enlace**: por radio con **ESP-NOW** (de ESP32 a ESP32, sin router, unos milisegundos de retraso). La caja le manda el estado 10-20 veces por segundo y la pantalla le manda los botones.
- **Alimentación**: de la caja, por un cable de 2 hilos hasta el manillar.
  - Son 12 V que se encienden con el contacto: salen por la borna J3 de la caja, con su fusible F2.
  - La pantalla se enciende y se apaga con la caja, y no lleva batería.
  - Un conector estanco junto al soporte permite quitarla.
- **Soporte**: tu Quad Lock con el amortiguador, mediante un adaptador Quad Lock Universal (Original) pegado a una chapa atornillada a la carcasa. Puede sustituir al móvil en marcha: el iPhone en el bolsillo, lejos de las vibraciones.
- **Carcasa**: impresa en ASA, a medida ([impresion.md](../hardware/caja/impresion.md), pieza 7).
- Piezas y montaje en [hardware/caja/](../hardware/caja/README.md).

### 5.2 Qué pantalla

| Tipo | Al sol | Pros | Contras | Precio aprox. |
| --- | --- | --- | --- | --- |
| **Sharp Memory LCD 2,7"** (400×240, reflectiva) | Perfecta: cuanto más sol, mejor se ve | Gasta casi nada; el estilo pixel de la app le va que ni pintado | Monocromo; de noche necesita luz | 30-45 € + placa |
| **AMOLED 1,9-2,4"** (placas con la pantalla integrada) | Bien, sin más | Color, contraste, se ve genial de noche | A pleno sol pierde; gasta más | 25-35 € |
| TFT normal | Mal | Barata | Al sol no se ve | (descartada) |

La primera elección fue la **Sharp Memory LCD 2,7" (Adafruit 4694) + 8 LEDs de colores**. Se descartó el 2026-11-11: se rueda mucho de noche, y de noche la Sharp no se ve sin luz.

#### Pantallas que se ven al sol y de noche (búsqueda del 2026-11-11, descartadas)

| | **EA TFT024-23ATNN** (Display Visions) | **Azumo 13290-03** |
| --- | --- | --- |
| Qué es | TFT **transflectiva** de 2,4", en color, 240 × 320: al sol se lee con la luz del sol y de noche con su retroiluminación | La **misma Sharp de 2,7"** con una luz frontal RGB pegada delante |
| Al sol | Buena, sin encender la luz | La mejor: como la Sharp |
| De noche | Retroiluminación blanca: 4 LEDs, 3,0 V y 60 mA, regulable | Luz frontal de 6 a 225 mW; puede ir en rojo o ámbar para no deslumbrar |
| Zona visible | 49 × 37 mm, un poco más pequeña | 58,8 × 35,3 mm, igual que ahora |
| Conexión | ST7789 por SPI de 4 hilos, a 3,3 V. Cable plano de 39 vías a 0,3 mm: hace falta la placa adaptadora EA 9980-TFT, o una propia | El cable de la Sharp; en principio entra en el zócalo de la placa Adafruit 4694, que ya lleva los 5 V y el cambio de niveles. La luz va aparte |
| Firmware | Otro controlador (ST7789, muy usado) y 3 patillas más: D/C, reset y luz | El mismo que ahora, más la luz por PWM |
| Precio | ≈ 31 € en la tienda del fabricante (Alemania) + ≈ 63 € del adaptador | ≈ 102 € + ≈ 63 € de la Adafruit 4694 |
| Existencias | En la tienda del fabricante; en DigiKey, plazo de unas 8 semanas | Ninguna: DigiKey da 32-42 semanas (siguiente lote en mayo de 2027) |

Ninguna de las dos convenció al usuario.

#### Elegida: tipo navegador de moto (2026-11-11)

Los navegadores de moto llevan una **IPS en color de unos 1000 nits, con antirreflejos**: al sol se lee por pura potencia de luz, y de noche la luz se baja con el sensor. Las placas que traen la ESP32-S3 y la pantalla juntas (Waveshare, Elecrow, Makerfabs) se quedan en 200-450 nits, y al sol no valen.

**Riverdi RVT43HLBFWN00**, con marco (Riverdi, Polonia), + 8 LEDs de colores:

| | |
| --- | --- |
| Pantalla | 4,3", 480 × 272, IPS, 1000 cd/m², antirreflejos. Sin táctil: con guantes no sirve |
| Zona visible | 95 × 54 mm, casi el triple que la Sharp |
| Gráficos | Lleva dentro un chip gráfico (BT817, EVE4) que dibuja: la ESP32-S3 solo le manda órdenes por SPI. Da 10 refrescos por segundo o más sin esfuerzo |
| Conexión | SPI a 3,3 V con la misma Thing Plus. Su conector RiBUS (20 vías a 0,5 mm) pasa a pines con la Break Out Board 20 de Riverdi, que trae su propio cable plano |
| Luz | 5 V: 268 mA al 100 % (≈ 1,3 W) y 111 mA al 50 % |
| Temperatura | −20 a 70 °C |
| Medidas | 106,3 × 84 mm contando las 4 orejetas de su marco, 9 mm de grueso y 95 g. Va en una carcasa impresa en ASA ([impresion.md](../hardware/caja/impresion.md)) |
| Precio | ≈ 85 € (en RS, la versión sin marco está a 83,20 € con IVA); unos 60 $ en la tienda de Riverdi |
| Librerías | La EVE de Rudolph Riedel (PlatformIO, ESP32) o la de Bridgetek para Arduino. No es LovyanGFX |

**En estudio desde el 2026-11-12:** usar el iPhone como pantalla en vez de la Riverdi. Análisis y plan en [caja-movil.md](caja-movil.md). Se decide después de probarlo en el hito H5, antes de comprar la pantalla. La caja ya va preparada para las dos opciones (J3 de 3 vías y un botón de manillar en el GPIO 14).

**Alimentación, decidida: por cable desde la caja.** Con la luz a tope la unidad pide unos 2 W, y una batería de 2000 mAh duraría 3-4 h. El cable sale de la caja con su fusible, como en un navegador, y así no queda ninguna batería al sol en el manillar. Patillas y alimentación en [conexiones, apartado 6](../hardware/caja/conexiones.md#6-unidad-de-pantalla).

### 5.3 Pantallas

Pocas cosas y en grande: se mira de reojo, nunca se toca en marcha. Se cambia de pantalla con un botón.

| Pantalla | Qué enseña |
| --- | --- |
| **MARCHA** | Velocidad grande, marcha, barra de revoluciones, inclinación, punto de «grabando» |
| **TRAMOS** | Los tramos que guardas en el Blackbox, con su diferencia en vivo (los baja la caja cuando se conecta al Compartir Internet del móvil: `kv-get` de `segments`) |
| **CRONO** | 0-50, 0-100, 1/4 de milla… con la salida detectada sola (las mismas marcas que el CRONO de la app, `src/core/perf.js`) |
| **VUELTAS** | Tiempo de la vuelta, diferencia en vivo con tu mejor vuelta, mejor vuelta y número. Meta con la pulsación larga o con los circuitos del Blackbox. Va la última: se rueda sobre todo en calle y carretera |
| **ESTADO** | Satélites y Hz del GPS, batería, espacio de la microSD, conexión con el móvil, salidas sin pasar, temperatura de la caja |

### 5.4 Luces

Una tira de 8 LEDs (WS2812B o SK6812):

- **Aviso de cambio**: se van encendiendo con las revoluciones y parpadean en el punto de cambio, configurable por marcha (necesita la fase 2).
- **Delta**: verde si vas por delante de tu referencia (vuelta o tramo) y rojo si vas por detrás, más intenso cuanto mayor es la diferencia.
- **Brillo**: se ajusta solo con el sensor de luz, para no deslumbrar de noche.

### 5.5 Lo que tiene que calcular la caja en directo

En la fase 1 el análisis bueno lo hace el Blackbox después. Para la pantalla, la caja tiene que calcular en marcha (módulo `fusion` del firmware):

- **Velocidad**: la Doppler del GPS, interpolada entre posiciones con el acelerómetro.
- **G**: el acelerómetro girado a los ejes de la moto. La postura se calibra una vez desde la página de la caja («moto recta y quieta», luego acelerar y frenar en recta) o se copia de lo que aprende el Blackbox.
- **Inclinación**: un filtro complementario.
  - A corto plazo, la integral del giroscopio sobre el eje de avance.
  - A largo plazo, la referencia atan(v × giro / g), con el giro medido sobre la vertical de la moto.
  - Es el mismo principio que la app y el Blackbox, portado a C++.
- **Delta**: el de la app (`src/core/live.js` y `src/core/segments.js`).
  - Puertas de 40 m: la vuelta o el tramo empieza al cruzar la línea.
  - Diferencia = tiempo ahora − tiempo de la referencia a la misma distancia recorrida.
  - Se porta a C++ con pruebas que comparen contra la versión de JavaScript.
- **Marcha**: revoluciones frente a velocidad, con las relaciones aprendidas (fase 2).

### 5.6 Cuándo está hecha

- Se lee a pleno sol a mediodía.
- Se actualiza al menos 10 veces por segundo.
- Los LEDs reaccionan en menos de 50 ms.
- El delta en vivo cuadra con el del Blackbox después (±0,1 s).
- Detecta las 10 vueltas de 10.

---

## 6. Hitos, en orden

Cada hito se puede probar solo antes de pasar al siguiente.

| # | Hito | Tú | Yo |
| --- | --- | --- | --- |
| H1 | **Banco de pruebas**: placa, GPS, sensor y microSD en una placa de prototipos, grabando en bruto | Comprar y conectar | Programa de prueba que dice OK o FALLA en la microSD, el GPS y el sensor, y se instala desde Chrome (sin Arduino); luego el de grabación en bruto. **Escrito el 2026-11-12** (`hardware/caja/firmware/` y la página `/caja/`); falta probarlo con la placa |
| H2 | **Formato**: carpetas de sesión, `.scb`, el Blackbox lo importa desde el disco | Probar con una salida a pie o en coche | Firmware (se instala desde la misma página que la prueba de H1, con su PRUEBA DE LA CAJA para la placa soldada; de fábrica, en la versión simple), importador del Blackbox, pruebas de formato |
| H3 | **Caja y primera salida**: placa base soldada, caja Hammond mecanizada, montada en la moto, salida junto al iPhone | Soldar, probar en la mesa que se apaga sola, taladrar, montar con las derivaciones del contacto y el freno, rodar ([montaje](../hardware/caja/montaje.md)) | Firmware que ya se apaga solo y tiene la página para bajar las salidas por la red de la caja (en la versión completa, además apunta el freno); en la app, SUBIR SALIDAS DE LA CAJA; comparación en el Blackbox |
| H4 | **Autonomía**: arranque y parada solos con el contacto, apagado con el interruptor, recuperación tras cortes | Probar con la llave unos días (la caja ya va conectada desde H3) | Firmware |
| H5 | **Pasar las salidas por el móvil**: página de la caja, vinculación con el código, subida sola por Compartir Internet, bajar el archivo con la red de la caja | Vincular la caja desde su página y, al aparcar, pasar las salidas con el Compartir Internet del iPhone («Maximizar compatibilidad») o con la red de la caja | Firmware de la versión completa: subida sola, vinculación y TALLER |
| H6 | **Freno** (fase 2) | Nada que montar: mirar el freno en FRENADAS (la derivación va desde H3) | Canal de freno y reacción en FRENADAS en el Blackbox (los eventos de freno se graban desde H3) |
| H7 | **Revoluciones y marchas** (fase 2) | Pinza en la bujía, calibrar con el cuentarrevoluciones | Acondicionador (esquema), calibración en TALLER, `FORMAT` 2, marchas, POTENCIA por revoluciones |
| H8 | **Unidad de pantalla** (fase 4): hardware, enlace ESP-NOW, pantallas MARCHA y ESTADO | Imprimir la carcasa, montarla, pasar su cable desde la caja, ponerla en el manillar, vincularla desde TALLER y probar el botón B | Firmware de las dos unidades: la pantalla con la librería EVE de Rudolph Riedel (BT817), a oscuras sin contacto o sin noticias de la caja, y se instala desde la misma página de Chrome; vincular la pantalla con la caja; botón B (marca y meta) |
| H9 | **TRAMOS, CRONO y VUELTAS** en la pantalla, con delta | Probar en circuito o tramo cerrado | Fusión en directo, delta, bajada de tramos |
| H10 | **LEDs**: aviso de cambio y delta | Montar la tira | Firmware |

Todo el hardware y el firmware van en `hardware/caja/`: ya están las piezas, las conexiones, el montaje y los esquemas; el firmware irá en `hardware/caja/firmware/`. El repo es público: ni claves ni datos de salidas.

---

## 7. Presupuesto

Precios con IVA comprobados el 2026-11-10 con las piezas exactas del prototipo (detalle en [piezas.md](../hardware/caja/piezas.md#5-resumen-y-versión-ahorro)):

| Parte | Qué | Aprox. |
| --- | --- | --- |
| Caja (fases 1 y 2) | Placa, GPS NEO-M9N con antena, sensor, microSD, alimentación protegida, entradas de freno y revoluciones, salida a la pantalla, caja estanca | 305 € |
| Instalación | Cables, fusible, derivaciones, termorretráctil, cinta autovulcanizante, Dual Lock | 56 € |
| Pantalla (fase 4), se compra después | Placa, Riverdi 4,3" de 1000 nits con su adaptador, LEDs, sensor de luz, regulador, botones, cable y conector estanco, insertos y adaptador Quad Lock (la carcasa se imprime) | 207 € |
| **Total** | **Fases 1 + 2 + 4** | **≈ 570 €** |
| Versión ahorro | GPS MAX-M10S (10 Hz), antena y latiguillo genéricos, regulador más pequeño, placa XIAO en la pantalla | ≈ 440 € |
| Herramientas, si faltan | Soldador, estaño y flux, multímetro, pelacables, crimpadora, pistola de calor, broca escalonada, fuente de 12 V | ≈ 150 € |

**El primer cálculo (175-275 €) se quedaba corto.** Al elegir las piezas exactas suben:
- el GPS de 25 Hz con su antena (≈ 125 €);
- la alimentación protegida para la moto (≈ 45 €);
- la caja estanca de marca;
- la segunda placa y el adaptador Quad Lock;
- y el material de instalación, que no estaba contado.

Lo que es solo de la fase 2 (freno y revoluciones) cuesta unos 15 €.

Como referencia, una RaceBox Mini S cuesta unos 270-280 € y no tiene ni revoluciones, ni freno, ni pantalla.

---

## 8. Decisiones tomadas

Cerradas el 2026-11-10 al diseñar el prototipo (el porqué de cada una, en [hardware/caja/README.md](../hardware/caja/README.md#decisiones)):

1. **GPS**: u-blox NEO-M9N, 25 Hz con GPS, Galileo y GLONASS. La MAX-M10S (10 Hz) queda como versión ahorro.
2. **Placa**: SparkFun Thing Plus ESP32-S3, la misma en la caja y en la pantalla.
3. **Alimentación**: sin batería en la caja; 12 V permanente con fusible y un interruptor electrónico que enciende el contacto y apaga la caja al terminar.
4. **Dónde va**: bajo el asiento, plana; la antena bajo plástico, mirando al cielo, a más de 20 cm de la caja. Se confirma con una maqueta de cartón.
5. **Pantalla**: Riverdi de 4,3", IPS y 1000 nits, tipo navegador de moto, + 8 LEDs. Cambiada el 2026-11-11: la Sharp no se veía de noche.
6. **Enlace**: ESP-NOW para los datos; la corriente, por cable desde la caja. Va en el Quad Lock.
7. **Herramientas**: hay que soldar (lista en [piezas.md](../hardware/caja/piezas.md#4-herramientas)). Desde el 2026-11-12, la caja la diseña e imprime él (la Hammond queda como alternativa). Con la impresora 3D se hacen también el soporte, las plantillas y la carcasa de la pantalla ([impresion.md](../hardware/caja/impresion.md)).
8. **La moto**: Kawasaki Ninja 125 (2019 en adelante).
   - Batería YTX7A-BS bajo el asiento.
   - Piloto trasero (según el catálogo de recambios, de bombilla 21/5 W): la luz de posición da el contacto y la de freno, el freno.
   - Bobina con cable de bujía.
   - Corte de encendido a 10.500 rpm.
   - Sin sensor de marcha.
9. **Primer prototipo** (2026-11-12): el simple, que es la fase 1 sin la subida por el Compartir Internet. Lleva solo alimentación, contacto, GPS y sensor, y las salidas se bajan con el móvil desde la WiFi de la caja ([conexiones, apartado 7](../hardware/caja/conexiones.md#7-datos-para-el-firmware)).

**Queda por comprobar con la moto delante:**
- el hueco exacto para la caja;
- los colores de los cables del piloto (con el multímetro);
- las chispas por vuelta (probablemente una) y el ralentí;
- por dónde se llega al cable de bujía.

---

## 9. Riesgos y cosas a vigilar

- **Ruido eléctrico del encendido** (fase 2): cable apantallado, filtro y separación; puede meter falsos en el GPS o reiniciar la placa si se monta mal.
- **Vibraciones**: aflojan conectores y la microSD. Conectores con cierre, cola caliente en los cables, la tarjeta sujeta.
- **Agua y calor**:
  - la caja lleva junta, prensaestopas y una membrana de ventilación para que no condense;
  - no tiene batería;
  - no hay ninguna batería LiPo: la pantalla toma la corriente de la caja.
- **La batería de la moto**: la caja apagada no gasta nada gracias al interruptor. Si el firmware se colgara con la moto parada, el perro guardián del ESP32 lo reinicia y la caja se apaga sola; aun así, la primera semana conviene vigilar que la moto arranca bien tras unos días parada. El firmware la apaga solo desde el primero que va en la moto (H3): antes de montarla se prueba en la mesa que se apaga y que apagada no gasta nada ([montaje, paso 2.9](../hardware/caja/montaje.md#29-repaso-final)), y en la moto se repite la medida (paso 5.8). Si algún día sigue encendida con la moto aparcada más de 20 minutos, se quita el fusible.
- **Antena tapada**: la causa número uno de malos datos de GPS.
- **Tocar la instalación de la moto**: solo derivaciones, sin cortar ni quitar nada de frenos ni luces; fusible en cada derivación. Comprobar luces y freno después de cada cambio.
- **La pantalla en marcha**: grande y de reojo; nada que haya que leer con calma ni tocar. Bien sujeta y sin tapar los relojes ni la visión.
- **Claves**: la clave de sincronización va en la memoria de la placa, y la red de la caja con contraseña. La clave publicable de Supabase, solo al compilar (`secrets.h` fuera de git).
- **Espacio en la nube**: unos 23 MB por hora; con muchas salidas hay que ir borrando o grabar el sensor a 50 Hz.

---

## Qué no entra (por ahora)

- **Fase 3, temperaturas medidas**:
  - asfalto con un MLX90614;
  - neumáticos con cámaras térmicas MLX90640 inalámbricas, que calibrarían solo el modelo de neumáticos.
  - Encaja fácil después: van por ESP-NOW como la pantalla.
- **Fase 5, chasis**:
  - velocidad de cada rueda (patinar y bloquear);
  - recorrido de la suspensión.
- **Ver la caja en la app del iPhone en directo**: necesita la app nativa.
- **Leer la centralita** (diagnosis): depende mucho de la moto; las revoluciones salen de la pinza.

---

## 11. Lo que ya hay en el repo y se reutiliza

| Archivo | Para qué |
| --- | --- |
| `hardware/caja/` | El prototipo: piezas, conexiones, montaje y esquemas (y el firmware, cuando se escriba) |
| `docs/telemetria.md` | El formato que tiene que escribir la caja (flujos, ficha, eventos, `.scb`) |
| `src/core/blackbox.js` | `STREAMS`, `RULES` (las reglas de arranque y parada a copiar en el firmware), `packSession`/`unpackSession` |
| `src/blackbox/process.js` | El análisis: postura aprendida, inclinación con giroscopio + GPS sin gravedad del sistema, retraso del GPS |
| `src/blackbox/main.js` | `importFiles` (hay que añadir los `.scb` binarios) |
| `src/blackbox/cloud.js` | Cómo baja y abre el Blackbox las salidas de la nube |
| `supabase/functions/caja-negra/index.ts` | `pair-claim` (vincular), `put`/`commit` (subir), `kv-get` (tramos para la pantalla) |
| `src/core/live.js`, `src/core/segments.js` | Puertas y delta en vivo, a portar a la pantalla |
| `src/core/perf.js` | Las marcas del crono (0-100, 1/4…) |
| `src/blackbox/dyno.js` | Potencia, a ampliar con revoluciones |
| `src/blackbox/channels.js` | Canales de las gráficas (añadir `rpm`, `gear`, `brake`) |

Siguiente paso cuando se retome:
1. Hacer la maqueta de cartón y confirmar el sitio en la moto ([montaje, paso 0.2](../hardware/caja/montaje.md#02-busca-el-sitio-en-la-moto)).
2. Pedir las piezas de la caja y la instalación (≈ 360 €). La pantalla, más adelante, revisando antes cuál.
3. Cuando lleguen, las pruebas de banco (H1). El programa de prueba y su instalador desde Chrome los escribo yo, y pueden estar listos antes de que lleguen las piezas.
