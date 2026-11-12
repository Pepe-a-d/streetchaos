# El móvil como pantalla de la caja: análisis y plan

Escrito el 2026-11-12. **Está en estudio, no decidido.** La pantalla elegida sigue siendo la Riverdi de 4,3" ([plan, apartado 5.2](caja-diy.md#52-qué-pantalla)). Este documento estudia usar en su lugar el iPhone que ya va en el Quad Lock, con la app Street Chaos mostrando los datos de la caja.

## Resumen

- **Se puede, y sale mucho más barato.** Te ahorras unos 200 €, la carcasa impresa, la placa de la pantalla y su firmware.
- **La gran ventaja es el software.** La app ya tiene el panel en directo, el crono, los tramos, las vueltas, el delta y la voz. Con el móvil solo cambia de dónde le llegan los datos: no hay que pasar a C++ ni el delta ni el cálculo de la inclinación, ni hacer el firmware de la pantalla.
- **El punto débil es el enlace.** Safari no deja usar Bluetooth, y una página https no puede hablar con un aparato de la red local. Hay salidas, pero hay que probarlas.
- **El otro riesgo es el calor.** En verano, al sol, con el brillo a tope y el Compartir Internet encendido, el iPhone se calienta y se oscurece solo.
- **Propuesta:** no cambiar nada ahora.
  - Cuando la caja funcione (hito H5), se prueba el móvil una tarde y en 2-3 salidas.
  - Si va bien, no se compra la Riverdi.
  - Si no, se sigue con ella: el diseño ya está hecho, y la pantalla se compraba después de todos modos.
  - La caja se deja preparada para las dos opciones; cuesta céntimos.

## Cómo se conectaría el móvil a la caja

| Vía | Cómo funciona | Pros | Contras | Veredicto |
| --- | --- | --- | --- | --- |
| **A. Página de la caja por el Compartir Internet** | La caja se conecta al Compartir Internet del iPhone (como ya hace para subir las salidas). Safari abre una página servida por la propia caja (`http://172.20.10.x`), que recibe los datos al momento | Sin contenido mixto: la página es de la caja. El móvil mantiene internet. No hace falta nada de Apple. La página se monta con el mismo código de la app (panel, tramos, crono y delta) y va guardada en la memoria de la caja | No es la app: no tiene tus ajustes, ni tus récords, ni la voz entera (no cabe), y no se puede instalar como app. Al no ser https, no puede pedir que la pantalla no se apague: hay que poner el bloqueo automático en «Nunca» (o probar el truco de un vídeo mudo en bucle). La dirección cambia: se prueba `http://caja.local` y, si no, la caja pide siempre la misma | **Plan B**, segura |
| **B. La app de siempre, con un certificado propio** | Igual, pero la caja habla por `wss://`, con un certificado de una entidad propia que instalas una vez en el iPhone (un perfil). La app Street Chaos se conecta directamente | Es la app de verdad: todas las pantallas, la voz, la pantalla siempre encendida | Hay que instalar el perfil y activar su confianza completa (Ajustes → General → Información → Ajustes de confianza de certificados). No está comprobado que Safari, y la app en la pantalla de inicio, lo acepten contra una IP local. El certificado hay que renovarlo cada 2 años como mucho (Apple no acepta más de 825 días) | **Plan A**, si la prueba sale bien |
| **B2. La app de siempre, con un dominio propio** | Como B, pero con un dominio de verdad (≈ 10 €/año) que apunta a la IP de la caja y un certificado público, como hace Plex | Sin perfil que instalar | El certificado dura 90 días: lo renueva GitHub y la caja lo baja de la nube. Algunas redes bloquean los dominios que apuntan a IP locales | Solo si B falla o el perfil molesta |
| **C. App nativa con Bluetooth** | Una app de iPhone mínima que carga la app web y añade Bluetooth para hablar con la caja | Lo más robusto: sin WiFi en marcha, poco consumo, funciona en segundo plano | Cuenta de desarrollador de Apple (99 €/año) y código en Swift. Es el trabajo más grande | Solo si A y B fallan |
| **D. Red propia de la caja** | El móvil se conecta a «StreetChaos-Caja» | Sencilla | En iOS 17-18 el móvil suele **perder internet** en las demás apps mientras está en esa red: nada de mapas ni de música en streaming | Descartada |
| **E. Por la nube** | La caja manda los datos a la nube por el Compartir Internet y la app los recibe de allí | Sin certificados ni nada local | De 0,2 a 1 s de retraso, y sin cobertura no llega nada: no vale para el delta ni para el aviso de cambio | Descartada |

## Móvil frente a Riverdi

| | **Móvil (iPhone en el Quad Lock)** | **Riverdi 4,3"** |
| --- | --- | --- |
| Coste | ≈ 5-30 €: un botón en el manillar y, si quieres, un cargador | ≈ 207 € |
| Pantalla | Más grande, OLED y táctil. 800-2000 nits según el modelo | 4,3", IPS, 1000 nits, antirreflejos |
| Al sol | Muy buena en los iPhone recientes, **pero se oscurece si se calienta** | Buena y estable, en carcasa clara (hasta 70 °C) |
| De noche | Muy buena | Muy buena |
| Calor de verano | **Riesgo**: brillo a tope, Compartir Internet y, si va cargando, más calor. iOS baja el brillo o avisa | Sin batería y sin carga: aguanta |
| Vibraciones | Apple avisa de que las vibraciones de las motos pueden dañar la cámara. Con amortiguador, menos | Da igual |
| Enlace | WiFi (Compartir Internet) mientras ruedas. Puede meter ruido al GPS y depende de Safari | Radio propia (ESP-NOW), dedicada |
| Botones con guantes | Hace falta un botón en el manillar, con cable a la caja | Dos botones en la unidad |
| Batería | La del móvil: en salidas largas, cargador en la moto | No tiene |
| Software | Reutiliza la app (JavaScript), con voz incluida | Firmware nuevo en C++ y pasar el delta a C++ |
| Taller | Casi nada | Carcasa impresa, placa y cable al manillar |
| Llamadas y avisos | Tapan la pantalla mientras duran | No le afectan |
| El móvil | Va en el manillar, que es lo que la pantalla quería evitar | En el bolsillo |

## Lo que hay que comprobar antes de decidir

1. **El enlace.** Lo primero: que el iPhone llegue a un aparato conectado a su propio Compartir Internet. Las vías A y B dependen de eso. Luego, que Safari llegue a la caja (vía A) y que la app llegue por `wss://` con el certificado (vía B), también abierta desde la pantalla de inicio. Que no se corte en marcha.
2. **El GPS con el WiFi encendido.** Ahora la caja apaga el WiFi en cuanto se mueve, para no meter ruido al GPS. Con el móvil de pantalla, el WiFi va encendido toda la salida. Se mide la señal de los satélites (C/N0) con el WiFi encendido y apagado. Si baja mucho, se reduce la potencia del WiFi o se descarta.
3. **El calor.** Una salida a mediodía en un día caluroso: ¿se oscurece o avisa el iPhone?
4. **La batería.** Cuánto baja por hora con la pantalla al máximo y el Compartir Internet.
5. **Tu iPhone.** El modelo y la versión de iOS (el brillo máximo depende del modelo), y que tu tarifa permita el Compartir Internet.

## Plan de implementación

### Fase 0: dejar la caja preparada (ahora, antes del pedido; hardware) — **hecha el 2026-11-12**

Para el pedido de ahora, que la caja sirva para las dos opciones. Ya está en `piezas.md`, `conexiones.md` (apartados 1, 2, 4, 5 y 7), los esquemas y `montaje.md`:
- **J3 pasa a 3 vías**: `PANT` (12 V a la Riverdi), `BOTÓN` y `GND`. El cable al manillar pasa a 3 hilos: marrón, blanco y verde.
- **Entrada para un botón en el manillar** en el GPIO 14 (`A1`, libre), con una resistencia de 1 kΩ en serie (R12) y un condensador de 100 nF a masa (C5). El pull-up es el interno.
  - Con la Riverdi, el botón B va en la pantalla y esta entrada queda libre.
  - Con el móvil, es el botón de MARCA y META.

Cuesta céntimos y no cambia nada más. La sesión de código ya tiene la patilla nueva.

### Fase 1: prueba de concepto (en el hito H5, con la caja ya en la moto; firmware y app)

Una tarde, con la moto parada y luego en una vuelta corta:
1. La caja se conecta al Compartir Internet y manda un flujo de prueba (velocidad, inclinación, G, revoluciones y freno) 10 veces por segundo.
2. **Primero:** desde Safari, abrir la caja por su IP y por `http://caja.local`. Si el iPhone no llega a su propio Compartir Internet, A y B no sirven y se pasa a la Riverdi (o a C).
3. **Vía A:** una página mínima servida por la caja.
4. **Vía B:** la app Street Chaos por `wss://`, con el perfil del certificado instalado; desde Safari y desde la app de la pantalla de inicio.
5. Se mide:
   - si llega y cuánto tarda;
   - si se corta;
   - la señal de los satélites con el WiFi encendido y apagado (C/N0 de cada satélite, el mensaje NAV-SAT del GPS), con la potencia del WiFi normal y reducida.

### Fase 2: el modo pantalla (si la prueba sale bien; firmware y app)

- **Caja:**
  - WiFi cliente encendido mientras graba, con la potencia ajustada; su propia red sigue apagada en marcha;
  - flujo en directo: las posiciones a 25 Hz y el sensor a 50-100 Hz, en mensajes pequeños (unos 5 KB/s);
  - se reconecta sola si se corta;
  - el botón del manillar da la marca (`mark`) y la meta.
- **App:**
  - la caja como fuente de datos de la telemetría (`useSource` de `src/core/telemetry.js`, que ya existe). Todo lo de encima sigue igual: panel, crono, tramos, vueltas, delta, récords y voz;
  - la inclinación y las G las sigue calculando la app con su código de siempre, ahora con un sensor atornillado al chasis y un GPS sin retraso. **Tampoco hay que pasar a C++ la fusión del plan (5.5)**: la caja solo manda los datos;
  - el contacto lo da la caja (no hace falta la llave de la app), y el móvil no graba su propia caja negra mientras va con la caja, para que no salgan dos salidas;
  - aviso de cambio a pantalla completa en vez de los LEDs;
  - aviso claro si se pierde la caja, y vuelta a los sensores del móvil.
- **Certificado** (vía B), sin que nada se suba al repo, que es público:
  - la entidad propia se crea **en tu Mac, para ti solo**, con un programa del repo. Su clave privada no sale del Mac;
  - la caja solo lleva su certificado y su clave, con todas las direcciones posibles del Compartir Internet (172.20.10.2 a 172.20.10.14). Así da igual cuál le toque, y la app prueba esas 13;
  - la entidad, limitada a esas direcciones (restricción de nombres): aunque alguien la robara, no podría hacerse pasar por otras webs. En la prueba se comprueba que iOS lo respeta;
  - claves ECDSA, para que la caja abra la conexión segura rápido;
  - un perfil que se instala una vez, con los pasos en la app.

### Fase 3: en la moto (tú; con mi ayuda en el hardware)

- **Botón del manillar:**
  - pulsador estanco de 16 mm, como los de la pantalla;
  - en una abrazadera impresa junto a la piña izquierda;
  - cable de 3 hilos a J3, por el mismo camino previsto para la pantalla: el verde (J3-2) a un terminal del botón y el blanco (J3-3) al otro. El marrón (J3-1, 12 V), cortado y aislado en el manillar.
- **Cargador (opcional, para salidas largas):** una toma USB-C de moto con su propio fusible y su interruptor, directa a la batería. Va aparte de la caja, porque el fusible de la caja no da para cargar un móvil. Cargando se calienta más: úsalo solo cuando haga falta.
- **Visera impresa (opcional)** para el móvil: menos sol directo, menos calor y menos reflejos.
- **2-3 salidas de prueba**, una de ellas a mediodía en un día de calor.

### Decisión

| Si… | Entonces |
| --- | --- |
| El enlace no se corta, el GPS no empeora y el iPhone aguanta el calor | **Móvil.** No se compra la Riverdi: ≈ 200 € menos. La pantalla queda en el plan como alternativa |
| Falla el enlace o el GPS empeora con el WiFi | **Riverdi**, tal como está diseñada. El botón del manillar sobra o se usa como extra |
| Va bien, pero el calor lo hace inutilizable en verano | **Riverdi.** El móvil se queda para el invierno y para las pruebas |

## Quién hace qué

| Parte | Quién |
| --- | --- |
| J3 de 3 vías, entrada del botón, abrazadera impresa, cargador y visera | Sesión de hardware |
| WiFi en marcha, flujo en directo, certificado y página de la caja | Sesión de código (firmware) |
| La caja como fuente de datos en la app y aviso de cambio en pantalla | Sesión de código (app) |
| Modelo de iPhone, tarifa y salidas de prueba | Tú |

## Fuentes

- Apple sobre las vibraciones de las motos y la cámara: [support.apple.com/HT212803](https://support.apple.com/en-us/HT212803).
- Apple sobre el iPhone demasiado caliente (baja el brillo y la carga): [support.apple.com/HT201678](https://support.apple.com/en-us/HT201678).
- El iPhone pierde los datos móviles en una red WiFi sin internet: [foro de desarrolladores de Apple](https://developer.apple.com/forums/thread/782041) y [comunidad de Apple](https://discussions.apple.com/thread/255880678).
- Una ESP32 en el Compartir Internet del iPhone (direcciones 172.20.10.x, solo a 2,4 GHz): [foro de Arduino](https://forum.arduino.cc/t/esp-not-connecting-to-wifi/1362176).
