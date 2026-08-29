import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Versión del build (fecha/hora) visible en la app y publicada en version.json.
// En hora de Argentina (UTC-3): los servidores que compilan están en UTC y
// mostraba 3 horas de más, que confunde al mirar si la app está al día.
const APP_VERSION = new Date(Date.now() - 3 * 3600 * 1000)
  .toISOString().slice(0, 16).replace('T', ' ') + ' hs'

export default defineConfig({
  // Versión visible en la app (fecha/hora del build) para detectar caché vieja
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [
    react(),
    {
      // version.json queda fuera del precache del service worker: la app lo
      // consulta con no-store para detectar versiones nuevas y recargarse sola
      name: 'emit-version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: APP_VERSION }) })
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Stock & ML Inventory',
        short_name: 'Stock',
        description: 'Gestión de inventario y envíos - Distribuidora Universo',
        lang: 'es',
        theme_color: '#2563eb',
        background_color: '#f3f4f6',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        // Chrome exige PNG reales de 192 y 512 para ofrecer "Instalar app";
        // con el SVG data-URI anterior nunca aparecía la opción
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // La versión nueva del service worker toma control de inmediato,
        // sin esperar a que se cierren todas las pestañas
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // No interceptar las funciones del backend (deben ir al servidor)
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'firebase-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 3600
              }
            }
          }
        ]
      }
    })
  ],
  server: {
    port: 5173
  }
})
