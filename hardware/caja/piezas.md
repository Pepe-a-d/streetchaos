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
| D3-D6 | Diodo **1N4148** | — | 4 | ≈ 0,40 |
| C2 | Condensador cerámico 1 nF | — | 1 | |
| C3, C4 | Condensador cerámico 100 nF | — | 2 | ≈ 0,50 los tres |
| J1, J2 | Borna de tornillo para placa, 3 vías, paso 5,08 mm | **Phoenix Contact MKDS 1,5/3-5,08** (1715734) | 2 | ≈ 1,60 |

### Placa base y caja

| Pieza | Referencia exacta | Cant. | Dónde | € |
| --- | --- | --- | --- | --- |
| Caja estanca IP68 de policarbonato, tapa con pestañas para atornillar (160,8 × 90,8 × 62,5 mm por fuera) | **Hammond 1555F2F42GY** | 1 | [DigiKey HM388-ND](https://www.digikey.es/en/products/result?keywords=1555F2F42GY) | 25,35 |
| Prensaestopas PG7 IP68 (cable de 3-7 mm) | **Hammond 1427NCGPG7B** | 2 | [DigiKey](https://www.digikey.es/en/products/result?keywords=hammond%201427%20PG7) | 4,98 |
| Membrana de ventilación M12 (para que no condense dentro) | **Amphenol LTW VENT-PS1NGY-O8001** | 1 | DigiKey / Mouser | ≈ 5 |
| Placa perforada de doble cara, paso 2,54 mm, 80 × 120 mm (se corta a 100 × 80) | genérica FR4 | 1 | | ≈ 3 |
| Tiras de zócalo hembra de 2,54 mm (una de 16 y una de 12) | p. ej. Adafruit 2886 | 1 juego | | ≈ 1,50 |
| Tira de pines macho de 2,54 mm (para U1, U3, U4 y U5: unos 57 pines) | genérica, 40 pines | 2 | | ≈ 2 |
| Separadores de nylon M3: 4 de 6 mm (placa base) y 4 de 15 mm (GPS), con tornillos y tuercas M3 | kit de separadores M3 | 1 | | ≈ 10 |
| Tornillo rosca chapa ST2,9 × 13 mm, cabeza alomada (DIN 7981) | — | 4 | ferretería | ≈ 1 |
| Cable de silicona fino (26 AWG) para la placa, 3 colores | — | 1 | | ≈ 6 |
| Cable Qwiic de 100 mm (solo para las pruebas de banco; con el de la pantalla son dos) | **SparkFun PRT-17259** | 1 | DigiKey | 2,09 |

**Subtotal de la caja: ≈ 300 €** (sin el material de instalación).

---

## 2. Unidad de pantalla

| Ref. | Pieza | Referencia exacta | Cant. | Dónde | € |
| --- | --- | --- | --- | --- | --- |
| U11 | Placa ESP32-S3 | **SparkFun Thing Plus ESP32-S3** (WRL-24408) | 1 | [DigiKey](https://www.digikey.es/en/products/detail/sparkfun-electronics/24408/22606864) | 30,14 |
| U12 | Pantalla reflectiva 2,7", 400 × 240, se ve al sol | **Adafruit SHARP Memory Display 2.7"** (4694) | 1 | [Opencircuit](https://opencircuit.shop/product/adafruit-sharp-memory-display-breakout-2.7) (10-12 días) o [DigiKey](https://www.digikey.es/es/products/detail/adafruit-industries-llc/4694/13157994) (48,28 €, plazo 18 semanas) | 63,25 |
| U13 | Tira de 8 LEDs RGB | **Adafruit NeoPixel Stick 8 × 5050** (1426) | 1 | [Kiwi](https://www.kiwi-electronics.com/en/neopixel-stick-8x-5050-rgb-led-with-integrated-drivers-7316) | 6,64 |
| U14 | Sensor de luz, 0-120.000 lux | **Adafruit VEML7700** (4162) | 1 | Kiwi / DigiKey | ≈ 6 |
| U15 | Interruptor electrónico para los LEDs, 2,2-16 V | **Pololu Mini Pushbutton Power Switch LV** (2808) | 1 | DigiKey | 6,03 |
| BT1 | Batería LiPo 1S 2000 mAh con protección, JST-PH (60 × 36 × 7 mm) | **Adafruit 2011** | 1 | Kiwi / DigiKey | ≈ 15 |
| SW1, SW2 | Pulsador estanco IP67, 16 mm, metálico | **BricoGeek CPM-0133** | 2 | [BricoGeek](https://tienda.bricogeek.com/pulsadores-y-teclados/1454-pulsador-16mm-ip67.html) | 3,88 |
| — | Cable Qwiic de 100 mm | **SparkFun PRT-17259** | 1 | DigiKey | 2,09 |
| R11 | Resistencia 470 Ω ¼ W | — | 1 | | |
| C11 | Condensador electrolítico 100 µF, 10 V (no más grande: ver [conexiones](conexiones.md#6-unidad-de-pantalla)) | — | 1 | | ≈ 1 los dos |
| — | Caja con tapa transparente (105 × 75 × 40 mm por fuera) | **Hammond RP1085C** | 1 | [DigiKey](https://www.digikey.es/es/products/detail/hammond-manufacturing/RP1085C/2570599) | 15,67 |
| — | Adaptador Quad Lock adhesivo (no el MAG) | **Quad Lock Universal Adaptor, Original** | 1 | [quadlockcase.eu](https://www.quadlockcase.eu/products/universal-adapter) | 24,99 |
| — | Chapa de aluminio de 2 mm, 80 × 60 mm, con 4 tornillos M3 × 8 inox, arandelas de nylon y tuercas | — | 1 | ferretería | ≈ 6 |
| — | Placa soporte de metacrilato de 3 mm (96 × 66 mm) y separadores M2,5 de 10 mm (8, dos por esquina de la pantalla) con tornillos | — | 1 | | ≈ 6 |
| — | Prolongador USB-C de panel, estanco (IP67) y con tapa: hembra en la pared, macho a la placa, 20-30 cm | genérico | 1 | Amazon | ≈ 10 |
| — | Vinilo negro opaco (máscara alrededor de la pantalla) | — | 1 | | ≈ 2 |

Notas:
- **U12** está agotada en Adafruit; las tiendas europeas la traen bajo pedido. Pídela la primera: es la pieza que más tarda. La de 1,3" (Adafruit 3502) sí se encuentra, pero es demasiado pequeña para leerla en marcha.
- **SW1, SW2**: el IP67 lo dice la tienda. La opción de marca es el **C&K ATP16DL1000B4SA04G** (IP67, botón abombado, mejor con guantes), a ≈ 26 € cada uno en DigiKey.
- **BT1**: comprueba la polaridad con el multímetro antes de enchufarla. Las baterías de otras marcas pueden traer el conector al revés, y eso quema la placa. Las de Adafruit y SparkFun son compatibles.
- **Quad Lock**: el adhesivo (3M VHB) pega en policarbonato, ABS y metal sin pintar, pero no en superficies con textura. Por eso va sobre la chapa de aluminio atornillada a la caja. Entre el soporte y la pantalla va tu amortiguador de vibraciones.

**Subtotal de la pantalla: ≈ 199 €.**

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
| Tubo corrugado partido de 7 mm | 2 m | ≈ 4 |
| Funda de fibra de vidrio de 6 mm, para el tramo de la pinza cerca del motor | 30 cm | ≈ 4 |
| Bridas negras resistentes al sol, de 3,6 mm | 1 bolsa | ≈ 3 |
| Cierre **3M Dual Lock SJ3550** de 25 mm (más firme que el velcro) | 30 cm | ≈ 12 |

Si la bandeja de la moto es de polipropileno («PP» por detrás), el adhesivo pega mal: añade **imprimación 3M Primer 94** o sujeta la caja con tornillos.

**Subtotal: ≈ 52 €.**

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
| Caja: electrónica, alimentación, entradas, placa y caja | 1 y 2 | ≈ 300 € |
| Material de instalación | 1 y 2 | ≈ 52 € |
| Unidad de pantalla | 4 | ≈ 199 € |
| **Total** | **1 + 2 + 4** | **≈ 550 €** |
| Herramientas, si faltan | | ≈ 150 € |

Lo que es solo de la fase 2 (freno y revoluciones) cuesta unos 15 €: los componentes, el cable apantallado, una derivación y la funda. Casi todo el dinero está en la caja y en la pantalla.

**El presupuesto del plan (175-275 €) se quedaba corto.** Al cerrar las piezas exactas salen más caros:
- el GPS de 25 Hz;
- la alimentación protegida para la moto;
- la caja estanca de marca;
- la segunda placa y el adaptador Quad Lock;
- y el material de instalación, que no estaba contado.

**Versión ahorro** (≈ 410 €). Cambios que funcionan, con lo que se pierde en cada uno:

| Cambio | Ahorro | Qué pierdes |
| --- | --- | --- |
| GPS **SparkFun MAX-M10S** (GPS-18037, 49,36 € en DigiKey) en vez del NEO-M9N | ≈ 33 € | 10 Hz con varias constelaciones en vez de 25 Hz. Se alimenta a 3,3 V: su `3V3` va al `3V3` de U1 y no se usa su `5V` (no tiene). Tiene PPS |
| Antena **Quectel YG0035AA** en vez de la de SparkFun | ≈ 11 € | Nada importante (comprobar que funciona a 3,3 V) |
| Latiguillo SMA genérico | ≈ 15 € | Nada |
| Regulador **Pololu D24V10F5** (5 V 1 A, hasta 36 V, ≈ 11 €) en vez del D36V28F5 | ≈ 18 € | Margen frente a picos: aguanta 36 V frente a los 30,6 V del TVS. Sin protección de polaridad propia (la pone U4) |
| Pantalla de DigiKey esperando el plazo | ≈ 15 € | Tiempo |
| Placa **Seeed XIAO ESP32S3** (≈ 8,53 € en Kiwi) en la pantalla | ≈ 22 € | Medidor de batería (hay que poner un divisor de tensión) y conector de batería (soldar a sus pads). Pines distintos a los de [conexiones.md](conexiones.md) |
| Material de instalación que ya tengas | 20-40 € | |

Como referencia, una RaceBox Mini S cuesta unos 270-280 € y no mide revoluciones ni freno, ni tiene pantalla.
