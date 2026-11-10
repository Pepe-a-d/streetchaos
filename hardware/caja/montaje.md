# Montaje paso a paso

Del pedido a la primera salida. Cada parte se prueba antes de pasar a la siguiente: si algo falla, sabes que está en lo último que has hecho. Las piezas están en [piezas.md](piezas.md) y las conexiones en [conexiones.md](conexiones.md).

- [0. Antes de empezar](#0-antes-de-empezar)
- [1. Pruebas de banco, sin soldar](#1-pruebas-de-banco-sin-soldar)
- [2. La placa base](#2-la-placa-base)
- [3. La caja](#3-la-caja)
- [4. El cable de la moto](#4-el-cable-de-la-moto)
- [5. Instalación en la Ninja 125](#5-instalación-en-la-ninja-125)
- [6. Revoluciones (fase 2)](#6-revoluciones-fase-2)
- [7. Unidad de pantalla (fase 4)](#7-unidad-de-pantalla-fase-4)
- [8. Comprobaciones antes de rodar](#8-comprobaciones-antes-de-rodar)
- [9. Mantenimiento](#9-mantenimiento)

Tiempo aproximado, sin contar esperas:
- pruebas de banco: 1 tarde;
- placa base: 2-3 tardes;
- caja y cable: 1 tarde;
- instalación en la moto: 1 mañana;
- revoluciones: 2 h;
- pantalla: 2 tardes.

---

## 0. Antes de empezar

### 0.1 El pedido

1. **Pide primero la pantalla** (Adafruit 4694): es la que más tarda.
2. Haz un pedido en DigiKey con todo lo que lleve referencia de DigiKey en [piezas.md](piezas.md).
3. El resto: Kiwi (LEDs, sensor de luz, batería), BricoGeek (pulsadores), Quad Lock (adaptador), y Amazon o una tienda para la microSD y el material genérico.

### 0.2 Busca el sitio en la moto

La caja mide **160,8 × 90,8 × 62,5 mm** contando las pestañas.

1. **Haz una maqueta de cartón** de ese tamaño.
2. **Pruébala debajo de los asientos.** Busca, en este orden:
   1. **bajo el asiento del pasajero**: atrás, lejos del calor del motor;
   2. **junto a la batería**, bajo el asiento del piloto;
   3. **en el colín**, sobre el guardabarros.
3. **Comprueba estas cuatro cosas en el sitio que elijas:**
   - la caja queda **plana** y con el lado largo a lo largo de la moto;
   - **el asiento cierra** sin apretarla;
   - está **lejos del escape** y de cualquier pieza que se mueva;
   - hay una superficie plana y limpia para pegarla, o un tubo del chasis o un soporte cerca para las bridas.
4. **Busca también el sitio de la antena** (50 × 38 × 17 mm):
   - mirando al cielo, bajo plástico (el asiento del pasajero o el colín), nunca bajo metal;
   - a **más de 20 cm de la caja**: la radio de la placa mete ruido al GPS;
   - **que no quede debajo de ti**: el cuerpo tapa la señal.
5. **Si no cabe en ninguno**, para aquí y dímelo con las medidas del hueco: cambiamos a una caja más estrecha (Hammond 1555C2F42GY, 120 × 66 mm) y rehago la placa.

### 0.3 Normas de seguridad

1. **Desconecta el negativo de la batería** antes de empalmar nada en la moto.
2. **No cortes ningún cable de la moto**: solo derivaciones (Posi-Tap) o terminales bajo un tornillo que ya existe.
3. **El fusible, a menos de 15 cm de la batería.**
4. **Nada cerca del escape, del radiador, de la cadena ni de la dirección.**
5. **Con el manillar girado a tope a cada lado**, ningún cable tira ni se pilla.
6. **Después de cada cambio, comprueba:** luz de posición, luz de freno con la maneta y con el pedal, intermitentes, claxon y arranque.
7. **Al soldar:** gafas, ventilación y el soldador siempre en su soporte.

---

## 1. Pruebas de banco, sin soldar

Antes de soldar nada, comprueba que cada pieza funciona. Todo se conecta con cables Qwiic, que son de enchufar. Es el hito **H1** del plan.

### 1.1 Programas

1. Instala **Arduino IDE 2** en el Mac.
2. En *Boards Manager*, instala **esp32 de Espressif**.
3. Elige la placa **SparkFun ESP32-S3 Thing Plus**, con *USB CDC On Boot* en *Enabled*.
4. En *Library Manager*, instala:
   - **SparkFun u-blox GNSS v3**;
   - **Adafruit LSM6DS**;
   - **Adafruit SHARP Memory Display**;
   - **Adafruit NeoPixel**;
   - **Adafruit VEML7700**.

### 1.2 La placa y la microSD

1. Formatea la microSD en FAT32 desde el Mac (Utilidad de Discos, «MS-DOS (FAT)»).
2. Métela en la placa y conéctala al Mac por USB-C.
3. Carga el ejemplo de la tarjeta del repositorio de SparkFun (`SparkFun_Thing_Plus_ESP32-S3`, carpeta `Firmware`, ejemplos `SD_*`).
4. En el monitor serie tiene que salir el tamaño de la tarjeta y un archivo escrito y leído.

### 1.3 El GPS

1. Enrosca la antena en el conector SMA del GPS, a mano.
2. Une la placa y el GPS con un cable Qwiic.
3. Carga el ejemplo básico de posición de la librería de u-blox (*Example1*).
4. Pon la antena en una ventana o, mejor, en la calle.

En menos de un minuto tiene que dar posición con más de 8 satélites. El LED `PPS` del GPS parpadea una vez por segundo cuando tiene posición.

### 1.4 El sensor de movimiento

1. Enchufa el sensor en el segundo conector Qwiic del GPS: van en cadena.
2. Carga el ejemplo `adafruit_ism330dhcx_test`.

Encima de la mesa, el eje Z tiene que dar unos +9,8 m/s² y los giros, casi 0. Inclínalo y comprueba que los números cambian.

**Si las tres pruebas van bien, todo el material está bien.** Desde aquí, el programa de verdad lo escribo yo: primero el de banco, que graba en bruto.

---

## 2. La placa base

![Distribución de la placa base](esquemas/placa-base.svg)

### 2.1 Cortar y agujerear

1. **Corta la placa perforada a 100 × 80 mm.** Raya por las dos caras con el cuchillo y la regla, siguiendo una fila de agujeros, y pártela sobre el borde de la mesa. Lija el canto.
2. **Haz 4 agujeros de 3,2 mm** para sujetarla a la tapa de la caja. Van a 11,5 mm de los lados cortos y a 6 mm de los largos: 77 mm entre ellos a lo largo y 68 mm a lo ancho. Coinciden con 4 de los 6 agujeros que trae la tapa por dentro.
3. **Preséntala en la tapa** con los separadores de 6 mm y comprueba que encaja sin tocar las columnas de las esquinas.

### 2.2 Presentar antes de soldar

Coloca todas las piezas sobre la placa según el [dibujo](esquemas/placa-base.svg), sin soldar, y comprueba:

- **El GPS va sobre separadores de 15 mm**, por encima de las demás piezas, con su **conector SMA hacia dentro** de la placa, nunca contra la pared. El latiguillo tiene que poder ir del conector al pasamuros sin doblarse en seco.
- **El sensor de movimiento (U3)** va en el centro, entre los cuatro tornillos, que es donde menos vibra la placa. Su flecha X apunta hacia el lado de las bornas (será «adelante» en la moto).
- **Las bornas J1 y J2**, en el lado corto de la izquierda, que es donde entrarán los cables.
- **El USB-C de la placa U1** queda accesible al quitar la tapa.

Marca la posición de cada pieza con un rotulador.

### 2.3 Zócalos de la placa U1

1. **Suelda las tiras de pines macho a U1** (la Thing Plus), con los pines hacia abajo.
2. **Los zócalos hembra, usando la propia U1 de plantilla:**
   - pincha los zócalos en sus pines y pon el conjunto sobre la placa perforada, en su sitio;
   - suelda una patilla de cada esquina y comprueba que todo queda recto;
   - suelda el resto.
3. **Saca U1** y déjala aparte hasta la prueba 2.6.

### 2.4 Alimentación

Suelda J1, D1, U4 (sobre pines macho), C1, U5 (sobre pines macho), D2, R3, R8, R9 y C4. Une las redes `12V`, `GND`, `CONT` (por ahora solo J1-3 y R3), `ON`, `12V_SW`, `5V_REG`, `5V` y `VMOTO` de la [lista de conexiones](conexiones.md#4-lista-de-conexiones-de-la-placa-base) con hilo por la cara de abajo.

Fíjate en el sentido de tres piezas:

| Pieza | Sentido |
| --- | --- |
| D1 (TVS) | La raya va a `12V` |
| D2 | La raya va a `5V` |
| C1 | La pata corta (−) va a `GND` |

**Prueba 1**, con la fuente de 12 V y sin U1 ni el GPS:

1. **Comprueba con el multímetro:**
   - en continuidad, **no tiene que pitar** entre `12V` y `GND`, ni entre `5V` y `GND`. Un pitido corto al principio es un condensador cargándose: normal;
   - en modo diodo, con la punta roja en `12V` y la negra en `GND`, tiene que marcar «OL». Si marca ~0,6 V, D1 está al revés.
2. Conecta la fuente a J1-1 (+) y J1-2 (−).
   - En `12V_SW` (la salida de U4) tiene que haber **0 V**: el interruptor está apagado.
3. Une con un cable **J1-3 a J1-1** para simular el contacto.
   - `12V_SW` ≈ 12 V.
   - `5V_REG` = 5,0 V.
   - `5V` ≈ 4,7-4,9 V.
   - `VMOTO` ≈ 2,2 V.
4. **Quita ese cable**: todo tiene que seguir encendido, porque el interruptor se queda enclavado.
5. Toca un instante la patilla `OFF` de U4 con un cable que venga de `5V`: **todo se apaga** (0 V).

Si algo no sale, no sigas: repasa esa parte.

### 2.5 Entradas

- **Contacto y freno:** U6, U7, R1, R2, R4, R5, D3 y D4.
- **Revoluciones:** U8, R6, R7, R10, D5, D6, C2 y C3, y J2.
- **Patillas sin usar del 74HC14:** une a `GND` las entradas 3, 5, 9, 11 y 13. Es importante: al aire, el chip hace cosas raras.

### 2.6 Prueba de las entradas

1. Pincha U1 en sus zócalos y conéctala al Mac por USB: se alimenta por ahí.
   - Mide los puntos `IGN` (patilla 6) y `BRK` (patilla 7): **3,3 V** los dos.
2. Conecta además la fuente de 12 V y une J1-3 a J1-1.
   - `IGN` baja a **menos de 0,4 V**.
3. Une J2-1 a J1-1.
   - `BRK` baja a menos de 0,4 V.
4. Toca J2-2 con un cable que venga de `3V3`.
   - Mide en la patilla `1` de U1 (la patilla 2 de U8 queda debajo de la placa): pasa de 3,3 V a 0 V. Al soltar, vuelve a 3,3 V.

### 2.7 El sensor de movimiento

1. Suelda las dos tiras de pines al sensor (U3): la de 9 abajo y la de 5 arriba.
2. **Suéldalo a la placa pegado a ella**, con la base de plástico de los pines apoyada.
   - Que no quede en el aire: cuanto más rígido, mejores las medidas.
   - La fila de 5 pines no lleva conexiones; solo sujeta.
3. Une `3V3`, `GND`, `SDA`, `SCL` e `INT1`.

### 2.8 El GPS

1. Pon los 4 separadores de 15 mm.
2. Prepara 5 hilos de silicona de unos 8 cm.
3. Suéldalos directamente en los agujeros del GPS:
   - `5V`, `GND`, `TX` y `RX` en la fila de arriba;
   - `PPS` en la fila de abajo.
4. Suelda el otro extremo de cada hilo a su red de la placa:
   - `TX` del GPS a `RX` de U1;
   - `RX` del GPS a `TX` de U1.
5. Atornilla el GPS a los separadores.

Nada de cables Dupont dentro de la caja: con las vibraciones se sueltan.

### 2.9 Repaso final

1. **Repasa la lista de conexiones entera con el multímetro**, red por red.
2. **Comprueba que no hay cortos** entre `12V`, `5V`, `3V3` y `GND`.
3. **Mira las soldaduras con la lupa o el móvil.**
   - Tienen que ser brillantes y en forma de cono.
   - Ni bolas ni puentes entre agujeros vecinos.
4. **Prueba completa:** fuente de 12 V y J1-3 unido a J1-1.
   - Se enciende el LED de U1.
   - El GPS da posición junto a la ventana.
   - Con el programa de banco: graba en la microSD.

---

## 3. La caja

![Agujeros de la caja y anclaje](esquemas/caja-taladros.svg)

La **tapa** de la Hammond 1555F2F42GY es la que lleva las pestañas: es la base, la que se sujeta a la moto, y la placa va atornillada en ella. El **cuerpo** es la tapa de arriba y se quita con 4 tornillos.

### 3.1 Agujeros en el cuerpo

Medidas en el [dibujo](esquemas/caja-taladros.svg). Taladra despacio con la broca escalonada y quita las rebabas.

| Dónde | Agujero | Para |
| --- | --- | --- |
| Pared corta delantera, a 32 mm del suelo de la caja montada, a 22 mm a cada lado del centro | 2 × Ø 12,5 mm | Prensaestopas PG7 (cable de la moto y cable de revoluciones) |
| Pared corta delantera, en el centro, a 32 mm del suelo | Ø 12,2 mm | Membrana de ventilación |
| Pared corta trasera, en el centro, a 40 mm del suelo | Ø 6,5 mm (compruébalo con el pasamuros) | Pasamuros SMA de la antena |

El «suelo» es la cara de abajo de la tapa con pestañas.

A esas alturas los agujeros quedan en el cuerpo, por encima de la unión con la tapa (a unos 16 mm del suelo; mídela en tu caja). El pasamuros va más alto que los prensaestopas para pasar por encima del GPS.

**Nunca en la cara de arriba**: el agua se queda encima.

### 3.2 Montar los pasacables

1. **Prensaestopas:** con la tuerca por dentro.
2. **Pasamuros SMA:** la junta tórica por fuera y la tuerca por dentro.
3. **Membrana de ventilación:** con su tuerca por dentro.

Apriétalos firmes, pero sin pasarte: el policarbonato se agrieta.

### 3.3 La placa en la tapa

1. Atornilla la placa base a la tapa: 4 tornillos ST2,9 × 13, cada uno con su separador de 6 mm.
2. Conecta el latiguillo del conector SMA del GPS al pasamuros. A mano, más 1/8 de vuelta.
3. Mete la microSD.

### 3.4 Rotular

En la cara de arriba del cuerpo, con rotulador permanente o una pegatina:
- una **flecha «ADELANTE»** hacia la pared de los prensaestopas;
- **«FUSIBLE 2 A»**.

### 3.5 Cerrar

1. Comprueba que la junta de silicona está bien asentada en su ranura.
2. Aprieta los 4 tornillos M4 en cruz, con poca fuerza: el fabricante dice 30 cN·m, que es justo «firme» a mano con un destornillador pequeño.

---

## 4. El cable de la moto

Se prepara en la mesa, menos las dos derivaciones del piloto trasero.

1. **Mide con un cordel** el recorrido sobre la moto:
   - de la caja a la batería;
   - de la caja al conector del piloto trasero.
   - Añade 15 cm a cada uno.
2. **Corta la manguera de 4 hilos** a la medida más larga.
   - En el punto donde se separan los dos caminos, quita la funda exterior.
   - Cubre la bifurcación con termorretráctil con adhesivo.
   - **Marrón y blanco** van a la batería; **verde y amarillo** al piloto.
3. **Batería:**
   - **Marrón:** empalma a tope uno de los cables del portafusibles. Crimpa y pon termorretráctil con adhesivo encima. En el otro cable del portafusibles, crimpa un terminal de ojal M5.
   - **Blanco:** crimpa directamente un terminal de ojal M5.
   - **No pongas aún el fusible.**
4. **Cable de revoluciones (LiYCY):**
   - **Extremo de la caja:** el hilo blanco a J2-2 y la malla, retorcida, a J2-3. El hilo marrón no se usa: córtalo y aíslalo.
   - **Extremo de la bobina:**
     - quita 30 cm de funda y de malla;
     - corta la malla al ras y aíslala con termorretráctil;
     - el marrón, cortado y aislado;
     - el blanco queda suelto para enrollarlo en la moto (paso 6). Su punta, aislada con un capuchón de termorretráctil.
5. **Resistencias de las derivaciones (RT1 y RT2):**
   - en el extremo del **verde**, a 2-3 cm de la punta, intercala RT1 (1 kΩ ½ W): corta el cable, suelda la resistencia entre los dos trozos y cúbrela con termorretráctil con adhesivo;
   - lo mismo con RT2 en el **amarillo**;
   - la punta corta que queda es la que irá a la Posi-Tap.

   Son el seguro de esos dos cables: si se pelan y tocan masa bajo el asiento, no salta el fusible de las luces de la moto.
6. **Mete los dos cables por los prensaestopas** y conecta en J1 y J2 según la tabla de [conexiones.md](conexiones.md#5-cable-de-la-caja-a-la-moto-ninja-125).
   - Deja 10 cm de holgura dentro, para poder levantar el cuerpo de la caja.
   - Aprieta los prensaestopas.
   - Tira un poco de cada cable: no tiene que moverse.

---

## 5. Instalación en la Ninja 125

### 5.1 Identificar los cables del piloto trasero

Con la batería **conectada** todavía:

1. Quita los asientos y busca el conector del piloto trasero.
   - Suele estar bajo el colín.
   - Tiene 3 cables: posición, freno y masa.
2. Pon el multímetro en tensión continua (20 V) y la punta negra en el **borne − de la batería**.
3. Da el contacto, sin arrancar.
4. Con la punta roja, toca cada cable por detrás del conector: mete la punta junto al cable por la goma, sin pinchar el cable.

| Lo que mides | Qué cable es |
| --- | --- |
| ~12 V con el contacto, sin tocar nada | **Posición** → irá al **verde** (`CONT`) |
| 0 V, y ~12 V solo mientras alguien tira de la maneta o pisa el pedal | **Freno** → irá al **amarillo** (`FRENO`) |
| 0 V siempre | Masa (confírmala en continuidad con el borne − de la batería, con el contacto quitado) |

5. Apunta los colores de cada uno.
6. Quita el contacto: los tres tienen que dar 0 V. Con un piloto de LED puede verse alguna tensión «fantasma» de pocos voltios: lo que cuenta es la diferencia clara entre encendido y apagado.
7. **Si tu llave tiene posición P** (estacionamiento), ponla en P y mide la posición.
   - **Si tiene 12 V:** la caja no se apagaría nunca en P. O no aparcas en P, o tomas el contacto de otro cable que solo tenga 12 V en ON, como la alimentación del interruptor de la luz de freno (en el conector de la maneta delantera).
8. Mide el grosor de los cables de posición y freno para comprar la Posi-Tap de su talla.

**Si la luz de posición no se enciende con el contacto** (no debería pasar en una moto de 2019 o posterior), busca otro cable que tenga 12 V solo con el contacto, por ejemplo el de la luz de matrícula. Mídelo igual.

### 5.2 Desconectar la batería

Quita primero el cable del borne **−** y apártalo para que no toque nada.

### 5.3 Fijar la caja

En el sitio elegido en el paso 0.2:

1. **Limpia con alcohol** la cara de abajo de la tapa y la superficie de la moto.
2. **Pega dos tiras de Dual Lock de 25 × 80 mm** en la caja y sus compañeras en la moto.
   - Presenta la caja: plana y con la flecha **ADELANTE** hacia delante.
   - Aprieta fuerte 30 segundos.
3. **Pon dos bridas por los agujeros de las pestañas** que abracen un tubo del chasis o un soporte.
   - **Lo que sujeta de verdad son las bridas, o los tornillos de la alternativa de abajo.** El Dual Lock asienta la caja y quita holguras.
   - Las bandejas de debajo del asiento suelen ser de polipropileno (por detrás pone «PP»), donde el adhesivo pega mal. Si es tu caso, dale antes una mano de imprimación (3M Primer 94) o usa los tornillos.
4. Deja que el adhesivo coja fuerza: **24 h antes de rodar**.

**Alternativa, si no te importa taladrar la bandeja de plástico:**
- 2 tornillos M4 por los agujeros de las pestañas;
- arandelas anchas por debajo;
- tuercas autoblocantes.

Es lo más firme. Nunca la sujetes con gomas ni con espuma gruesa: si la caja baila, la inclinación y las G salen mal.

### 5.4 La antena

1. **Pégala en el sitio elegido** con Dual Lock o cinta de doble cara.
   - **La base del imán va abajo** y la cara de arriba mira al cielo.
   - Si va sobre plástico, ponle debajo una chapita de acero de unos 7 × 7 cm: el imán se agarra a ella y hace de plano de masa, lo que mejora la recepción.
2. **Lleva el cable hasta la caja**:
   - recoge lo que sobra en una vuelta floja (más de 5 cm de diámetro) y sujétala con bridas, sin apretar;
   - que el asiento no lo pise;
   - que no tenga dobleces en seco.
3. **Enróscalo en el pasamuros**, a mano.

### 5.5 Pasar los cables

1. Lleva la manguera por dentro del tubo corrugado, junto al mazo de cables de la moto.
2. Pon una brida cada 10-15 cm.
3. Comprueba que no roza con nada que se mueva ni toca el escape.

### 5.6 Batería

1. Pon el **ojal del portafusibles (marrón)** en el borne **+**, junto al cable de la moto.
2. Pon el **ojal blanco** en el borne **−**, también junto al cable de la moto.
3. Aprieta los dos tornillos.
4. Sujeta el portafusibles con una brida, a menos de 15 cm de la batería.

### 5.7 Derivaciones del piloto trasero

1. **Verde → cable de posición** con una Posi-Tap:
   1. el cuerpo se pone sobre el cable de la moto;
   2. se enrosca el tapón con el cable verde;
   3. se aprieta a mano.
2. **Amarillo → cable de freno** con la otra.
3. Ponlas donde no les caiga agua directamente y cúbrelas con cinta autovulcanizante.
4. Tira suave de cada cable para comprobar que aguanta.

### 5.8 Conectar y probar

1. **Conecta el borne −** de la batería.
2. **Pon el fusible de 2 A.**
3. **Prueba la moto**:
   - posición encendida con el contacto;
   - freno con la maneta;
   - freno con el pedal;
   - intermitentes;
   - claxon;
   - arranque.
4. **Prueba la caja:**
   - con el contacto se enciende: con el firmware, aparece la red WiFi «StreetChaos-Caja» (el LED no se ve, la caja es opaca);
   - al quitarlo sigue un rato y luego se apaga sola: la red WiFi desaparece.
5. **Comprueba que apagada no gasta nada** (la única prueba de que se corta sola de verdad):
   1. espera a que se apague, con el contacto quitado;
   2. quita el fusible de 2 A;
   3. pon el multímetro en corriente continua (escala de mA) con las puntas en los dos contactos del portafusibles.
   - Tiene que marcar **0** (unos µA como mucho).
   - Si marca decenas de mA, la caja no se ha apagado: no dejes la moto así y dímelo.
   - Pon otra vez el fusible.
6. **Gira el manillar a tope** a los dos lados: nada tira.
7. **Pon los asientos**: cierran sin pillar ningún cable.

---

## 6. Revoluciones (fase 2)

### 6.1 Llegar al cable de bujía

1. **Busca la bobina:**
   - en la Ninja 125 va sujeta al chasis con dos tornillos;
   - de ella sale el cable de bujía hasta una pipa larga en la culata;
   - según dónde quede, puede que haya que quitar el carenado lateral o la tapa del depósito (mira el manual de taller o un vídeo de tu modelo).
2. **Nunca arranques el motor con la pipa quitada**: el pico de tensión puede romper la bobina o la centralita.

### 6.2 Pasar el cable

1. Lleva el cable apantallado de la caja a la bobina **por el chasis**:
   - dentro del tubo corrugado;
   - lejos del escape, del ventilador del radiador y de la dirección;
   - con una brida cada 10-15 cm.
2. **No lo pongas pegado a otros cables en paralelo** si puedes evitarlo.

### 6.3 Enrollar la pinza

1. A unos **5 cm de la bobina**, enrolla el hilo blanco **8-10 vueltas** apretadas sobre el cable de bujía, una junto a otra.
2. Sujétalo con cinta autovulcanizante.
3. Cubre el tramo que queda cerca del motor con la **funda de fibra de vidrio**: el aislante normal no aguanta el calor de la culata.

### 6.4 Calibrar

Con el firmware, desde la página de la caja:

1. **Motor al ralentí**, ya caliente. Compara lo que marca la caja con el cuentarrevoluciones de la moto.
2. **Ajusta las chispas por vuelta**, empezando con el ajuste en 1:
   - si la caja marca lo mismo que el cuentarrevoluciones, es **1 chispa por vuelta**;
   - si marca **la mitad**, es una chispa cada dos vueltas: pon **0,5**;
   - si marca **el doble**, está contando dos pulsos por chispa: quita una vuelta a la pinza o alarga la ventana de rebote en el firmware.
3. **Comprueba a unas 5000 rpm sostenidas.** Tiene que cuadrar a ±50 rpm.
4. **Si no cuenta o cuenta a saltos**, ajusta según [conexiones.md, apartado 3.2](conexiones.md#32-revoluciones-pinza-en-el-cable-de-bujía): 2-3 vueltas más (o quitar C2, sacando antes U1) si no cuenta, y una vuelta menos si cuenta de más.

### 6.5 El freno

En la pantalla ESTADO, o en la página de la caja, tiene que verse FRENO al tirar de la maneta o pisar el pedal, y desaparecer al soltar.

---

## 7. Unidad de pantalla (fase 4)

![Unidad de pantalla](esquemas/pantalla.svg)

Va en tu soporte Quad Lock, con el amortiguador de vibraciones entre medias. Funciona con batería y se carga por USB-C, como el móvil: te la llevas a casa.

### 7.1 Distribución dentro de la caja

La caja (Hammond RP1085C) mide 105 × 75 × 40 mm por fuera, con la **tapa transparente delante**. Desde el fondo hacia la tapa:

1. **En el fondo, sobre la placa de metacrilato:**
   - la batería, plana;
   - la placa U11 al lado, con su USB-C hacia la pared de abajo;
   - el interruptor de los LEDs (U15).
2. **Encima, sobre separadores:** la pantalla, con el cristal a 1-2 mm de la tapa.
   - Salen unos 20 mm de separador: combina dos de 10 mm por esquina.
   - Mídelo en tu caja antes de atornillar.
3. **Junto a la tapa:**
   - la tira de LEDs, arriba, encima de la pantalla, sobre dos separadores o pegada con cinta de doble cara a la pared de arriba;
   - el sensor de luz, en la esquina de arriba a la derecha, mirando hacia fuera.
4. **En la pared derecha, en la franja libre junto a la pantalla:** los dos pulsadores, A arriba y B abajo.

### 7.2 Agujeros

| Dónde | Agujero |
| --- | --- |
| Pared derecha | 2 × Ø 16 mm (A a 20 mm de arriba, B a 20 mm de abajo) |
| Pared de abajo | El agujero que pida el prolongador USB-C de panel (normalmente redondo, mira su hoja) |
| Fondo | 4 × Ø 3,2 mm en un rectángulo de 66 × 40 mm, centrado: para la chapa del Quad Lock. Los tornillos quedan a los lados del adaptador (que mide 48 mm de ancho), no debajo |
| Placa de metacrilato | Según los postes de tu caja, y 4 × Ø 2,7 mm para la pantalla (58,42 × 50,8 mm entre centros) |

### 7.3 Montaje

1. **Placa de metacrilato:** atorníllala a los postes de la caja.
2. **Batería:**
   - **comprueba su polaridad con el multímetro** antes de enchufarla: el + tiene que caer en el + de la placa;
   - pégala a la placa de metacrilato con cinta de doble cara.
3. **U11:** atorníllala por sus dos agujeros y apoya el otro extremo en un taco de cinta de espuma.
4. **Suelda los cables** según [conexiones.md, apartado 6](conexiones.md#6-unidad-de-pantalla), directamente a las placas y con hilo de silicona.
   - R11 va en serie con el cable de datos de los LEDs, junto a la tira, cubierta con termorretráctil.
   - C11 va soldado en las patillas de alimentación de la tira.
5. **Pulsadores:** atorníllalos en la pared y conecta sus dos terminales, uno a su GPIO y el otro a `GND`.
6. **Sensor de luz:** únelo con el cable Qwiic. Del pin `VIN` del sensor sale el hilo que alimenta la pantalla (`VIN` de U12).
7. **En U11 corta la soldadura `LP_CTL`** con un cúter: así la pantalla se queda sin corriente cuando la unidad duerme (por qué, en [conexiones.md, apartado 6](conexiones.md#6-unidad-de-pantalla)). **Solo en la placa de la pantalla, nunca en la de la caja.**
8. **USB-C:** monta el prolongador USB-C de panel en la pared de abajo y enchufa su otro extremo en U11.
9. **Opcional:** corta la soldadura `PWR` de U11 (el LED de encendido) para que gaste menos dormida.

### 7.4 La máscara

Pega vinilo negro por dentro de la tapa transparente, con tres ventanas:
- **59 × 36 mm** justo sobre la zona visible de la pantalla;
- una tira sobre los LEDs;
- un cuadrado sobre el sensor de luz.

Tapa el borde de la pantalla: el fabricante pide que el circuito del borde del cristal no reciba luz directa.

### 7.5 La chapa y el Quad Lock

1. **Atornilla la chapa de aluminio** (80 × 60 mm) por fuera al fondo de la caja: 4 tornillos M3 × 8 con arandela de nylon por fuera y tuerca por dentro. Pon una gota de silicona neutra en cada agujero para que no entre agua.
2. **Limpia la chapa con alcohol.**
3. **Pega el adaptador Quad Lock** centrado, entre las cabezas de los tornillos, con su lado largo en vertical, y aprieta 30 segundos.
4. **Espera 24 h** antes de usarlo.

### 7.6 Probar y poner en la moto

1. **Con el firmware, comprueba:**
   - la pantalla enseña algo;
   - los LEDs se encienden;
   - cada botón responde;
   - el sensor de luz cambia de valor al taparlo con la mano;
   - con el USB enchufado, se enciende el LED de carga.
2. **Encájala en el amortiguador del soporte.** Tiene que quedar con el USB-C hacia abajo, para que no le entre lluvia, y con su tapa puesta.
3. **Comprueba** que no tapa el cuadro ni te quita visión, y que el manillar gira a tope sin tocar el carenado.
4. **Aparcada al sol, quítala.** El fabricante de la pantalla no recomienda dejarla mucho tiempo al sol directo.

---

## 8. Comprobaciones antes de rodar

- [ ] Luces de posición y freno (maneta y pedal), intermitentes, claxon y arranque, todo igual que antes.
- [ ] La caja se enciende con el contacto y se apaga sola después.
- [ ] El GPS tiene posición con la moto en la calle; en la pantalla ESTADO, satélites y 25 Hz.
- [ ] El freno se marca al frenar.
- [ ] Las revoluciones cuadran con el cuentarrevoluciones.
- [ ] Ningún cable tira con el manillar a tope ni toca el escape.
- [ ] El asiento cierra sin pillar nada.
- [ ] La caja no se mueve al empujarla con la mano.
- [ ] La pantalla está bien encajada en el Quad Lock y no se mueve.
- [ ] Primera salida tranquila, con el iPhone grabando también, para comparar en el Blackbox.

---

## 9. Mantenimiento

**Cada mes, o después de lavar la moto, revisa:**
- el fusible y su portafusibles;
- las derivaciones del piloto;
- las bridas;
- los tornillos de la caja.

**Al lavarla:** no apuntes con la hidrolimpiadora a la caja, a la membrana ni a las derivaciones.

**Si la moto va a estar parada meses:** la caja apagada no gasta nada; la batería de la moto se cuida igual que siempre (cargador de mantenimiento si hace falta).

**La microSD:** si un día falla, se cambia y ya. Las salidas ya subidas están en la nube.

**La batería de la pantalla:**
- se carga al enchufar el USB-C, esté la unidad dormida o despierta; despierta, la pantalla dice CARGANDO;
- no la dejes al sol;
- si se hincha, cámbiala.
