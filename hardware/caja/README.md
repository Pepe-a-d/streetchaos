# Caja Street Chaos: prototipo

Proyecto completo para construir la «RaceBox» propia de Street Chaos en la **Kawasaki Ninja 125**. Desarrolla las fases 1, 2 y 4 del plan [docs/caja-diy.md](../../docs/caja-diy.md): qué piezas exactas comprar, cómo se conectan, cómo se sujetan a la moto y el montaje paso a paso.

Estado (2026-11-11): **diseñado, sin comprar ni montar.** El firmware lo escribo yo. El primero es el programa de prueba de banco (hito H1), que se instala desde Chrome.

![Las dos unidades y la moto](esquemas/sistema.svg)

## Qué es

Son dos aparatos:

- **La caja.** Va atornillada o pegada bajo el asiento.
  - Graba en la microSD y en el formato de la caja negra del móvil:
    - GPS a 25 Hz;
    - sensor de movimiento a 100 Hz;
    - freno;
    - revoluciones.
  - Se enciende con el contacto y se apaga sola.
  - Al aparcar, pasa las salidas por el móvil: por el Compartir Internet del iPhone o por la red WiFi de la propia caja.
  - No tiene batería propia: apagada no gasta nada.
- **La pantalla.** Va en tu soporte Quad Lock, con el amortiguador.
  - Pantalla en color de 4,3" y 1000 nits, como la de un navegador de moto: se lee a pleno sol y de noche baja el brillo sola.
  - 8 LEDs para el aviso de cambio y el delta, dos botones y sensor de luz.
  - Toma la corriente de la caja por un cable y se enciende y se apaga con ella; los datos le llegan por radio (ESP-NOW).
  - Va en una carcasa impresa en 3D.

## Archivos

| Archivo | Qué tiene |
| --- | --- |
| [piezas.md](piezas.md) | Lista de la compra con referencias exactas, tiendas y precios. Versión ahorro. Herramientas |
| [piezas.csv](piezas.csv) | La misma lista en tabla, para hoja de cálculo |
| [conexiones.md](conexiones.md) | Patillas, circuitos, lista de conexiones para soldar, cable a la moto, pantalla y datos para el firmware |
| [impresion.md](impresion.md) | Piezas impresas en 3D: soporte de la caja sin taladrar, plantillas, base de la antena y, en la fase 4, la carcasa de la pantalla |
| [montaje.md](montaje.md) | Paso a paso: pruebas de banco, placa, caja, cable, instalación en la Ninja 125, revoluciones, pantalla, comprobaciones y mantenimiento |
| [esquemas/sistema.svg](esquemas/sistema.svg) | Las dos unidades y la moto |
| [esquemas/caja-electrico.svg](esquemas/caja-electrico.svg) | Circuito eléctrico de la caja |
| [esquemas/placa-base.svg](esquemas/placa-base.svg) | Dónde va cada pieza en la placa, a escala |
| [esquemas/caja-taladros.svg](esquemas/caja-taladros.svg) | Agujeros de la caja y cómo se ancla |
| [esquemas/pantalla.svg](esquemas/pantalla.svg) | Distribución y conexiones de la pantalla |

El firmware irá en `firmware/`.

## Decisiones

Cierran las decisiones pendientes del plan:

| Pendiente | Decidido | Por qué |
| --- | --- | --- |
| GPS | **u-blox NEO-M9N** (SparkFun GPS-17285) con antena activa externa | 25 Hz con GPS, Galileo y GLONASS a la vez: lo de una RaceBox. Tiene la señal PPS y alimenta la antena. La MAX-M10S (10 Hz) queda como versión ahorro |
| Placa | **SparkFun Thing Plus ESP32-S3**, la misma en las dos unidades | Trae la microSD, medidor de batería y conector Qwiic, y tiene existencias. Una sola plataforma para el firmware |
| Sensor de movimiento | **ISM330DHCX** (Adafruit 4502) | De ST, industrial, ±16 g y ±4000 °/s, FIFO de 9 KB |
| Alimentación de la caja | **12 V permanente con fusible + interruptor electrónico** (Pololu 2809): lo enciende el contacto y lo apaga la caja al terminar | Sin batería bajo el asiento, que es donde más calor hace. Puede subir las salidas con la moto apagada. Apagada no gasta nada |
| Dónde va | Bajo el asiento (el del pasajero si cabe), plana; la antena bajo plástico, a más de 20 cm | Cerca del centro de la moto y lejos del calor. Se comprueba con una maqueta de cartón (montaje, paso 0.2) |
| Pantalla | **Riverdi RVT43HLBFWN00**: 4,3", IPS, 1000 nits, con chip gráfico propio (BT817), + 8 LEDs | Como la de un navegador de moto: se lee al sol y se ve de noche. La Sharp de 2,7" no se veía de noche, y las otras dos opciones no convencieron (plan, apartado 5.2) |
| Enlace | **ESP-NOW** (radio) para los datos; la corriente, **por cable desde la caja** (borna J3, con su fusible F2) | Con 1000 nits gasta unos 2 W: una batería duraría 3-4 h. Así se enciende y se apaga con la caja, y no hay batería al sol en el manillar |
| Móvil como pantalla | **En estudio** ([docs/caja-movil.md](../../docs/caja-movil.md)): se prueba en H5, antes de comprar la Riverdi. La caja ya va preparada para las dos opciones: J3 de 3 vías y un botón de manillar en el GPIO 14 | Ahorraría unos 200 € y reutiliza la app, pero preocupan el calor del iPhone y el WiFi en marcha |
| Soporte de la pantalla | **Adaptador Quad Lock Original** sobre una chapa atornillada a la carcasa impresa. Un conector estanco SP13 permite quitarla | Usa tu soporte y tu amortiguador |
| Revoluciones | **Pinza de cable enrollado** en el cable de bujía | La Ninja 125 tiene bobina con cable, así que no hay que tocar el encendido. El conector de diagnosis (KDS) queda como mejora futura |
| Marchas | Se deducen de la velocidad y las revoluciones | La Ninja 125 no tiene sensor de marcha. Las relaciones de la caja de cambios dan el punto de partida |
| Herramientas | Hay que soldar: soldador, multímetro, crimpadora y pistola de calor | Las placas vienen sin pines y la placa base es soldada. Nada de cables de enchufar dentro de la caja |
| Impresora 3D | **La caja la diseña e imprime él** (ABS o ASA, alisado con acetona, junta de cordón y prensaestopas), desde el 2026-11-12. La Hammond queda como alternativa comprada. También se imprimen el soporte, las plantillas y, en la fase 4, la carcasa de la pantalla ([impresion.md](impresion.md)) | Quiere diseñarla él, con sus propias reglas de caja estanca. Por dentro, las medidas salen de la placa base (100 × 80 mm) y el GPS encima |
| Primer prototipo | **El simple**: la fase 1 sin la subida por el Compartir Internet. Solo alimentación, contacto, GPS y sensor; las salidas se bajan con el móvil desde la WiFi de la caja ([conexiones, apartado 7](conexiones.md#7-datos-para-el-firmware)) | Lo mínimo que graba y se descarga. La placa base es la misma, así que el freno, las revoluciones y el manillar se añaden luego sin rehacerla |

## Coste

| Parte | Aprox. |
| --- | --- |
| Caja (fases 1 y 2) | 305 € |
| Material de instalación | 56 € |
| Pantalla (fase 4), se compra después | 207 € |
| **Total** | **≈ 570 €** (versión ahorro ≈ 440 €) |
| Herramientas, si faltan | ≈ 150 € |

Detalle y versión ahorro en [piezas.md](piezas.md#5-resumen-y-versión-ahorro).

## Orden de trabajo

| Hito | Tú | Yo | Dónde |
| --- | --- | --- | --- |
| H1 · Banco | Comprar; instalar el programa de prueba desde Chrome y ver OK en cada pieza | Firmware de banco: lee GPS e IMU y graba en bruto | [montaje 0-1](montaje.md#0-antes-de-empezar) |
| H2 · Formato | Probar a pie o en coche | `.scb` en el firmware, importar `.scb` en el Blackbox, pruebas | |
| H3 · Caja y primera salida | Placa base, prueba de apagado en la mesa, caja, cable e instalación con las derivaciones del contacto y el freno | Firmware que ya se apaga solo y apunta el freno; comparar con el iPhone en el Blackbox | [montaje 2-5](montaje.md#2-la-placa-base) |
| H4 · Autonomía | Probar arranque y parada con la llave | Contacto, interruptor, recuperación tras cortes | |
| H5 · Salidas por el móvil | Vincular la caja y probar a pasar las salidas | Página de la caja, vinculación, subida por Compartir Internet, bajada por la red de la caja | |
| H6-H7 · Freno, revoluciones y marchas | Freno: nada que montar. Pinza y calibración | Freno en FRENADAS, `FORMAT` 2, marchas, potencia por revoluciones | [montaje 6](montaje.md#6-freno-y-revoluciones-fase-2) |
| H8-H10 · Pantalla | Imprimir la carcasa, montarla, pasar su cable desde la caja, ponerla en el Quad Lock y probar el botón B | Firmware de la pantalla, botón B (marca y meta), delta, LEDs | [montaje 7](montaje.md#7-unidad-de-pantalla-fase-4) |

## Lo que falta comprobar en tu moto

Lo que no se ha podido confirmar desde fuera y se mira con la moto delante:

1. **El sitio de la caja**: el hueco exacto bajo los asientos. Si no cabe la caja de 160,8 × 90,8 × 62,5 mm, se cambia a una más estrecha.
2. **Los colores** de los cables de posición y freno del piloto trasero: se miden con el multímetro.
3. **Las chispas por vuelta** (probablemente una) y **el ralentí**: se calibran con el cuentarrevoluciones.
4. **Por dónde se llega al cable de bujía**: puede que haya que quitar algún carenado.
5. **El circuito de revoluciones**: valores de partida que puede que haya que ajustar.

## Seguridad

- Fusible a menos de 15 cm de la batería.
- Ningún cable de la moto cortado: solo derivaciones.
- Nada cerca del escape ni de lo que se mueve.
- Después de cada cambio, comprobar las luces y el freno.
- La pantalla, grande y de reojo; nunca se toca en marcha.
- El repo es público: aquí no van claves ni datos de salidas.
