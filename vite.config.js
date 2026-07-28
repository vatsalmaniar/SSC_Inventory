import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // New SW activates + reloads open tabs automatically, so nobody is ever
      // stuck on a stale deploy (Vercel serves sw.js with no-store).
      registerType: 'autoUpdate',
      manifest: {
        name: 'SSC ERP',
        short_name: 'SSC ERP',
        description: 'SSC Control — orders, CRM, attendance & people',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#ffffff',
        background_color: '#f8f9fa',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell ONLY: code, styles, fonts, brand images.
        // NO runtimeCaching — Supabase data must never be served stale.
        globPatterns: ['**/*.{js,css,html,woff2,svg}', '*.png', 'logo/*.png'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    watch: {
      // OneDrive keeps touching these non-app files in the repo root, which
      // triggered full-page dev reloads mid-use. The app never imports them.
      ignored: ['**/*.pdf', '**/*.zip', '**/*.xlsx', '**/Schnider BOM/**', '**/logo/**', '**/SSC Automation*', '**/SSC Order Detail*', '**/Delivery Challan*'],
    },
  },
})
