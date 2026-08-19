import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Versión del build (fecha/hora) visible en la app y publicada en version.json
const APP_VERSION = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

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
        short_name: 'Stock Inventory',
        description: 'Gestión de inventario con escaneo QR',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect fill="%232563eb" width="192" height="192"/><text x="96" y="110" font-size="80" font-weight="bold" text-anchor="middle" fill="white" font-family="Arial">📦</text></svg>',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any'
          }
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
