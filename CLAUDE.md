# Street Chaos: instrucciones para Claude

Este proyecto se lleva desde **dos ordenadores**: el Mac y el PC. Los dos usan el mismo repositorio de GitHub, `Pepe-a-d/streetchaos`, que es **público**. Para que los dos estén al día sirven este archivo y [NOTAS.md](NOTAS.md).

Se escribe en español. Al usuario, todo explicado paso a paso y sin dar nada por sabido.

## Al empezar una sesión

1. `git pull --rebase`. Si hay cambios sin guardar, primero avisar al usuario.
2. Leer en [NOTAS.md](NOTAS.md) el apartado «Estado» y las últimas entradas.

## Al terminar cada tarea

1. Añadir una entrada **arriba del todo** en «Entradas» de [NOTAS.md](NOTAS.md), con este formato:
   - el título: `### AAAA-MM-DD · Mac|PC · Qué se hizo`. El ordenador se sabe por el sistema: macOS es el Mac, Windows o Linux es el PC;
   - qué cambió y en qué archivos;
   - lo que quedó sin hacer o sin probar;
   - lo que decidió el usuario.
2. Si cambia lo que toca después, actualizar el apartado «Estado».
3. Guardar en git y subir **solo cuando el usuario lo pida** («publica», «sube»): subir a `main` publica la web en GitHub Pages.
   - La entrada de NOTAS.md va en el mismo commit que el trabajo.
   - Antes de `git push`, hacer `git pull --rebase`.
4. Al acabar, preguntar al usuario si se sube, para que el otro ordenador lo tenga.

Si NOTAS.md choca al hacer `pull`, se quedan las dos entradas, ordenadas por fecha.

## Reglas del proyecto

- **El repositorio es público.** Nunca se suben:
  - datos de las salidas (`datos/` no se sube);
  - claves;
  - posiciones o sitios del usuario. En pruebas y ejemplos, coordenadas inventadas.
- **Claves:**
  - la de Supabase va solo en `.env.local`, que no se sube (la plantilla es `.env.example`), y en los secrets de GitHub;
  - el `secrets.h` del firmware se genera desde `.env.local` y tampoco se sube.
- No mandar la ubicación del usuario a servicios de fuera.
- No comprar ni pagar nada.
- Avisar antes de borrar nada para liberar espacio.
- Con la fuente pixel (Press Start 2P), sin mayúsculas con tilde: «BATERIA», no «BATERÍA».
- La app habla con audios grabados (`public/voz/`, ver [docs/voz.md](docs/voz.md)). Una frase nueva hay que añadirla en `scripts/voz.mjs` y regenerar los audios.
- Si varias sesiones de Claude trabajan en la misma carpeta:
  - cada una guarda en git solo sus archivos;
  - nunca usar `git stash`.

## Cómo está hecho

| Parte | Dónde | Notas |
| --- | --- | --- |
| App del móvil (PWA) | `index.html`, `src/core/`, `src/ui/` | Vite. `npm ci`, `npm run dev`, `npm test`, `npm run build` |
| Blackbox (analizador) | `blackbox/`, `src/blackbox/` | Web en `/blackbox/` |
| Apps de escritorio del Blackbox | `desktop/` | Electron. GitHub construye las de Windows y Mac al subir una etiqueta `v*` igual a la versión de `desktop/package.json` ([escritorio.yml](.github/workflows/escritorio.yml)) |
| Caja DIY: plan | [docs/caja-diy.md](docs/caja-diy.md) | Fases e hitos H1-H8 |
| Caja DIY: hardware | `hardware/caja/` | Piezas, montaje, esquemas. El contrato entre hardware y código es [conexiones.md](hardware/caja/conexiones.md) |
| Caja DIY: firmware | `hardware/caja/firmware/` | PlatformIO. GitHub lo compila; en local no hace falta ([README](hardware/caja/firmware/README.md)) |
| Página de la caja | `caja/`, `src/caja/` | `/caja/`: instala el firmware desde Chrome por USB |
| Nube | `supabase/` | Supabase. Duelos por Realtime y subida de salidas |
| Publicación | [publicar.yml](.github/workflows/publicar.yml) | Cada push a `main` publica <https://pepe-a-d.github.io/streetchaos/> |

Formato de la telemetría: [docs/telemetria.md](docs/telemetria.md). Todo lo de la app está en el [README](README.md).

## Lo que no está en git

Cada ordenador tiene su copia. Se pasan a mano (USB, AirDrop o Drive), nunca por el repositorio:
- `.env.local`, con la URL y la clave pública de Supabase. Sin él, la app funciona en modo local.
- `datos/`, con las exportaciones de salidas del móvil para probar el Blackbox.
