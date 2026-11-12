# Piezas impresas en 3D

Hay impresora 3D: imprime PLA, PETG, ASA y TPU, con una cama de unos 256 mm.

Sirve para lo que no se compra hecho a medida:
- sujetar la caja sin taladrar la moto;
- plantillas para taladrar exacto;
- en la fase 4, la carcasa de la pantalla.

Las piezas se diseñan en Fusion con las medidas de este documento, de los [esquemas](esquemas/) y de la maqueta ([montaje, paso 0.2](montaje.md#02-busca-el-sitio-en-la-moto)).

**Estado (2026-11-11): por diseñar.** Primero hacen falta las medidas y las fotos de la maqueta.

## Qué material

| Material | Dónde |
| --- | --- |
| **ASA** | Todo lo que va en la moto: aguanta el sol y el calor (hasta unos 95 °C). La primera opción |
| **PETG** | Bajo el asiento y sin sol directo, si no quieres imprimir ASA: aguanta unos 75 °C |
| **PLA** | Solo plantillas y pruebas de encaje: en la moto, al sol, se deforma |
| **TPU** | Tapas, juntas, capuchones y pasacables: es flexible |

Cada pieza se imprime primero en PLA para probar que encaja, y la definitiva en ASA.

## Qué imprimir, por orden

| # | Pieza | Material | Para qué | Cuándo | Qué hace falta |
| --- | --- | --- | --- | --- | --- |
| 1 | **Soporte de la caja** bajo el asiento | ASA | Sujeta la caja firme sin taladrar la moto: copia la forma de la bandeja y se agarra a lo que ya hay (un tubo, una pestaña, un tornillo de la moto). La caja se atornilla al soporte por los agujeros de sus pestañas, con tuercas M4 metidas en la pieza | H3, antes de instalar | Las fotos y medidas de la maqueta (montaje 0.2) |
| 2 | **Plantillas de taladrado** | PLA | Se apoyan en la pared de la caja y marcan los agujeros: prensaestopas, membrana y pasamuros. Otra marca los 4 agujeros de la placa perforada. Quedan exactos a la primera | H3, antes de taladrar | Nada: las medidas están en [caja-taladros.svg](esquemas/caja-taladros.svg) y [placa-base.svg](esquemas/placa-base.svg) |
| 3 | **Puente que sujeta la placa U1** | ASA o PETG | Se atornilla a la placa base y aprieta la Thing Plus en sus zócalos, para que la vibración no la suelte. Deja libres la microSD y el USB-C | H3 | Las placas en la mano |
| 4 | **Base de la antena** | ASA | Base plana con la chapita de acero dentro. Se sujeta bajo el colín o el asiento sin taladrar | H3 | El sitio de la antena (montaje 0.2) |
| 5 | **Clips para los cables** | TPU o ASA | Sujetan la manguera y el cable de revoluciones al chasis donde no hay sitio para una brida | H3 y H7 | Fotos del recorrido |
| 6 | **Carrete de la pinza de revoluciones** | ASA | Un carrete partido que se abrocha al cable de bujía. El hilo se enrolla en él, así las vueltas quedan siempre iguales y se pueden cambiar al calibrar. Solo si ese punto queda lejos de la culata | H7 | El diámetro del cable de bujía y el sitio libre junto a la bobina |
| 7 | **Carcasa de la pantalla** (unos 116 × 98 × 36 mm) | ASA de color claro y TPU | Para la Riverdi RVT43HLBFWN00, que va atornillada por sus 4 orejetas (agujeros de 3,5 mm a 88,3 × 76,5 mm) a insertos M3. Lleva:<br>• un marco con junta de TPU alrededor del hueco de la pantalla (97 × 56 mm), sin cristal;<br>• una ventana para los LEDs encima y otra para el sensor de luz en la pared de arriba;<br>• dos agujeros de 16 mm para los botones en la pared derecha;<br>• un prensaestopas PG7 abajo;<br>• una tapa trasera con insertos para la chapa del Quad Lock.<br>Opcional: una visera que dé sombra a la pantalla. En color claro, porque en negro, al sol, pasa de 70 °C, el límite de la pantalla | Fase 4 (H8) | La pantalla en la mano, para medir el marco y el grosor ([conexiones, apartado 6](conexiones.md#6-unidad-de-pantalla), [pantalla.svg](esquemas/pantalla.svg)) |

## Qué no se imprime

- **La caja principal.** Sigue siendo la Hammond 1555F2F42GY: es estanca (IP68) con su junta, aguanta el calor y todo el diseño está hecho sobre ella. Conseguir que una caja impresa sea estanca de verdad es difícil.
- **La pieza que encaja en el Quad Lock.** Se usa el adaptador original: si una pieza impresa se rompe en marcha, la pantalla sale volando.
- **Nada cerca del escape ni de la culata.** Ni el ASA aguanta ese calor. Allí va la funda de fibra de vidrio.
