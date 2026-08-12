import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
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
