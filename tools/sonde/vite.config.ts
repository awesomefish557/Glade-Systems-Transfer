import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/** Dev/preview: share links use `/site?lat=…` so the SPA loads instead of 404. */
function sharePathFallback(): Plugin {
  return {
    name: 'sonde-share-site-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url?.split('?')[0] === '/site') req.url = '/'
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url?.split('?')[0] === '/site') req.url = '/'
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    sharePathFallback(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Sonde',
        short_name: 'Sonde',
        description: 'Site analysis tool',
        theme_color: '#E8621A',
        background_color: '#0a0a0a',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        /** Cloudflare Pages advanced-mode worker bundle — not a browser asset; precaching it confuses tooling and SW size. */
        globIgnores: ['**/_worker.js'],
        /** Main bundle exceeds Workbox default 2 MiB precache limit. */
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/anthropic-api/],
      },
    }),
  ],
})
