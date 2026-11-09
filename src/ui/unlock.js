// Aviso de logro desbloqueado y de subida de nivel: un cartel arriba con la medalla, fanfarria y voz.
// Si llegan varios a la vez, salen uno detrás de otro.
import { onAchievement, TIERS } from '../core/achievements.js'
import { sfx } from '../core/audio.js'
import { say } from '../core/voice.js'
import { esc, html, toast } from './util.js'
import { medalSvg } from './medals.js'

const queue = []
let showing = false

function next() {
  if (showing || !queue.length) return
  showing = true
  const e = queue.shift()
  const el =
    e.type === 'unlock'
      ? html(`<div class="unlock"><div class="ul-medal">${medalSvg(e.a.cat, e.a.tier)}</div><div class="ul-txt"><span class="lbl">LOGRO ${TIERS[e.a.tier].name}</span><b>${esc(e.a.title)}</b><small>${esc(e.a.desc)}</small></div></div>`)
      : html(`<div class="unlock lvl"><div class="ul-medal">${medalSvg('star', 'g')}</div><div class="ul-txt"><span class="lbl">SUBES DE NIVEL</span><b>NIVEL ${e.lv.n}</b><small>${esc(e.lv.rank)}</small></div></div>`)
  document.body.append(el)
  sfx.record()
  if (e.type === 'unlock') say(`Logro: ${/\d/.test(e.a.title) ? e.a.desc : e.a.title.toLowerCase()}`, { kind: 'ach' })
  else say(`Subes a nivel ${e.lv.n}. ${e.lv.rank.toLowerCase()}`, { kind: 'ach' })
  setTimeout(() => el.classList.add('out'), 3600)
  setTimeout(() => {
    el.remove()
    showing = false
    next()
  }, 4000)
}

export function setupUnlocks() {
  onAchievement((e) => {
    if (e.type === 'catchup') {
      toast(`TIENES ${e.list.length} ${e.list.length === 1 ? 'LOGRO' : 'LOGROS'} DE LO QUE YA HABIAS HECHO: MIRA GARAJE > LOGROS`, 5000)
      return
    }
    queue.push(e)
    next()
  })
}
