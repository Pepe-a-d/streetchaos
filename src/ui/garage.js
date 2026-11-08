// GARAJE: tu piloto, récords, duelos, historial y ajustes.
import { settings, setSetting, runs, races, bests, deleteRun, totals, wipeAll, saveTotals } from '../core/store.js'
import { marksFor } from '../core/perf.js'
import { zeroLean, resetTrip } from '../core/telemetry.js'
import { BIKES } from '../core/physics.js'
import { lobby } from '../core/lobby.js'
import { sfx } from '../core/audio.js'
import { $, esc, layer, toast, toSpeed, speedUnit, toDist, distUnit, fmtT, fmtDate, markLabel } from './util.js'
import { bikeSvg } from './pixel.js'
import { editRider } from './title.js'
import { RACE_MODES } from '../core/race.js'

export function mountGarage(el, { applySource }) {
  function render() {
    const b = bests()
    const wins = races.filter((r) => r.win).length
    const marks = marksFor(settings.units)
    const onOff = (key, label, sub = '') =>
      `<div class="set"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><button class="chip ${settings[key] ? 'on' : ''}" data-toggle="${key}">${settings[key] ? 'SI' : 'NO'}</button></div>`
    const pick = (key, label, opts, sub = '') =>
      `<div class="set"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><div class="chips">${opts
        .map(([v, l]) => `<button class="chip ${String(settings[key]) === String(v) ? 'on' : ''}" data-pick="${key}" data-v="${v}">${l}</button>`)
        .join('')}</div></div>`

    el.innerHTML = `
      <div class="panel card span2">
        <div class="me-card">
          ${bikeSvg(settings.color)}
          <div><b>${esc(settings.name || 'PILOTO')}</b><span style="color:var(--dim)">${esc(settings.bike || 'Sin moto')}</span></div>
          <button class="btn small" data-act="edit">EDITAR</button>
        </div>
      </div>

      <div class="panel card">
        <h3>RECORDS</h3>
        <div class="records">
          ${marks
            .map((m) => {
              const r = b[m.id]
              return `<div class="rec"><span class="lbl">${markLabel(m.id)}</span><b>${r ? fmtT(r.t) : '--.--'}</b><span>${r ? (r.v != null ? `@ ${Math.round(toSpeed(r.v))} ${speedUnit()} · ` : '') + fmtDate(r.date) : 'sin marca'}</span></div>`
            })
            .join('')}
          <div class="rec"><span class="lbl">PUNTA</span><b>${Math.round(toSpeed(totals.maxV))}</b><span>${speedUnit()}</span></div>
          <div class="rec"><span class="lbl">INCLINACION</span><b>${Math.round(totals.maxLeanL)}° ${Math.round(totals.maxLeanR)}°</b><span>izq · der</span></div>
          <div class="rec"><span class="lbl">FUERZA G</span><b>${totals.maxG.toFixed(2)}</b><span>máxima</span></div>
          <div class="rec"><span class="lbl">TOTAL</span><b>${Math.round(toDist(totals.odo))}</b><span>${distUnit()} con la app</span></div>
        </div>
      </div>

      <div class="panel card">
        <h3>DUELOS</h3>
        <div class="wl"><span class="w">${wins} GANADOS</span><span class="l">${races.length - wins} PERDIDOS</span></div>
        <div class="hist">
          ${
            races
              .slice(0, 8)
              .map(
                (r) => `<button disabled style="opacity:1"><span><span class="lbl" style="color:${r.win ? 'var(--green)' : 'var(--red)'}">${r.win ? 'VICTORIA' : 'DERROTA'} · ${RACE_MODES[r.mode] ? r.mode.toUpperCase() : ''}</span><br>vs ${esc(r.opp.name)} · ${fmtDate(r.date)}</span><b>${r.me.dnf ? 'DNF' : fmtT(r.me.rt + r.me.et, 3)}</b></button>`,
              )
              .join('') || '<span style="color:var(--dim)">Aún no has corrido ningún duelo</span>'
          }
        </div>
      </div>

      <div class="panel card">
        <h3>HISTORIAL</h3>
        <div class="hist">
          ${
            runs
              .slice(0, 30)
              .map((r) => {
                const head = marks.find((m) => r.marks[m.id] && m.id.includes('100')) || marks.find((m) => r.marks[m.id])
                return `<button data-run="${r.id}"><span><span class="lbl">${fmtDate(r.date)}${r.race ? ' · DUELO' : ''}</span><br>${head ? markLabel(head.id) : ''}</span><b>${head ? fmtT(r.marks[head.id].t) : '--'}</b></button>`
              })
              .join('') || '<span style="color:var(--dim)">Haz tu primera pasada en CRONO</span>'
          }
        </div>
      </div>

      <div class="panel card">
        <h3>AJUSTES</h3>
        ${pick('units', 'Unidades', [['kmh', 'KM/H'], ['mph', 'MPH']])}
        ${onOff('sound', 'Sonido', 'Pitidos del árbol y avisos')}
        ${onOff('crt', 'Efecto CRT', 'Líneas de tubo; quítalo si cuesta leer al sol')}
        ${onOff('rollout', 'Rollout 1 pie', 'Como en pista: el crono empieza a los 30 cm')}
        ${onOff('visible', 'Visible en el radar', 'Otros pilotos con la app te ven a menos de su radio (posición redondeada a ~10 m)')}
        ${pick('radius', 'Radio de rivales', [[500, '0.5 KM'], [1500, '1.5 KM'], [3000, '3 KM']])}
        <div class="set"><span>Inclinómetro<small>Con la moto recta y parada</small></span><button class="btn small cyan" data-act="zero">PONER A 0</button></div>
        <div class="set"><span>Viaje<small>Reinicia viaje, punta e inclinación de la sesión</small></span><button class="btn small ghost" data-act="trip">REINICIAR</button></div>
        ${pick('source', 'Fuente GPS', [['real', 'REAL'], ['sim', 'SIMULADOR']], 'El simulador sirve para probar sin moverte')}
        ${settings.source === 'sim' ? pick('simHz', 'GPS simulado', [[1, '1 HZ'], [5, '5 HZ'], [10, '10 HZ']], 'Los móviles suelen dar 1 Hz') : ''}
        ${settings.source === 'sim' ? pick('simBike', 'Moto simulada', Object.values(BIKES).map((b) => [b.id, b.name.split(' ')[0]])) : ''}
        <div class="set"><span>Red<small>${lobby.kind === 'online' ? 'Servidor online' : 'Solo pestañas de este navegador (falta configurar el servidor)'}</small></span><span class="badge ${lobby.kind === 'online' ? 'on' : ''}">${lobby.kind === 'online' ? 'ONLINE' : 'LOCAL'}</span></div>
        <div class="set"><span>Borrar datos<small>Historial, duelos y récords</small></span><button class="btn small ghost" data-act="wipe">BORRAR</button></div>
      </div>

      <div class="panel card span2" style="color:var(--dim);font-size:17px;line-height:1.25">
        <h3>SEGURIDAD</h3>
        Las carreras, en circuito o pista cerrada. En la calle respeta los límites: el GPS no distingue un circuito de una avenida, tú sí. Fija bien el móvil y no lo toques en marcha: la app se arma y cronometra sola.
      </div>`
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    sfx.click()
    if (b.dataset.toggle) {
      setSetting(b.dataset.toggle, !settings[b.dataset.toggle])
      if (b.dataset.toggle === 'crt') document.body.classList.toggle('crt', settings.crt)
    } else if (b.dataset.pick) {
      const key = b.dataset.pick
      const raw = b.dataset.v
      const v = ['radius', 'simHz'].includes(key) ? Number(raw) : raw
      setSetting(key, v)
      if (['source', 'simHz', 'simBike'].includes(key)) applySource()
    } else if (b.dataset.act === 'zero') {
      toast(zeroLean() ? 'INCLINOMETRO A CERO' : 'SIN SENSOR DE MOVIMIENTO')
    } else if (b.dataset.act === 'trip') {
      resetTrip()
      toast('VIAJE REINICIADO')
    } else if (b.dataset.act === 'edit') {
      editRider(() => render())
    } else if (b.dataset.act === 'wipe') {
      if (confirm('¿Borrar historial, duelos y récords? No se puede deshacer.')) {
        wipeAll()
        saveTotals(true)
        resetTrip()
        toast('DATOS BORRADOS')
      }
    } else if (b.dataset.run) {
      const r = runs.find((x) => x.id === b.dataset.run)
      if (r) showRun(r, render)
      return
    }
    render()
  })

  return {
    show: render,
    hide() {},
    frame() {},
  }
}

function showRun(r, onChange) {
  const marks = marksFor(settings.units).filter((m) => r.marks[m.id])
  const el = layer(
    `<div class="modal" style="padding:0">
      <div class="slip" style="font-size:19px">
        <h4>TICKET · ${fmtDate(r.date)}</h4>
        ${marks.map((m) => `<div class="r"><span>${markLabel(m.id)}</span><b>${fmtT(r.marks[m.id].t)}${r.marks[m.id].v != null ? ` @${Math.round(toSpeed(r.marks[m.id].v))}` : ''}</b></div>`).join('')}
        <div class="r"><span>PUNTA</span><b>${Math.round(toSpeed(r.maxV))}</b></div>
        <div class="r"><span>DISTANCIA</span><b>${Math.round(r.dist)} M</b></div>
        <div class="r"><span>ACEL MÁX</span><b>${r.peakG.toFixed(2)} G</b></div>
        <div class="r"><span>GPS</span><b>${r.hz.toFixed(1)} HZ ±${Math.round(r.accMax)}</b></div>
        ${r.slope != null ? `<div class="r"><span>PENDIENTE</span><b>${r.slope.toFixed(1)}%</b></div>` : ''}
        <div class="r"><span>ROLLOUT</span><b>${r.rollout ? 'SÍ' : 'NO'}</b></div>
      </div>
      <div class="actions" style="margin-top:14px">
        <button class="btn ghost small" data-k="del">BORRAR</button>
        <button class="btn small" data-k="ok">CERRAR</button>
      </div>
    </div>`,
  )
  $(el, '[data-k="ok"]').onclick = () => (sfx.click(), el.remove())
  $(el, '[data-k="del"]').onclick = () => {
    sfx.click()
    deleteRun(r.id)
    el.remove()
    onChange()
  }
}
