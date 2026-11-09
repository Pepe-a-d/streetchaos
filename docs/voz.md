# La voz de la app

La app habla con **audios propios** (`public/voz/*.m4a`, ~1,4 MB) en vez de con la voz del sistema
(Web Speech). En el iPhone, la voz del sistema se queda el audio para ella sola y **para Apple Music**
aunque la web pida lo contrario; los audios propios suenan con Web Audio, que sí respeta la sesión de
audio (`navigator.audioSession`, ver `src/core/audiosession.js`) y dejan sonar la música a la vez.
En Garaje → Voz se puede volver a la voz del móvil (más natural, pero para la música).

- `src/core/speech-text.js` parte cada frase en palabras (números en palabras, pausas en comas y
  puntos) y busca los trozos grabados más largos que encajen.
- `src/core/speech.js` los baja, los decodifica una vez y los pone uno detrás de otro.
- `tests/speech.test.js` comprueba que **todo lo que dice la app** se puede montar con lo grabado.
  Si añades una frase nueva, añádela en `scripts/voz.mjs` y regenera.

## Regenerar los audios

Con [Piper](https://github.com/OHF-Voice/piper1-gpl) y la voz `es_ES-davefx-medium` (datos CC0):

```bash
python3.12 -m venv venv && ./venv/bin/pip install piper-tts
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json
```

En macOS, el paquete de Piper busca los datos de espeak en una ruta que no existe: copia
`venv/lib/python3.12/site-packages/piper/espeak-ng-data` a una carpeta `ed`, crea dentro un enlace
`ed/espeak-ng-data → ed` y pásala con `ESPEAK_DATA_PATH`:

```bash
ESPEAK_DATA_PATH=$PWD/ed node scripts/voz.mjs ./venv/bin/python es_ES-davefx-medium.onnx
```

Hace falta `ffmpeg` (recorta el silencio de cada trozo y lo pasa a AAC mono).
