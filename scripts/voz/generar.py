# Genera los audios de la voz de la app con Piper (voz es_ES «davefx», datos CC0).
# Lo llama scripts/voz.mjs, que le pasa la lista de frases. Uso a mano:
#   python generar.py frases.json carpeta-salida modelo.onnx
# Necesita: pip install piper-tts, ffmpeg, y el modelo de
# https://huggingface.co/rhasspy/piper-voices/tree/main/es/es_ES/davefx/medium
import json, os, subprocess, sys, tempfile, wave
from piper import PiperVoice

try:
    from piper import SynthesisConfig
except ImportError:  # versiones viejas
    SynthesisConfig = None

lista, salida, modelo = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(salida, exist_ok=True)
voz = PiperVoice.load(modelo)
conf = SynthesisConfig(length_scale=0.92) if SynthesisConfig else None
frases = json.load(open(lista, encoding='utf-8'))
tmp = tempfile.mkdtemp()
for i, f in enumerate(frases):
    wav = os.path.join(tmp, f"{f['file']}.wav")
    with wave.open(wav, 'wb') as w:
        if conf:
            voz.synthesize_wav(f['text'], w, syn_config=conf)
        else:
            voz.synthesize_wav(f['text'], w)
    # Sin silencio al principio ni al final (se pegan unas a otras), mono y AAC pequeño
    filtro = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-af', filtro, '-ac', '1', '-ar', '22050', '-c:a', 'aac', '-b:a', '40k', os.path.join(salida, f"{f['file']}.m4a")], check=True)
    if i % 20 == 0:
        print(f'{i + 1}/{len(frases)} {f["text"]}', flush=True)
print('hecho', len(frases))
