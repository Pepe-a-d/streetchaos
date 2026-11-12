# Notas de trabajo

Claude añade aquí una entrada cada vez que se termina algo, en el Mac o en el PC, y las lee al empezar. Las reglas están en [CLAUDE.md](CLAUDE.md). La entrada más nueva va arriba.

## Estado

*Al día el 2026-11-12.*

**Publicado** en <https://pepe-a-d.github.io/streetchaos/>:
- la app del móvil;
- el Blackbox, en web y como app de Windows y Mac (v2.5.0);
- el plan y el prototipo de la caja DIY;
- la prueba de banco H1 (firmware y la página `/caja/`).

**En marcha: el prototipo simple de la caja DIY.** Es la fase 1 recortada: alimentación, contacto, GPS y sensor, sin freno, revoluciones ni botón. Las salidas se bajan con el móvil desde la red de la caja.

Lo siguiente, del usuario:
1. una maqueta de cartón de 150 × 110 × 55 mm, para ver si cabe bajo el asiento;
2. pedir las piezas. El pedido de DigiKey está en [digikey-prototipo-simple.csv](hardware/caja/digikey-prototipo-simple.csv); lo genérico va aparte;
3. diseñar e imprimir la caja (él, en ABS). Las medidas por dentro, los agujeros y el dibujo acotado están en su documento de Claude Docs «Blackbox Street Chaos — prototipo simple», junto con sus reglas de caja estanca. Ese documento no está en el repo;
4. la prueba de banco en `/caja/`, cuando lleguen las piezas.

Lo siguiente del código, cuando él lo pida:
- H2: el firmware de la caja, versión simple. Graba, tiene su red WiFi para bajar las salidas, las protecciones de apagado y PRUEBA DE LA CAJA;
- abrir los `.scb` y el `.zip` de la caja en el Blackbox;
- H3: SUBIR SALIDAS DE LA CAJA en la app;
- más tarde, la versión completa (H5) y la pantalla.

**Sin probar:** la prueba H1 con una placa de verdad.

## Entradas

### 2026-11-12 · PC · PC preparado para el proyecto
- Repositorio clonado en `%USERPROFILE%\streetchaos`, fuera de OneDrive.
- Node 22 (22.23.5) instalado con winget. Es el que se usa en el PC, igual que en GitHub; el Node 24 que había se queda instalado.
- `npm ci` y `npm test`: pasan los 15 archivos de prueba (130 pruebas).
- `.env.local` creado desde `.env.example` con la URL y la clave pública de Supabase. No se sube.
- Git: `gh` ya tenía la sesión iniciada en GitHub, con permiso para subir. Los commits de este PC salen como `Pepe-a-d`, con el correo privado («noreply») de GitHub.
- No cambia nada del código. No se ha guardado nada en git ni subido.
- Decidido por el usuario: sus preferencias van en la memoria de Claude de cada ordenador, no en el repositorio.

### 2026-11-12 · Mac · Trabajo desde dos ordenadores
- Nuevos [CLAUDE.md](CLAUDE.md) (reglas y cómo seguir entre el Mac y el PC) y este archivo.
- `.gitattributes`: los archivos de texto van con finales de línea LF en los dos ordenadores.
- `.gitignore`: `secrets.h` del firmware.
- Fuera de git, a pasar a mano: `.env.local` y `datos/`.

### 2026-11-12 · Mac · Caja DIY: pedido de DigiKey del prototipo simple
- Nuevo [digikey-prototipo-simple.csv](hardware/caja/digikey-prototipo-simple.csv), para subir a DigiKey de una vez: 28 líneas, unos 216 € con IVA. Las existencias se comprobaron el 2026-11-12. Lo genérico se compra aparte.
- Antena: la SparkFun GPS-14986 no está disponible y se cambia por la **Joymax PPF-GP07SAXB-P300** (10,84 €; GPS, Galileo y GLONASS; 3,3 V). Cambiado en piezas.md, piezas.csv, conexiones.md, el plan y el README de `hardware/caja/`.
- Fusible F1: el Littelfuse 0297002 no tiene existencias; vale el Bussmann ATM-2.
- La caja pasa de ≈ 305 a ≈ 295 €, y el total, de ≈ 570 a ≈ 560 €.
- No se ha pedido nada.

### 2026-11-12 · Mac · Caja DIY: prototipo simple, pantalla y piezas impresas (e4c63cb)
- Prototipo simple en [conexiones.md §7](hardware/caja/conexiones.md) y en el plan, §3.4.
- Pantalla Riverdi 4,3" y botón del manillar en el GPIO 14.
- Plan de piezas impresas ([impresion.md](hardware/caja/impresion.md)).
- Estudio del iPhone como pantalla ([docs/caja-movil.md](docs/caja-movil.md)): se prueba en H5, antes de comprar la Riverdi.
- Decidido por el usuario: lo primero que se monta es el prototipo simple, y la caja la diseña e imprime él.

### 2026-11-12 · Mac · Caja DIY: prueba de banco H1 (1ccb0ed)
- Firmware de prueba en `hardware/caja/firmware/` (PlatformIO, entorno `prueba`). Dice OK o FALLA para la microSD, el GPS y el sensor.
- Página `/caja/`: lo instala desde Chrome por USB y enseña el resultado. `?demo` y `?demo=falla` lo enseñan sin placa.
- GitHub compila el firmware al publicar.
- Sin probar con placa.

### 2026-11-10 · Mac · Caja DIY, neumáticos y Blackbox para Mac
- Plan de la caja DIY ([docs/caja-diy.md](docs/caja-diy.md)) y prototipo en `hardware/caja/` (e457d60).
- Temperatura estimada de los neumáticos y uso de la banda (73fa922).
- Blackbox para Mac y página de descarga (811be4d).
- Contacto, resumen al terminar, trayectos, tramos en directo, vueltas y vídeo con datos (e50c574).
- El inclinómetro ya no se da la vuelta, récords de verdad y sin salidas fantasma (6c5ec14).

### 2026-11-09 · Mac · Blackbox y voz
- Blackbox en `/blackbox/` (bb06331), y luego:
  - comparar salidas, tramos, potencia y nube;
  - sectores, vuelta óptima, notas y GPX;
  - otros aparatos, vídeo de GoPro y pasadas de amigos (2.2.0).
- Blackbox V2 con varias pantallas, y app de Windows (a62474b).
- Voz con audios propios que no paran la música (a07c807). Logros con niveles.
- Pantalla negra, temas de color, DASH por bloques con editor y modo rescate.

### 2026-11-08 · Mac · Primera versión
- Dashboard de moto y drag races por GPS (d2f27c5).
- Fuerzas G e inclinación con el signo correcto, iconos pixel art y Garaje.
- Caja negra: la telemetría en bruto de cada salida.
