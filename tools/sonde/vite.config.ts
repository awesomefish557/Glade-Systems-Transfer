import type { IncomingMessage, ServerResponse } from 'node:http'
import http from 'node:http'
import https from 'node:https'
import type { Connect, Plugin } from 'vite'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Dev/preview: forward `/proxy?url=` with no host allowlist (local only).
 * Uses raw http(s).request + pipe so long query strings behave like production fetch.
 */
const sondeDevPassthroughProxy: Connect.NextHandleFunction = (req, res, next) => {
  const rawUrl = req.url ?? ''
  if (!rawUrl.startsWith('/proxy')) return next()

  const setCors = () => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Max-Age', '86400')
  }

  if (req.method === 'OPTIONS') {
    setCors()
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
    return next()
  }

  let urlParam: string | null = null
  try {
    urlParam = new URL(rawUrl, 'http://localhost').searchParams.get('url')
  } catch {
    /* ignore */
  }

  if (!urlParam) {
    setCors()
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: { code: 400, message: 'Missing url parameter' } }))
    return
  }

  const trimmed = urlParam.trim()
  let target: URL
  try {
    target = new URL(trimmed)
  } catch {
    try {
      target = new URL(decodeURIComponent(trimmed))
    } catch {
      setCors()
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: { code: 400, message: 'Invalid URL' } }))
      return
    }
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    setCors()
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: { code: 400, message: 'Invalid URL scheme' } }))
    return
  }

  const isHttps = target.protocol === 'https:'
  const lib = isHttps ? https : http
  const port = target.port ? Number(target.port) : isHttps ? 443 : 80
  const method = req.method === 'POST' ? 'POST' : req.method === 'HEAD' ? 'HEAD' : 'GET'

  const proxyReq = lib.request(
    {
      hostname: target.hostname,
      port,
      path: target.pathname + target.search,
      method,
      headers: {
        Host: target.host,
        Accept: '*/*',
        'User-Agent': 'Sonde/ViteDevProxy/1.0',
      },
    },
    (proxyRes) => {
      setCors()
      const ct = proxyRes.headers['content-type']
      const headers: Record<string, string | string[]> = {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
        'X-Proxied-From': target.toString(),
      }
      if (ct) {
        headers['Content-Type'] = Array.isArray(ct) ? ct[0]! : ct
      } else {
        headers['Content-Type'] = 'application/octet-stream'
      }
      res.writeHead(proxyRes.statusCode ?? 200, headers)
      proxyRes.pipe(res)
    }
  )

  proxyReq.on('error', (err: Error) => {
    if (!res.headersSent) {
      setCors()
      res.statusCode = 502
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    }
    res.end(err.message)
  })

  if (method === 'POST') {
    req.pipe(proxyReq)
  } else {
    proxyReq.end()
  }
}

function anthropicDevMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction,
  apiKey: string | undefined
) {
  const raw = req.url ?? ''
  const pathOnly = raw.split('?')[0]
  if (!pathOnly.startsWith('/anthropic-api')) return next()

  const setCors = () => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, anthropic-version')
  }

  if (req.method === 'OPTIONS') {
    setCors()
    res.statusCode = 204
    res.end()
    return
  }

  if (!apiKey) {
    setCors()
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        error:
          'Anthropic API key missing (dev: set VITE_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY in tools/sonde/.env)',
      })
    )
    return
  }

  void (async () => {
    try {
      const u = new URL(raw, 'http://localhost')
      const pathOnApi = u.pathname.replace(/^\/anthropic-api/, '') || '/'
      const target = new URL(`https://api.anthropic.com${pathOnApi}`)
      target.search = u.search
      const body = req.method === 'POST' ? await readRequestBody(req) : undefined
      const headers: Record<string, string> = {
        'Content-Type': (req.headers['content-type'] as string) || 'application/json',
        'anthropic-version': (req.headers['anthropic-version'] as string) || '2023-06-01',
        'x-api-key': apiKey,
      }
      const upstream = await fetch(target.toString(), {
        method: req.method || 'POST',
        headers,
        body: req.method === 'POST' ? body : undefined,
      })
      const buf = await upstream.arrayBuffer()
      setCors()
      const ct = upstream.headers.get('Content-Type')
      if (ct) res.setHeader('Content-Type', ct)
      res.statusCode = upstream.status
      res.end(Buffer.from(buf))
    } catch (e) {
      setCors()
      res.statusCode = 502
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'Anthropic proxy failed' }))
    }
  })()
}

/** Dev/preview: `/proxy?url=` matches Cloudflare Pages `public/_worker.js` (LiDAR GeoTIFF, etc.). */
function sondeDevProxyPlugin(): Plugin {
  return {
    name: 'sonde-dev-proxy',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.envDir, '')
      const apiKey =
        env.VITE_ANTHROPIC_API_KEY ||
        process.env.VITE_ANTHROPIC_API_KEY ||
        env.ANTHROPIC_API_KEY ||
        process.env.ANTHROPIC_API_KEY
      server.middlewares.use((req, res, next) => anthropicDevMiddleware(req, res, next, apiKey))
      server.middlewares.use(sondeDevPassthroughProxy)
    },
    configurePreviewServer(server) {
      const env = loadEnv(server.config.mode, server.config.envDir, '')
      const apiKey =
        env.VITE_ANTHROPIC_API_KEY ||
        process.env.VITE_ANTHROPIC_API_KEY ||
        env.ANTHROPIC_API_KEY ||
        process.env.ANTHROPIC_API_KEY
      server.middlewares.use((req, res, next) => anthropicDevMiddleware(req, res, next, apiKey))
      server.middlewares.use(sondeDevPassthroughProxy)
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
