import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/** Same host allowlist as `functions/proxy.ts` — keeps `proxied(url, 'always')` working in dev/preview. */
const PROXY_ALLOWED_DOMAINS = [
  'api.bgs.ac.uk',
  'egms.land.copernicus.eu',
  'epc.opendatacommunities.org',
  'api.erg.ic.ac.uk',
  'uk-air.defra.gov.uk',
  'api.uk-air.defra.gov.uk',
  'environment.data.gov.uk',
  'climate-api.open-meteo.com',
  'archive-api.open-meteo.com',
  'overpass-api.de',
  'overpass.gladesystems.uk',
  'overpass.kumi.systems',
  'maps.mail.ru',
  '178.104.106.123',
  'lle.gov.wales',
  'datamap.gov.wales',
  'coflein.gov.uk',
]

function isAllowedProxyHost(hostname: string): boolean {
  return PROXY_ALLOWED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}

function devProxyMiddleware(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
  const url = req.url ?? ''
  const pathOnly = url.split('?')[0]
  if (pathOnly !== '/proxy' && !url.startsWith('/proxy?')) return next()

  const origin = req.headers.origin
  const setCors = () => {
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*')
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept')
  }

  if (req.method === 'OPTIONS') {
    setCors()
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return next()

  const q = url.indexOf('?')
  if (q < 0) {
    setCors()
    res.statusCode = 400
    res.end('Missing url parameter')
    return
  }
  const params = new URLSearchParams(url.slice(q + 1))
  const target = params.get('url')
  if (!target) {
    setCors()
    res.statusCode = 400
    res.end('Missing url parameter')
    return
  }
  let targetUrl: URL
  try {
    targetUrl = new URL(target)
  } catch {
    setCors()
    res.statusCode = 400
    res.end('Invalid url parameter')
    return
  }
  if (!isAllowedProxyHost(targetUrl.hostname)) {
    setCors()
    res.statusCode = 403
    res.end('Domain not allowed')
    return
  }

  void (async () => {
    try {
      const upstream = await fetch(targetUrl.toString(), {
        headers: {
          Accept: req.headers.accept ?? '*/*',
          'User-Agent': 'Sonde/ViteDevProxy/1.0',
        },
      })
      const buf = await upstream.arrayBuffer()
      setCors()
      res.statusCode = upstream.status
      res.setHeader('Cache-Control', 'public, max-age=3600')
      res.setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'application/octet-stream')
      res.end(Buffer.from(buf))
    } catch (e) {
      setCors()
      res.statusCode = 502
      res.end(e instanceof Error ? e.message : 'Upstream fetch failed')
    }
  })()
}

/** Dev/preview: `/proxy?url=` matches Cloudflare Pages `functions/proxy.ts` (LiDAR GeoTIFF, etc.). */
function sondeDevProxyPlugin(): Plugin {
  return {
    name: 'sonde-dev-proxy',
    configureServer(server) {
      server.middlewares.use(devProxyMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(devProxyMiddleware)
    },
  }
}

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
  server: {
    /** Dev: same path as production `/overpass-cache`; no KV — proxied straight to public Overpass. */
    proxy: {
      '/overpass-cache': {
        target: 'https://overpass-api.de',
        changeOrigin: true,
        rewrite: () => '/api/interpreter',
        secure: true,
        // http-proxy: outgoing.method = options.method || req.method — force POST so stray GET (prefetch) is not forwarded to Overpass as GET (405).
        method: 'POST',
      },
    },
  },
  plugins: [
    react(),
    sondeDevProxyPlugin(),
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
        /** `/proxy` must hit the network (Pages Functions / dev middleware), not the SPA shell. */
        navigateFallbackDenylist: [/^\/anthropic-api/, /^\/proxy/],
      },
    }),
  ],
})
