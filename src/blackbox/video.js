// Panel de vídeo del Blackbox: el vídeo de la salida (GoPro, otra cámara o el móvil) al lado del mapa,
// sincronizado con los datos. Al mover el cursor por las gráficas o el mapa, el vídeo va a ese momento;
// al reproducirlo, el cursor lo sigue. Encima, la velocidad, la inclinación y la G de ese instante.
//
// El vídeo no se sube a ningún sitio ni se copia: se lee del disco. Lo que se guarda (por salida) es su
// nombre, tamaño y desfase, para que al volver a elegirlo ya esté sincronizado.
import { DT } from './process.js'
import { toSpeed, speedUnit } from './channels.js'
import { readVideo, fileReader, syncOffset } from './gpmf.js'
import { esc } from './ui.js'

export const isVideoFile = (f) => /^video\//.test(f.type) || /\.(mp4|mov|m4v|lrv)$/i.test(f.name)

const fmtT = (s) => {
  if (!Number.isFinite(s)) return '—'
  const m = Math.floor(Math.abs(s) / 60)
  return `${s < 0 ? '−' : ''}${m}:${(Math.abs(s) % 60).toFixed(1).padStart(4, '0')}`
}
export const HOW = {
  gps: 'Sincronizado solo con el GPS de la cámara',
  utc: 'Sincronizado con la hora del GPS de la cámara (el recorrido no coincide del todo: compruébalo)',
  clock: 'Sincronizado con la hora de la cámara: compruébalo y ajústalo',
  none: 'Sin sincronizar: pon el vídeo y el cursor en el mismo momento y pulsa AQUÍ',
  manual: 'Ajustado a mano',
}

/** Lee un vídeo y calcula su desfase con la salida A. */
export async function prepareVideo(file, A, onProgress) {
  const info = await readVideo(fileReader(file), onProgress)
  const sync = syncOffset(A, info)
  return { info, sync }
}

/**
 * @param {HTMLElement} host  contenedor (dentro del recuadro del mapa)
 * @param {{ onCursor: (i: number) => void, onClose: () => void, onSync: (v: object) => void }} hooks
 */
export function createVideoPanel(host, { onCursor, onClose, onSync }) {
  host.innerHTML = `
    <div class="vid-stage">
      <video playsinline preload="auto" muted></video>
      <div class="vid-hud" hidden>
        <div class="vh-v"><b data-h="v">—</b><small data-h="u"></small></div>
        <div class="vh-lean"><i data-h="bar"></i><b data-h="lean">—</b></div>
        <div class="vh-g"><b data-h="g">—</b><small>G</small></div>
      </div>
      <div class="vid-msg" data-h="msg" hidden></div>
    </div>
    <div class="vid-bar">
      <button class="btn small" data-v="play" title="Reproducir o parar (espacio)">▶</button>
      <span class="vid-time" data-h="time">—</span>
      <button class="chip" data-v="rate" title="Velocidad de reproducción">1×</button>
      <button class="chip" data-v="sound" title="Activar el sonido">🔇</button>
      <span class="grow"></span>
      <span class="vid-sync" title="Si el vídeo va adelantado o atrasado respecto a los datos">
        <button class="chip" data-v="nudge" data-d="-1" title="Retrasar el vídeo 1 s respecto a los datos">−1 s</button><button class="chip" data-v="nudge" data-d="-0.1" title="Retrasar el vídeo 0,1 s">−0,1</button><button class="chip" data-v="nudge" data-d="0.1" title="Adelantar el vídeo 0,1 s">+0,1</button><button class="chip" data-v="nudge" data-d="1" title="Adelantar el vídeo 1 s respecto a los datos">+1 s</button>
        <button class="chip" data-v="here" title="El vídeo y el cursor están en el mismo momento: sincronizar aquí">AQUI</button>
      </span>
      <button class="chip" data-v="hud" title="Datos encima del vídeo">DATOS</button>
      <button class="chip" data-v="big" title="Vídeo grande (sin mapa)">⛶</button>
      <button class="chip" data-v="close" title="Cerrar el vídeo">×</button>
    </div>
    <p class="vid-how" data-h="how"></p>`
  const video = host.querySelector('video')
  const $h = (k) => host.querySelector(`[data-h="${k}"]`)
  const RATES = [1, 0.5, 0.25, 2]
  let A = null
  let clips = [] // [{ file, url, off, dur, how, name, err }]
  let cur = null // el que se está viendo
  let hud = true
  let seekTo = null // a dónde ir cuando acabe de buscar
  let chain = 0 // cada reproducción tiene su bucle; al parar o volver a darle, el viejo se acaba
  let lastI = -1

  const tOf = (i) => A.T0 + i * DT
  const iOf = (t) => Math.round((t - A.T0) / DT)

  function msg(text) {
    const m = $h('msg')
    m.hidden = !text
    m.textContent = text || ''
  }
  function showHow() {
    if (!cur) return ($h('how').textContent = '')
    const extra = cur.how === 'gps' && Number.isFinite(cur.err) ? ` (±${Math.max(1, Math.round(cur.err))} m)` : ''
    $h('how').textContent = `${cur.name} · ${HOW[cur.how] || ''}${extra} · desfase ${cur.off >= 0 ? '+' : '−'}${Math.abs(cur.off).toFixed(2)} s`
  }

  /** El vídeo que cubre el momento t de la salida (si hay varios trozos, el que toca). */
  const clipAt = (t) => clips.find((c) => t >= c.off - 0.05 && t <= c.off + c.dur + 0.05) || null

  function use(c) {
    if (cur === c) return
    const playing = !video.paused
    cur = c
    video.src = c.url
    video.playbackRate = Number(host.querySelector('[data-v="rate"]').textContent.replace('×', '')) || 1
    if (playing) video.play().catch(() => {})
    showHow()
  }

  function seek(vt) {
    vt = Math.max(0, Math.min(cur.dur - 0.05, vt))
    if (video.seeking) return (seekTo = vt)
    if (Math.abs(video.currentTime - vt) < 0.04) return
    video.currentTime = vt
  }
  video.addEventListener('seeked', () => {
    if (seekTo != null) {
      const t = seekTo
      seekTo = null
      seek(t)
    }
  })
  video.addEventListener('error', () => msg('Este navegador no puede reproducir el vídeo (puede ser HEVC/H.265): prueba en Safari, Edge o la app de Windows. La sincronización sí se guarda.'))
  video.addEventListener('loadeddata', () => msg(''))

  function paintHud(i) {
    if (!A || !hud || i < 0 || i >= A.n) return
    const ok = A.valid[i]
    $h('v').textContent = ok ? Math.round(toSpeed(A.v[i])) : '—'
    $h('u').textContent = speedUnit()
    const l = A.lean[i]
    $h('lean').textContent = ok && Number.isFinite(l) ? `${Math.abs(Math.round(l))}° ${l < 0 ? 'I' : 'D'}` : '—'
    const bar = $h('bar')
    const a = ok && Number.isFinite(l) ? Math.max(-60, Math.min(60, l)) : 0
    bar.style.transform = `rotate(${a}deg)`
    const g = A.gLong[i]
    $h('g').textContent = ok && Number.isFinite(g) ? `${g >= 0 ? '+' : '−'}${Math.abs(g).toFixed(2)}` : '—'
  }

  function tick() {
    if (!A || !cur) return
    const t = video.currentTime + cur.off
    $h('time').textContent = `${fmtT(video.currentTime)} / ${fmtT(cur.dur)}`
    const i = iOf(t)
    if (i !== lastI) {
      lastI = i
      if (i >= 0 && i < A.n) {
        paintHud(i)
        if (!video.paused) onCursor(i)
        msg('')
      } else msg('Aquí el vídeo va fuera de la salida (antes de empezar o después de acabar)')
    }
    // Al acabar un trozo, el siguiente
    if (!video.paused && video.currentTime >= cur.dur - 0.08) {
      const next = clips.find((c) => c !== cur && Math.abs(c.off - (cur.off + cur.dur)) < 3)
      if (next) (use(next), seek(t - next.off))
    }
  }
  // Mientras se reproduce, en cada fotograma (y con timeupdate por si la ventana no se ve)
  function run(my) {
    if (my !== chain || video.paused) return
    tick()
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => run(my))
    else setTimeout(() => run(my), 66)
  }
  video.addEventListener('play', () => {
    host.querySelector('[data-v="play"]').textContent = '❚❚'
    run(++chain)
  })
  video.addEventListener('pause', () => {
    chain++
    host.querySelector('[data-v="play"]').textContent = '▶'
    tick()
  })
  video.addEventListener('timeupdate', () => tick())

  host.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]')
    if (!b) return
    const k = b.dataset.v
    if (k === 'play') return api.toggle()
    if (k === 'rate') {
      const r = RATES[(RATES.indexOf(video.playbackRate) + 1) % RATES.length]
      video.playbackRate = r
      b.textContent = `${r}×`
      return
    }
    if (k === 'sound') {
      video.muted = !video.muted
      b.textContent = video.muted ? '🔇' : '🔊'
      b.title = video.muted ? 'Activar el sonido' : 'Quitar el sonido'
      return
    }
    if (k === 'hud') {
      hud = !hud
      host.querySelector('.vid-hud').hidden = !hud
      b.classList.toggle('on', hud)
      return lastI >= 0 && paintHud(lastI)
    }
    if (k === 'big') return host.parentElement.classList.toggle('video-only')
    if (k === 'close') return onClose()
    if (!cur) return
    if (k === 'nudge') {
      // + = los datos van por delante del vídeo: el vídeo se adelanta
      cur.off = Math.round((cur.off - Number(b.dataset.d)) * 100) / 100
      cur.how = 'manual'
    } else if (k === 'here') {
      cur.off = Math.round((tOf(api.cursor) - video.currentTime) * 100) / 100
      cur.how = 'manual'
    } else return
    showHow()
    onSync(cur)
    lastI = -1
    tick()
  })

  const api = {
    cursor: 0,
    get on() {
      return clips.length > 0
    },
    get clips() {
      return clips
    },
    /** Pone la salida (se quitan los vídeos de otra). */
    setSession(a) {
      if (A && a && A.meta?.id !== a.meta?.id) api.clear()
      A = a
    },
    /** Añade un vídeo ya leído y sincronizado. */
    add(file, { off, how, err, dur }) {
      const old = clips.find((c) => c.name === file.name && c.size === file.size)
      if (old) return (use(old), api.follow(api.cursor))
      const c = { file, url: URL.createObjectURL(file), name: file.name, size: file.size, lastModified: file.lastModified, off, how, err, dur }
      clips.push(c)
      clips.sort((a, b) => a.off - b.off)
      host.querySelector('.vid-hud').hidden = !hud
      host.querySelector('[data-v="hud"]').classList.toggle('on', hud)
      use(c)
      // Al momento del cursor si el vídeo lo cubre; si no, a su principio
      const t = tOf(api.cursor)
      if (t >= c.off && t <= c.off + c.dur) seek(t - c.off)
      else {
        const i = Math.max(0, Math.min(A.n - 1, iOf(c.off + 0.5)))
        onCursor(i)
        seek(tOf(i) - c.off)
      }
      showHow()
      return c
    },
    /** El cursor se ha movido desde fuera: el vídeo va a ese momento. */
    follow(i) {
      api.cursor = i
      if (!A || !clips.length) return
      paintHud(i)
      if (!video.paused) {
        // Reproduciendo: solo si el salto es grande (lo ha movido la persona, no el propio vídeo)
        if (cur && Math.abs(video.currentTime + cur.off - tOf(i)) < 0.6) return
      }
      const t = tOf(i)
      const c = clipAt(t)
      if (!c) {
        msg('No hay vídeo de este momento')
        if (!video.paused) video.pause()
        return
      }
      msg('')
      use(c)
      lastI = i
      seek(t - c.off)
      $h('time').textContent = `${fmtT(t - c.off)} / ${fmtT(c.dur)}`
    },
    pause() {
      if (!video.paused) video.pause()
    },
    /** Un aviso en el recuadro (p. ej. en la ventana del vídeo antes de que llegue ninguno). */
    hint(text) {
      msg(text)
    },
    toggle() {
      if (!cur) return
      if (video.paused) video.play().catch((e) => msg(`No se pudo reproducir: ${e.message}`))
      else video.pause()
    },
    clear() {
      video.pause()
      video.removeAttribute('src')
      video.load()
      for (const c of clips) URL.revokeObjectURL(c.url)
      clips = []
      cur = null
      lastI = -1
      msg('')
      showHow()
    },
    destroy() {
      chain++
      api.clear()
      host.innerHTML = ''
    },
    describe: () => clips.map((c) => `${esc(c.name)} (${fmtT(c.dur)})`).join(', '),
  }
  return api
}
