# Firmware de la caja DIY

Para la SparkFun Thing Plus ESP32-S3. Usa PlatformIO con Arduino-ESP32 3.3 (`espressif32 @ 8.0.0`). Las patillas mandan según [../conexiones.md](../conexiones.md).

No hace falta compilar nada en el Mac. Al publicar, GitHub hace esto ([publicar.yml](../../../.github/workflows/publicar.yml)):
1. pasa las pruebas en el ordenador;
2. compila;
3. deja el firmware junto a la página <https://pepe-a-d.github.io/streetchaos/caja/>, que lo instala desde Chrome por el USB.

Si el firmware no compila, la web se publica igual, pero sin firmware nuevo.

| Carpeta | Qué hay |
| --- | --- |
| `src/prueba/` | **Prueba de banco (H1)**: microSD, GPS y sensor, todo por Qwiic, sin soldar. Dice OK o FALLA en la página ([montaje, apartado 1](../montaje.md#1-pruebas-de-banco-sin-soldar)) |
| `lib/ubx/` | Lector y armado de tramas UBX del GPS (NAV-PVT, MON-VER, CFG-VALSET). Lo usará también la caja |
| `lib/banco/` | El estado de la prueba de banco y su informe |
| `test/` | Pruebas de `lib/` en el ordenador (`pio test -e native`) |
| `scripts/publicar.mjs` | Prepara un firmware compilado para la página: sus partes, con la dirección de cada una, y `manifest.json` |

## El informe de la prueba

Cada segundo, la placa manda por el USB (a 115200) una línea `@SC ` + JSON con el estado de las tres piezas. Lo lee la página de la caja ([src/caja/informe.js](../../../src/caja/informe.js)). Cada pieza tiene `st` (`prueba`, `ok` o `falla`) y `msg`, el motivo de la FALLA. Las demás líneas son texto para leer una persona: la página las enseña en «Detalles».

La placa también acepta la orden `PRUEBA` por el puerto, que repite todo.

[tests/fixtures/caja-prueba.txt](../../../tests/fixtures/caja-prueba.txt) son líneas de verdad, sacadas de `lib/banco` compilado en el ordenador. La prueba [tests/caja.test.js](../../../tests/caja.test.js) comprueba que la página las entiende. Si cambia el formato, hay que volver a sacarlas.

## Compilar en el ordenador (opcional)

```bash
pip install platformio==6.2.0
```

```bash
cd hardware/caja/firmware && pio test -e native && pio run -e prueba
```

Ocupa unos 2 GB, entre las herramientas del ESP32 y el núcleo de Arduino.
