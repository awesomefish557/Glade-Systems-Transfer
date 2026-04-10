/**
 * Pages Function for `/proxy` — mirrored in `public/_worker.js` (advanced mode).
 * Kept for `wrangler pages dev` / future non-advanced deployments.
 */

const ALLOWED_DOMAINS = [
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
  /** Previously allowlisted — keep for existing integrations */
  'remotesensingdata.gov.scot',
  'api.erg.ic.ac.uk',
  'overpass.gladesystems.uk',
  '178.104.106.123',
  'data.gov.ie',
  'opengeodata.nrw.de',
]

function corsJson(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  }
}

function isAllowedDomain(targetHost: string): boolean {
  return ALLOWED_DOMAINS.some(
    (domain) =>
      targetHost === domain ||
      targetHost.endsWith('.' + domain) ||
      /** Listed entry is a subdomain of the requested host (edge cases, e.g. regional mirrors) */
      domain.endsWith('.' + targetHost)
  )
}

function jsonError(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsJson() },
  })
}

export async function onRequest(context: { request: Request }) {
  const req = context.request
  const url = new URL(req.url)
  const target = url.searchParams.get('url')

  console.log('Proxy request:', {
    method: req.method,
    targetPreview: target?.slice(0, 120),
    origin: req.headers.get('Origin'),
  })

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsJson() })
  }

  if (!target) {
    return jsonError(400, { error: { code: 400, message: 'Missing url' } })
  }

  const trimmed = target.trim()
  let targetUrl: URL
  try {
    targetUrl = new URL(trimmed)
  } catch {
    try {
      targetUrl = new URL(decodeURIComponent(trimmed))
    } catch {
      console.log('Proxy: URL parse failed for param (trimmed length)', trimmed.length)
      return jsonError(400, { error: { code: 400, message: 'Invalid URL' } })
    }
  }

  console.log('Proxy target URL:', targetUrl.toString())
  const targetHost = targetUrl.hostname
  console.log('Parsed hostname:', targetHost)
  console.log(
    'Allowed check:',
    ALLOWED_DOMAINS.some(
      (d) => targetHost === d || targetHost.endsWith('.' + d) || d.endsWith('.' + targetHost)
    )
  )

  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return jsonError(400, { error: { code: 400, message: 'Invalid URL scheme' } })
  }

  if (!isAllowedDomain(targetHost)) {
    console.log('BLOCKED:', targetHost, 'not in allowed list')
    return jsonError(403, {
      error: { code: 403, message: 'Domain not allowed', domain: targetHost },
    })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const method = req.method === 'POST' ? 'POST' : 'GET'
    const outgoingHeaders: Record<string, string> = {
      Accept: 'application/json, image/tiff, */*',
      'User-Agent': 'Sonde/1.0 (gladesystems.uk)',
    }
    const auth = req.headers.get('Authorization')
    if (auth) outgoingHeaders.Authorization = auth
    if (method === 'POST') {
      outgoingHeaders['Content-Type'] = req.headers.get('Content-Type') || 'application/json'
    }

    const body = method === 'POST' ? await req.text() : undefined

    const response = await fetch(targetUrl.toString(), {
      method,
      headers: outgoingHeaders,
      body,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    const buf = await response.arrayBuffer()

    return new Response(buf, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
        ...corsJson(),
        'Cache-Control': 'public, max-age=3600',
        'X-Proxied-From': targetUrl.toString(),
      },
    })
  } catch (err: unknown) {
    clearTimeout(timeout)
    const message = err instanceof Error ? err.message : 'Upstream fetch failed'
    return new Response(JSON.stringify({ error: message, target: targetUrl.toString() }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsJson() },
    })
  }
}
