// Temas de color. Cada tema redefine las variables de color de style.css; sus nombres son los del
// tema original: --pink es el acento principal, --cyan el de los dígitos grandes, --yellow el
// resaltado, y --green, --orange y --red los de «bien», «cuidado» y «mal».
// Además: el estilo de los números del DASH y, si se quiere, el color de tu moto como acento.
import { settings } from '../core/store.js'

const BASE = { onacc: '#12061f', glow: 'transparent' }

export const THEMES = [
  {
    id: 'synth',
    name: 'SYNTHWAVE',
    desc: 'Neón morado, rosa y cian',
    vars: { bg: '#0a0618', bg2: '#140a30', panel: '#110a28', panel2: '#1a1040', line: '#3a2a7a', ink: '#efeaff', dim: '#8a80c4', faint: '#4a3f86', cyan: '#22e3ff', pink: '#ff2e88', yellow: '#ffd23f', orange: '#ff8a1f', green: '#3dff7a', red: '#ff3b3b', violet: '#9d8cff', bar: '#070412', sep: '#1a1236', off: '#1e1542', hover: '#1d1342', deep: '#05020f', dash: '#241a4e', onacc: '#12061f', glow: '#22e3ff66' },
  },
  {
    id: 'lcd',
    name: 'LCD VERDE',
    desc: 'Pantalla de cristal líquido de los 90',
    vars: { bg: '#0a1307', bg2: '#0e1b0a', panel: '#0f1f0b', panel2: '#162e11', line: '#2e5a23', ink: '#d6f7c4', dim: '#86b871', faint: '#45703a', cyan: '#a8ff4f', pink: '#76f05e', yellow: '#e4ff6b', orange: '#c9ff4a', green: '#76f05e', red: '#ff8a4f', violet: '#b8e68a', bar: '#070f05', sep: '#15260e', off: '#1a2e13', hover: '#18301a', deep: '#050a03', dash: '#23421b', onacc: '#071004', glow: '#a8ff4f4d' },
  },
  {
    id: 'amber',
    name: 'AMBAR',
    desc: 'Monitor de fósforo ámbar',
    vars: { bg: '#0f0702', bg2: '#170b03', panel: '#1a0e04', panel2: '#241406', line: '#5a3510', ink: '#ffe2b0', dim: '#c9893d', faint: '#6e4818', cyan: '#ffb300', pink: '#ff7a00', yellow: '#ffd27a', orange: '#ff9a2e', green: '#ffc24a', red: '#ff4f2e', violet: '#e0a060', bar: '#0b0501', sep: '#2a1806', off: '#2a1708', hover: '#2a1808', deep: '#070300', dash: '#3a240c', onacc: '#140800', glow: '#ffb3004d' },
  },
  {
    id: 'tokyo',
    name: 'TOKIO',
    desc: 'Noche azul con rojo y cian',
    vars: { bg: '#04070f', bg2: '#08101f', panel: '#0a1324', panel2: '#0f1b33', line: '#1f3a66', ink: '#e6f0ff', dim: '#7f9cc8', faint: '#34507e', cyan: '#2ee6ff', pink: '#ff3d5a', yellow: '#ffe14d', orange: '#ff8a3d', green: '#3dffb0', red: '#ff3d5a', violet: '#8ab4ff', bar: '#030610', sep: '#0f1d38', off: '#122340', hover: '#10203e', deep: '#02040a', dash: '#1a2f55', onacc: '#04070f', glow: '#2ee6ff4d' },
  },
  {
    id: 'race',
    name: 'CARRERAS',
    desc: 'Negro, rojo y blanco de cuadro de competición',
    vars: { bg: '#070707', bg2: '#0e0e0e', panel: '#121212', panel2: '#1c1c1c', line: '#3a3a3a', ink: '#ffffff', dim: '#a6a6a6', faint: '#565656', cyan: '#ffffff', pink: '#e10600', yellow: '#ffd400', orange: '#ff7a00', green: '#2bd95c', red: '#ff2a1a', violet: '#c4c4c4', bar: '#040404', sep: '#1e1e1e', off: '#222222', hover: '#222222', deep: '#030303', dash: '#2c2c2c', onacc: '#ffffff', glow: '#ffffff33' },
  },
  {
    id: 'sunset',
    name: 'OCASO',
    desc: 'Naranja y violeta de atardecer',
    vars: { bg: '#120613', bg2: '#1c0a1c', panel: '#1f0b1f', panel2: '#2b102a', line: '#5e2550', ink: '#ffe9e0', dim: '#d08ab0', faint: '#7a3a68', cyan: '#ffb15c', pink: '#ff4f8b', yellow: '#ffe066', orange: '#ff8a3d', green: '#7dffb2', red: '#ff4f4f', violet: '#c48cff', bar: '#0c040c', sep: '#2a0f28', off: '#2c1230', hover: '#2a1028', deep: '#080208', dash: '#401a3a', onacc: '#1a0610', glow: '#ffb15c4d' },
  },
  {
    id: 'sun',
    name: 'SOL',
    desc: 'Claro y con mucho contraste para leerlo a pleno sol',
    light: true,
    vars: { bg: '#efebe0', bg2: '#e4ded0', panel: '#ffffff', panel2: '#f3efe6', line: '#1b1b1b', ink: '#0a0a0a', dim: '#4a4a4a', faint: '#8c877c', cyan: '#00337f', pink: '#d0004f', yellow: '#9c6200', orange: '#c04f00', green: '#00792f', red: '#c20000', violet: '#5a3fbf', bar: '#e4ded0', sep: '#cbc4b3', off: '#e2ddd0', hover: '#ebe6d9', deep: '#faf8f3', dash: '#bdb6a4', onacc: '#ffffff', glow: 'transparent' },
  },
]

export const DIGITS = [
  { id: 'lcd', name: 'LCD', desc: 'Siete segmentos' },
  { id: 'pixel', name: 'PIXEL', desc: 'Letra de recreativa' },
  { id: 'clean', name: 'LIMPIO', desc: 'Moderno y fácil de leer' },
]

export const themeOf = (id) => THEMES.find((t) => t.id === id) || THEMES[0]

/** Variables CSS de un tema como texto para `style=""` (para las vistas previas). */
export const themeStyle = (t) => Object.entries({ ...BASE, ...t.vars, ...onVars(t.vars) }).map(([k, v]) => `--${k}:${v}`).join(';')

/** Luminancia relativa (0 negro – 1 blanco) de un #rrggbb. */
export function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return 0
  const [r, g, b] = [0, 2, 4].map((k) => {
    const c = parseInt(m[1].slice(k, k + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** Texto que se lee sobre ese color: negro sobre los claros, blanco sobre los oscuros. */
export const textOn = (hex) => (luminance(hex) > 0.22 ? '#0b0b0b' : '#ffffff')

// Colores de acento que hacen de fondo de botones y marcas: cada uno lleva su --on-… (el texto encima).
// Antes había un solo color de texto para todos y en CARRERAS (donde el «cian» es blanco) los botones
// elegidos salían en blanco sobre blanco.
export const ACCENTS = ['pink', 'cyan', 'yellow', 'green', 'orange', 'red', 'violet']
export const onVars = (vars) => Object.fromEntries(ACCENTS.map((k) => [`on-${k}`, textOn(vars[k])]))

/** Aplica el tema, el estilo de números y el acento de los ajustes. */
export function applyTheme() {
  const t = themeOf(settings.theme)
  const root = document.documentElement
  const vars = { ...BASE, ...t.vars }
  if (settings.accentBike && settings.color) vars.pink = settings.color
  Object.assign(vars, onVars(vars))
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(`--${k}`, v)
  root.dataset.theme = t.id
  root.dataset.light = t.light ? '1' : ''
  root.dataset.digits = settings.digits || 'lcd'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars.bg)
}

/** Lee el valor actual de una variable de color (para lo que se dibuja en canvas). */
export const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
