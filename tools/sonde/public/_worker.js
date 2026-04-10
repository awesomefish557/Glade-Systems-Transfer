/**
 * Cloudflare Pages advanced mode — this Worker handles all requests.
 * The `functions/` directory is NOT auto-routed; keep logic here (or import a bundled module).
 *
 * Routes:
 * - /site → SPA shell (query preserved)
 * - /anthropic-api/* → api.anthropic.com (set ANTHROPIC_API_KEY in Pages env)
 * - /proxy?url= → allowlisted CORS proxy
 * - /overpass-cache → KV-cached Overpass POST (SONDE_CACHE)
 * - /overpass-health → Overpass reachability JSON
 */

const ALLOWED_PROXY_HOSTS = [
  'environment.data.gov.uk',
  'api.bgs.ac.uk',
  'egms.land.copernicus.eu',
  'epc.opendatacommunities.org',
  'api.uk-air.defra.gov.uk',
  'uk-air.defra.gov.uk',
  'climate-api.open-meteo.com',
  'archive-api.open-meteo.com',
  'api.open-meteo.com',
  'overpass-api.de',
  'overpass.kumi.systems',
  'maps.mail.ru',
  'lle.gov.wales',
  'datamap.gov.wales',
  'coflein.gov.uk',
  'api.beta.ons.gov.uk',
  'portal.opentopography.org',
  'dataspace.copernicus.eu',
  'planning.data.gov.uk',
  'flood-monitoring.data.gov.uk',
  'remotesensingdata.gov.scot',
  'api.erg.ic.ac.uk',
  'overpass.gladesystems.uk',
  '178.104.106.123',
  'data.gov.ie',
  'opengeodata.nrw.de',
]

function proxyCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  }
}

function isAllowedProxyHost(targetHost) {
  return ALLOWED_PROXY_HOSTS.some(
    (domain) =>
      targetHost === domain ||
      targetHost.endsWith('.' + domain) ||
      domain.endsWith('.' + targetHost)
  )
}

async function handleProxy(request) {
  const url = new URL(request.url)
  const target = url.searchParams.get('url')

  console.log('Proxy request:', {
    method: request.method,
    target,
    origin: request.headers.get('Origin'),
  })

  const baseHeaders = proxyCorsHeaders()

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: baseHeaders })
  }

  if (!target) {
    return new Response(JSON.stringify({ error: { code: 400, message: 'Missing url' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...baseHeaders },
    })
  }

  const trimmed = target.trim()
  let targetUrl
  try {
    targetUrl = new URL(trimmed)
  } catch {
    try {
      targetUrl = new URL(decodeURIComponent(trimmed))
    } catch {
      console.log('Proxy: URL parse failed, param length', trimmed.length)
      return new Response(JSON.stringify({ error: { code: 400, message: 'Invalid URL' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...baseHeaders },
      })
    }
  }

  console.log('Proxy target URL:', targetUrl.toString())
  const targetHost = targetUrl.hostname
  console.log('Parsed hostname:', targetHost)
  console.log(
    'Allowed check:',
    ALLOWED_PROXY_HOSTS.some(
      (d) => targetHost === d || targetHost.endsWith('.' + d) || d.endsWith('.' + targetHost)
    )
  )

  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return new Response(JSON.stringify({ error: { code: 400, message: 'Invalid URL scheme' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...baseHeaders },
    })
  }

  if (!isAllowedProxyHost(targetHost)) {
    console.log('BLOCKED:', targetHost, 'not in allowed list')
    return new Response(
      JSON.stringify({
        error: { code: 403, message: 'Domain not allowed', domain: targetHost },
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...baseHeaders },
      }
    )
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const method = request.method === 'POST' ? 'POST' : 'GET'
    /** @type {Record<string, string>} */
    const headers = {
      Accept: 'application/json, image/tiff, */*',
      'User-Agent': 'Sonde/1.0 (gladesystems.uk)',
    }
    const auth = request.headers.get('Authorization')
    if (auth) headers.Authorization = auth
    if (method === 'POST') {
      headers['Content-Type'] = request.headers.get('Content-Type') || 'application/json'
    }

    const body = method === 'POST' ? await request.text() : undefined

    const upstream = await fetch(targetUrl.toString(), {
      method,
      headers,
      body,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    const buf = await upstream.arrayBuffer()

    return new Response(buf, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        ...baseHeaders,
        'Cache-Control': 'public, max-age=3600',
        'X-Proxied-From': targetUrl.toString(),
      },
    })
  } catch (err) {
    clearTimeout(timeout)
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    return new Response(JSON.stringify({ error: message, target }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...baseHeaders },
    })
  }
}

function overpassCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

async function handleOverpassCache(request, env) {
  const h = overpassCorsHeaders()
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: h })
  }
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: h })
  }
  if (!env.SONDE_CACHE) {
    return new Response(JSON.stringify({ error: 'SONDE_CACHE KV is not bound' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', ...h },
    })
  }

  const query = await request.text()
  const data = new TextEncoder().encode(query)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const cacheKey =
    'overpass_' + hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').substring(0, 32)

  const cached = await env.SONDE_CACHE.get(cacheKey)
  if (cached) {
    return new Response(cached, {
      headers: { ...h, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
    })
  }

  const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
  let response = null
  for (const endpoint of endpoints) {
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        body: query,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(30_000),
      })
      if (response.ok) break
    } catch {
      continue
    }
  }

  if (!response?.ok) {
    return new Response('Overpass unavailable', { status: 503, headers: h })
  }

  const bodyText = await response.text()
  await env.SONDE_CACHE.put(cacheKey, bodyText, { expirationTtl: 604_800 })

  return new Response(bodyText, {
    headers: { ...h, 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
  })
}

async function handleOverpassHealth() {
  const HEALTH_URL =
    'https://overpass-api.de/api/interpreter?data=%5Bout:json%5D;node(1);out;'
  try {
    const res = await fetch(HEALTH_URL, {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: 30, cacheEverything: false },
    })
    if (!res.ok) {
      return new Response(
        JSON.stringify({ ok: false, status: res.status, endpoint: 'https://overpass-api.de/api/interpreter' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    }
    return new Response(
      JSON.stringify({ ok: true, status: 200, endpoint: 'https://overpass-api.de/api/interpreter' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        status: 503,
        endpoint: 'https://overpass-api.de/api/interpreter',
        error: error instanceof Error ? error.message : 'health check failed',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

function anthropicCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version',
    'Access-Control-Max-Age': '86400',
  }
}

async function handleAnthropic(request, env) {
  const cors = anthropicCorsHeaders()

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (!env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured for this deployment.' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
    })
  }

  const url = new URL(request.url)
  const pathOnAnthropic = url.pathname.replace(/^\/anthropic-api/, '') || '/'
  const target = new URL(`https://api.anthropic.com${pathOnAnthropic}`)
  target.search = url.search

  const headers = new Headers()
  headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json')
  headers.set(
    'anthropic-version',
    request.headers.get('anthropic-version') || '2023-06-01'
  )
  headers.set('x-api-key', env.ANTHROPIC_API_KEY)

  const upstream = await fetch(target.toString(), {
    method: request.method,
    headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
  })

  const out = new Headers()
  out.set('Access-Control-Allow-Origin', '*')
  out.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  const ct = upstream.headers.get('Content-Type')
  if (ct) out.set('Content-Type', ct)

  return new Response(upstream.body, {
    status: upstream.status,
    headers: out,
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/site' || url.pathname === '/site/') {
      url.pathname = '/'
      return env.ASSETS.fetch(new Request(url.toString(), request))
    }

    if (url.pathname === '/proxy') {
      return handleProxy(request)
    }

    if (url.pathname === '/overpass-cache') {
      return handleOverpassCache(request, env)
    }

    if (url.pathname === '/overpass-health') {
      return handleOverpassHealth()
    }

    if (url.pathname === '/anthropic-api' || url.pathname.startsWith('/anthropic-api/')) {
      return handleAnthropic(request, env)
    }

    return env.ASSETS.fetch(request)
  },
}
