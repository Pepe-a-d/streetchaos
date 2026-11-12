# Piezas

Lista de la compra exacta del prototipo: la caja (fases 1 y 2) y la unidad de pantalla (fase 4). Las referencias de la columna «Ref.» son las de [conexiones.md](conexiones.md) y los esquemas. La misma lista en tabla está en [piezas.csv](piezas.csv).

**Precios comprobados el 2026-11-10, con IVA.** Los de DigiKey se han mirado en su web de España. Los marcados con «≈» son orientativos (genéricos o sin mirar en la tienda). Los precios y las existencias cambian: repásalos al pedir.

- [Dónde comprar](#dónde-comprar)
- [1. La caja](#1-la-caja)
- [2. Unidad de pantalla](#2-unidad-de-pantalla)
- [3. Material de instalación](#3-material-de-instalación)
- [4. Herramientas](#4-herramientas)
- [5. Resumen y versión ahorro](#5-resumen-y-versión-ahorro)

## Dónde comprar

- **DigiKey (digikey.es)**: casi todo, en un pedido. Precios en euros con aranceles incluidos, y envío gratis por encima de unos 50 € (compruébalo al pedir). Si una pieza no tiene existencias, mira **Mouser (mouser.es)** con la misma referencia del fabricante.
- **Kiwi Electronics** (kiwi-electronics.com, Países Bajos): Adafruit con existencias (LEDs, sensor de luz, batería).
- **BricoGeek** (tienda.bricogeek.com, España): los pulsadores.
- **Opencircuit** (opencircuit.shop, Países Bajos): la pantalla, si DigiKey no tiene.
- **Quad Lock** (quadlockcase.eu): el adaptador.
- **Amazon, tienda de electrónica o ferretería**: microSD, cables, terminales, termorretráctil, tornillería.

---

## 1. La caja

### Electrónica

| Ref. | Pieza | Referencia exacta | Cant. | Dónde | € |
| --- | --- | --- | --- | --- | --- |
| U1 | Placa ESP32-S3 con microSD | **SparkFun Thing Plus ESP32-S3** (WRL-24408; módulo ESP32-S3-MINI-1-N4R2) | 1 | [DigiKey 24408](https://www.digikey.es/en/products/detail/sparkfun-electronics/24408/22606864) | 30,14 |
| U2 | Receptor GPS 25 Hz | **SparkFun GPS Breakout NEO-M9N, SMA** (GPS-17285) | 1 | [DigiKey 17285](https://www.digikey.es/en/products/detail/sparkfun-electronics/17285/13561758) | 82,17 |
| ANT | Antena GPS activa, magnética, 3 m, SMA macho | **SparkFun GPS-14986** (28 dB, 3-5 V) | 1 | [SparkFun](https://www.sparkfun.com/gps-gnss-magnetic-mount-antenna-3m-sma.html) (16,50 $) o [DigiKey](https://www.digikey.es/en/products/detail/sparkfun-electronics/GPS-14986/9682235) (plazo 12 semanas) | 20,49 |
| — | Pasamuros SMA hembra-hembra, IP67 | **GCT RFAD-SA3SA2-01-N-A** | 1 | [DigiKey](https://www.digikey.es/en/products/detail/gct/RFAD-SA3SA2-01-N-A/25819955) | 4,26 |
| — | Latiguillo SMA macho-macho RG316, 152 mm | **Amphenol RF 135101-01-06.00** | 1 | [DigiKey ACX1567-ND](https://www.digikey.es/en/products/result?keywords=ACX1567-ND) | 20,12 |
| U3 | Sensor de movimiento 6 ejes | **Adafruit ISM330DHCX** (4502) | 1 | [DigiKey](https://www.digikey.es/en/products/result?keywords=adafruit%204502) | 21,43 |
| SD | microSD resistente al calor y a la escritura continua | **SanDisk High Endurance 32 GB** (SDSQQNR-032G-GN6IA), −25 a 85 °C | 1 | Amazon / PcComponentes | ≈ 12 |

Notas:
- **U1**: la misma placa va en la pantalla, así hay una sola plataforma. Lleva la ranura microSD, el USB-C y un medidor de batería. Viene **sin pines soldados**.
- **U2**: da corriente a la antena por el propio conector (3,2 V) y lleva una pila recargable para arrancar en caliente (~2 s). **No la cambies por la MAX-M10S sin mirar la [versión ahorro](#5-resumen-y-versión-ahorro)**: esa no tiene regulador y se alimenta a 3,3 V.
- **ANT**: alternativa en DigiKey, más barata y normalmente con existencias: **Quectel YG0035AA** (≈ 8,95 €, 3 m, SMA macho, IP64). Antes de comprarla, comprueba en su hoja de datos que funciona a 3,3 V.
- **Latiguillo**: cualquier SMA macho-macho de RG316 de 10-15 cm vale (≈ 5 € los genéricos).
- **SD**: si encuentras la **Kingston Industrial SDCIT2/16GB** (−40 a 85 °C, pSLC) por menos de 30 €, es mejor. En DigiKey está carísima.

### Alimentación

| Ref. | Pieza | Referencia exacta | Cant. | Dónde | € |
| --- | --- | --- | --- | --- | --- |
| U4 | Interruptor electrónico con protección de polaridad, **4,5-32 V** | **Pololu Mini Pushbutton Power Switch SV** (2809) | 1 | [DigiKey](https://www.digikey.es/es/products/detail/pololu-corporation/2809/10450609) | 6,03 |
| U5 | Regulador 12 V → 5 V, 3,2 A, 5,3-50 V | **Pololu D36V28F5** (3782) | 1 | [DigiKey](https://www.digikey.es/es/products/result?keywords=pololu%203782) | 29,15 |
| D1 | Diodo TVS 1500 W, 18,8 V | **1.5KE22A** (Littelfuse o Vishay; con «HE3», calidad automoción) | 1 | [DigiKey](https://www.digikey.es/es/products/result?keywords=1.5KE22A) | ≈ 1,14 |
| D2 | Diodo Schottky 1 A | **1N5819** | 1 | DigiKey | ≈ 0,40 |
| C1 | Condensador electrolítico 47 µF, 50 V | genérico, radial | 1 | DigiKey | ≈ 0,40 |
| F1 | Portafusibles estanco para fusible mini | **Littelfuse 0FHM0003ZXJS** (cables de 0,82 mm²) | 1 | [DigiKey](https://www.digikey.es/es/products/result?keywords=0FHM0003ZXJS) | 6,86 |
| F1 | Fusible mini de 2 A, 32 V (uno de repuesto) | **Littelfuse 0297002** | 2 | DigiKey / recambios de coche | ≈ 1,20 |
| F2 | Fusible rearmable (PTC) de 0,75 A, 60 V, radial: protege el cable de la pantalla | **Bourns MF-R075** | 1 | DigiKey | ≈ 0,40 |
| J3 | Borna de tornillo para placa, 3 vías, paso 5,08 mm: salida de 12 V a la pantalla, botón del manillar y masa | **Phoenix Contact MKDS 1,5/3-5,08** (1715734), la misma que J1 y J2 | 1 | DigiKey | ≈ 0,80 |

> **U4: la versión SV (2809), no la LV (2808).** La LV solo aguanta 20 V y un pico de la moto se la lleva. La LV va en la pantalla, que funciona con 4 V.

### Entradas de la moto (contacto, freno y revoluciones)

| Ref. | Pieza | Referencia exacta | Cant. | € |
| --- | --- | --- | --- | --- |
| U6, U7 | Optoacoplador DIP-4 | **Sharp PC817X2NSZ9F** | 2 | ≈ 0,70 |
| U8 | 6 disparadores Schmitt, DIP-14 | **TI SN74HC14N** | 1 | ≈ 0,60 |
| R1, R2 | Resistencia 1,8 kΩ ¼ W | — | 2 | |
| RT1, RT2 | Resistencia 1 kΩ **½ W** (van en los cables, junto a las derivaciones) | — | 2 | |
| R4, R5, R6 | Resistencia 10 kΩ ¼ W | — | 3 | |
| R3, R9 | Resistencia 22 kΩ ¼ W | — | 2 | |
| R7, R8 | Resistencia 100 kΩ ¼ W | — | 2 | |
| R10 | Resistencia 4,7 kΩ ¼ W | — | 1 | ≈ 1 todas |
| R12 | Resistencia 1 kΩ ¼ W (protege la entrada del botón del manillar) | — | 1 | |
| D3-D6 | Diodo **1N4148** | — | 4 | ≈ 0,40 |
| C2 | Condensador cerámico 1 nF | — | 1 | |
| C3, C4, C5 | Condensador cerámico 100 nF (C5: filtro del botón del manillar) | — | 3 | ≈ 0,65 los cuatro |
| J1, J2 | Borna de tornillo para placa, 3 vías, paso 5,08 mm | **Phoenix Contact MKDS 1,5/3-5,08** (1715734) | 2 | ≈ 1,60 |

### Placa base y caja

| Pieza | Referencia exacta | Cant. | Dónde | € |
| --- | --- | --- | --- | --- |
| Caja estanca IP68 de policarbonato, tapa con pestañas para atornillar (160,8 × 90,8 × 62,5 mm por fuera) | **Hammond 1555F2F42GY** | 1 | [DigiKey HM388-ND](https://www.digikey.es/en/products/result?keywords=1555F2F42GY) | 25,35 |
| Prensaestopas PG7 IP68 (cable de 3-7 mm): cable de la moto, cable de revoluciones y cable de la pantalla | **Hammond 1427NCGPG7B** | 3 | [DigiKey](https://www.digikey.es/en/products/result?keywords=hammond%201427%20PG7) | 7,47 |
| Membrana de ventilación M12 (para que no condense dentro) | **Amphenol LTW VENT-PS1NGY-O8001** | 1 | DigiKey / Mouser | ≈ 5 |
| Placa perforada de doble cara, paso 2,54 mm, 80 × 120 mm (se corta a 100 × 80) | genérica FR4 | 1 | | ≈ 3 |
| Tiras de zócalo hembra de 2,54 mm (una de 16 y una de 12) | p. ej. Adafruit 2886 | 1 juego | | ≈ 1,50 |
| Tira de pines macho de 2,54 mm (para U1, U3, U4 y U5: unos 57 pines) | genérica, 40 pines | 2 | | ≈ 2 |
| Separadores de nylon: 4 **lisos** de 6 mm con agujero de 3,2 mm (placa base: el tornillo de chapa pasa por dentro) y 4 hexagonales M3 macho-hembra de 15 mm (GPS), con tornillos y tuercas M3 | kit de separadores M3 + separadores lisos | 1 | | ≈ 10 |
| Tornillo rosca chapa ST2,9 × 13 mm, cabeza alomada (DIN 7981) | — | 4 | ferretería | ≈ 1 |
| Cable de silicona fino (26 AWG) para la placa, 3 colores | — | 1 | | ≈ 6 |
| Cable Qwiic de 100 mm (solo para las pruebas de banco: uno de la placa al GPS y otro del GPS al sensor; luego uno sirve para la pantalla) | **SparkFun PRT-17259** | 2 | DigiKey | 4,18 |

**Subtotal de la caja: ≈ 305 €** (sin el material de instalación).

---

## 2. Unidad de pantalla

**Se compra más adelante**, después de la caja. Es una pantalla **tipo navegador de moto**: en color, 4,3", 1000 nits y antirreflejos, alimentada **por cable desde la caja** (12 V que se encienden con el contacto). No lleva batería. Por qué esta y no las otras, en el [plan, apartado 5.2](../../docs/caja-diy.md#52-qué-pantalla). Conexiones en el [apartado 6 de conexiones](conexiones.md#6-unidad-de-pantalla).

| Ref. | Pieza | Referencia exacta | Cant. | Dónde | € |
| --- | --- | --- | --- | --- | --- |
| U11 | Placa ESP32-S3 | **SparkFun Thing Plus ESP32-S3** (WRL-24408) | 1 | [DigiKey](https://www.digikey.es/en/products/detail/sparkfun-electronics/24408/22606864) | 30,14 |
| U12 | Pantalla IPS 4,3", 480 × 272, 1000 cd/m², antirreflejos, chip gráfico BT817 (EVE4) por SPI, **con marco de 4 orejetas** | **Riverdi RVT43HLBFWN00** | 1 | RS (la versión sin marco, RVT43HLBNWN00, está a 83,20 €) o [Riverdi](https://riverdi.com/?p=111570) | ≈ 85 |
| — | Adaptador del conector RiBUS (20 vías a 0,5 mm) a pines de 2,54 mm, **con su cable plano de 15 cm** | **Riverdi Break Out Board 20** | 1 | RS (634-768) | ≈ 5 |
| U13 | Tira de 8 LEDs RGB | **Adafruit NeoPixel Stick 8 × 5050** (1426) | 1 | [Kiwi](https://www.kiwi-electronics.com/en/neopixel-stick-8x-5050-rgb-led-with-integrated-drivers-7316) | 6,64 |
| U14 | Sensor de luz, 0-120.000 lux | **Adafruit VEML7700** (4162) | 1 | Kiwi / DigiKey | ≈ 6 |
| U16 | Regulador 12 V → 5 V, 1 A, hasta 36 V | **Pololu D24V10F5** (2831) | 1 | DigiKey | ≈ 11 |
| U17 | 4 adaptadores de nivel 3,3 → 5 V, DIP-14 (la señal de los LEDs) | **TI SN74AHCT125N** | 1 | DigiKey | ≈ 0,60 |
| D11 | Diodo TVS 1500 W, 18,8 V | **1.5KE22A** | 1 | DigiKey | ≈ 1,14 |
| D12 | Diodo Schottky 1 A | **1N5819** | 1 | DigiKey | ≈ 0,40 |
| C12 | Condensador electrolítico 47 µF, 50 V | genérico, radial | 1 | DigiKey | ≈ 0,40 |
| C11 | Condensador electrolítico 100 µF, 10 V (en la tira de LEDs) | — | 1 | | |
| C13 | Condensador cerámico 100 nF (junto a U17) | — | 1 | | |
| R11 | Resistencia 470 Ω ¼ W | — | 1 | | ≈ 1,20 los tres |
| SW1, SW2 | Pulsador estanco IP67, 16 mm, metálico | **BricoGeek CPM-0133** | 2 | [BricoGeek](https://tienda.bricogeek.com/pulsadores-y-teclados/1454-pulsador-16mm-ip67.html) | 3,88 |
| — | Cable Qwiic de 100 mm | **SparkFun PRT-17259** | 1 | uno de los dos de las pruebas de banco | — |
| — | Placa perforada pequeña (unos 50 × 70 mm), zócalos hembra (16 + 12) y pines macho para U11 | genéricos | 1 | | ≈ 4,50 |
| — | Manguera de 3 hilos de 0,5 mm² (LiYY 3 × 0,5; marrón, blanco y verde), de la caja al manillar. Con la Riverdi, el verde no se usa | — | 2 m | | ≈ 3,50 |
| — | Conector estanco IP68 de 2 vías, macho y hembra de cable (para quitar la pantalla del soporte) | **SP13** de 2 pines | 1 par | Amazon | ≈ 7 |
| — | Prensaestopas PG7 IP68 (entrada del cable en la carcasa) | **Hammond 1427NCGPG7B** | 1 | DigiKey | 2,49 |
| — | Insertos de latón M3 para plástico impreso (se meten con el soldador) y tornillos M3 inox de 6-10 mm | genéricos | 1 juego | Amazon | ≈ 6 |
| — | Tira de policarbonato transparente de 2 mm (ventanas de los LEDs y del sensor de luz) | — | 1 | | ≈ 2 |
| — | Adaptador Quad Lock adhesivo (no el MAG) | **Quad Lock Universal Adaptor, Original** | 1 | [quadlockcase.eu](https://www.quadlockcase.eu/products/universal-adapter) | 24,99 |
| — | Chapa de aluminio de 2 mm, 80 × 60 mm, con 4 tornillos M3 × 8 inox y arandelas de nylon | — | 1 | ferretería | ≈ 6 |

La carcasa se imprime en ASA, con la junta del frente en TPU ([impresion.md](impresion.md), pieza 7). El filamento es de casa.

Notas:
- **U12**: la versión **con marco** (la F de RVT43HL**B**F...) trae 4 orejetas con agujeros de 3,5 mm, a 88,3 × 76,5 mm entre centros, para atornillarla firme a la carcasa. Mide 106,3 × 84 mm con las orejetas y 9 mm de grueso, y pesa 95 g. Gasta 3,3 V para la electrónica y 5 V para la luz (hasta 268 mA al 100 %).
- **Break Out Board 20**: trae el cable plano adecuado (contactos del mismo lado). **Usa ese cable**: uno del tipo contrario invierte las patillas y metería 5 V donde no debe.
- **U16** da 1 A. Alcanza si el firmware limita el brillo de los LEDs a la mitad (a tope y en blanco pedirían 0,5 A ellos solos). Si se quisiera más margen, el Pololu D24V22F5 da 2,5 A, pero cuesta el doble y suele estar racionado.
- **SW1, SW2**: el IP67 lo dice la tienda. La opción de marca es el **C&K ATP16DL1000B4SA04G** (IP67, botón abombado, mejor con guantes), a ≈ 26 € cada uno en DigiKey.
- **Quad Lock**: el adhesivo (3M VHB) pega en metal sin pintar, pero no en plástico impreso con textura. Por eso va sobre la chapa de aluminio, atornillada a la carcasa con insertos. Entre el soporte y la pantalla va tu amortiguador de vibraciones. La unidad entera pesa unos 250 g: comprueba que tu amortiguador la admite.

**Subtotal de la pantalla: ≈ 207 €.**

---

## 3. Material de instalación

Lo genérico para conectar la caja a la moto. Si ya tienes parte, resta.

| Pieza | Cant. | € |
| --- | --- | --- |
| Manguera de 4 hilos de 0,5 mm² (LiYY 4 × 0,5; colores marrón, blanco, verde y amarillo) | 2 m | ≈ 5 |
| Cable apantallado de 2 × 0,25 mm² (LiYCY 2 × 0,25) para las revoluciones | 2 m | ≈ 5 |
| Terminal de ojal aislado rojo (0,5-1,5 mm²), agujero de 5,3 mm (M5) para los bornes de la batería | 2 | ≈ 1 |
| Empalme a tope aislado rojo (une el portafusibles al cable marrón) | 1 | |
| Derivación **Posi-Tap** de la talla del cable de la moto (las rojas son para 20-22 AWG; mide el cable antes) | 2 | ≈ 8 |
| Chapita de acero de unos 7 × 7 cm, bajo la antena (el imán se agarra y mejora la recepción) | 1 | ≈ 2 |
| Termorretráctil con adhesivo, surtido | 1 | ≈ 8 |
| Cinta autovulcanizante de 19 mm (cubre las derivaciones y sujeta la pinza de revoluciones) | 1 rollo | ≈ 4 |
| Tubo corrugado partido de 7 mm | 2 m | ≈ 4 |
| Funda de fibra de vidrio de 6 mm, para el tramo de la pinza cerca del motor | 30 cm | ≈ 4 |
| Bridas negras resistentes al sol, de 3,6 mm | 1 bolsa | ≈ 3 |
| Cierre **3M Dual Lock SJ3550** de 25 mm (más firme que el velcro). Se usan unos 45 cm: 4 tiras de 8 cm para la caja (2 en la caja y sus compañeras en la moto) y 2 de 5 cm para la antena | 1 m | ≈ 12 |

Si la bandeja de la moto es de polipropileno («PP» por detrás), el adhesivo pega mal: añade **imprimación 3M Primer 94** o sujeta la caja con tornillos.

**Subtotal: ≈ 56 €.**

**De casa** (no van en la lista): alcohol isopropílico para limpiar antes de pegar, cinta de doble cara, un poco de cinta de espuma, silicona neutra, un rotulador permanente y un cable USB-C de datos para conectar la placa al Mac.

---

## 4. Herramientas

Solo si te faltan.

| Herramienta | Para qué | € |
| --- | --- | --- |
| Soldador con temperatura regulable (Pinecil V2 o similar) con punta cónica fina | Todo lo de la placa | 30-45 |
| Estaño de 0,8 mm con alma de flux y un rotulador de flux | | ≈ 12 |
| Malla desoldadora y soporte con estropajo de latón | Corregir errores | ≈ 8 |
| Multímetro que pite en continuidad | Comprobar cada conexión y buscar los cables de la moto | 15-25 |
| Pelacables automático y alicate de corte al ras | | ≈ 20 |
| Crimpadora de trinquete para terminales aislados | Ojales y empalmes | ≈ 20 |
| Pistola de aire caliente | Termorretráctil | ≈ 20 |
| Taladro con broca escalonada (4-20 mm) | Agujeros de la caja | ≈ 10 la broca |
| Cuchillo de corte y regla metálica | Cortar la placa perforada (rayar por las dos caras y partir) | |
| Fuente de 12 V y 1 A con adaptador de clavija a bornas | Probar la caja en la mesa sin la moto | ≈ 10 |

---

## 5. Resumen y versión ahorro

| Parte | Fase | Recomendado |
| --- | --- | --- |
| Caja: electrónica, alimentación, entradas, placa y caja | 1 y 2 | ≈ 305 € |
| Material de instalación | 1 y 2 | ≈ 56 € |
| Unidad de pantalla | 4 | ≈ 207 € |
| **Total** | **1 + 2 + 4** | **≈ 570 €** |
| Herramientas, si faltan | | ≈ 150 € |

Lo que es solo de la fase 2 (freno y revoluciones) cuesta unos 15 €: los componentes, el cable apantallado, una derivación y la funda. Casi todo el dinero está en la caja y en la pantalla.

**El presupuesto del plan (175-275 €) se quedaba corto.** Al cerrar las piezas exactas salen más caros:
- el GPS de 25 Hz;
- la alimentación protegida para la moto;
- la caja estanca de marca;
- la segunda placa y el adaptador Quad Lock;
- y el material de instalación, que no estaba contado.

**Versión ahorro** (≈ 440 €). Cambios que funcionan, con lo que se pierde en cada uno:

| Cambio | Ahorro | Qué pierdes |
| --- | --- | --- |
| GPS **SparkFun MAX-M10S** (GPS-18037, 49,36 € en DigiKey) en vez del NEO-M9N | ≈ 33 € | 10 Hz con varias constelaciones en vez de 25 Hz. Se alimenta a 3,3 V: su `3V3` va al `3V3` de U1 y no se usa su `5V` (no tiene). Tiene PPS |
| Antena **Quectel YG0035AA** en vez de la de SparkFun | ≈ 11 € | Nada importante (comprobar que funciona a 3,3 V) |
| Latiguillo SMA genérico | ≈ 15 € | Nada |
| Regulador **Pololu D24V10F5** (5 V 1 A, hasta 36 V, ≈ 11 €) en vez del D36V28F5 | ≈ 18 € | Margen frente a picos: aguanta 36 V frente a los 30,6 V del TVS. Sin protección de polaridad propia (la pone U4) |
| Placa **Seeed XIAO ESP32S3** (≈ 8,53 € en Kiwi) en la pantalla | ≈ 22 € | Una placa distinta en cada unidad, con patillas distintas a las de [conexiones.md](conexiones.md) |
| Material de instalación que ya tengas | 20-40 € | |

Como referencia, una RaceBox Mini S cuesta unos 270-280 € y no mide revoluciones ni freno, ni tiene pantalla.
