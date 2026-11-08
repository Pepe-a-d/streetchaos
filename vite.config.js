import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => ({
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
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ].filter(Boolean),
  server: {
    allowedHosts: ['.trycloudflare.com'],
  },
}))
