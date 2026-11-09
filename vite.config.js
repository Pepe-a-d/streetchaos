import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// Versión que enseña la app (Garaje → Versión): el commit y la fecha de la compilación
function version() {
  let sha = 'local'
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {}
  const d = new Date()
  const p = (x) => String(x).padStart(2, '0')
  return `${sha} · ${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default defineConfig(({ mode }) => ({
  define: { __APP_VERSION__: JSON.stringify(version()) },
  plugins: [
    // `npm run dev:movil`: HTTPS autofirmado para abrirla desde el móvil en la red local (el GPS exige HTTPS)
    mode === 'movil' ? basicSsl() : null,
    VitePWA({
      registerType: 'autoUpdate',
      includeManifestIcons: false,
      manifest: {
        name: 'Street Chaos',
        short_name: 'StreetChaos',
        description: 'Dashboard de moto y drag races por GPS con estética arcade retro.',
        lang: 'es',
        theme_color: '#0a0618',
        background_color: '#0a0618',
        display: 'fullscreen',
        orientation: 'any',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // La voz de la app (public/voz) también, para que hable sin conexión
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}', 'voz/*.{m4a,json}'],
        // El analizador (/blackbox) es para el ordenador: ni se guarda para usar sin conexión ni
        // se le sirve la app del móvil al navegar
        globIgnores: ['blackbox/**', 'assets/bb-*'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/blackbox(\/|$)/],
      },
    }),
  ].filter(Boolean),
  build: {
    rolldownOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), blackbox: resolve(import.meta.dirname, 'blackbox/index.html') },
      output: {
        // Los trozos que solo usa el analizador llevan «bb-» para dejarlos fuera de la app del móvil
        entryFileNames: (c) => (c.name === 'blackbox' ? 'assets/bb-[name]-[hash].js' : 'assets/[name]-[hash].js'),
        chunkFileNames: (c) => (c.moduleIds.some((id) => /maplibre|uplot|[\\/]src[\\/]blackbox[\\/]/.test(id)) ? 'assets/bb-[name]-[hash].js' : 'assets/[name]-[hash].js'),
        assetFileNames: (a) => (/maplibre|uplot|blackbox|^map\./i.test(a.names?.[0] ?? a.name ?? '') ? 'assets/bb-[name]-[hash][extname]' : 'assets/[name]-[hash][extname]'),
      },
    },
  },
  server: {
    allowedHosts: ['.trycloudflare.com'],
  },
}))
