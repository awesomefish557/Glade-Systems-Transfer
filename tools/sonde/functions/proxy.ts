const ALLOWED_DOMAINS = [
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

function corsHeaders(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}

export async function onRequest(context: any) {
  const req = context.request as Request
  const incoming = new URL(req.url)
  const target = incoming.searchParams.get('url')
  const origin = req.headers.get('Origin')

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  if (!target) {
    return new Response('Missing url parameter', { status: 400, headers: corsHeaders(origin) })
  }

  let targetUrl: URL
  try {
    targetUrl = new URL(target)
  } catch {
    return new Response('Invalid url parameter', { status: 400, headers: corsHeaders(origin) })
  }

  if (!isAllowedHost(targetUrl.hostname)) {
    return new Response('Domain not allowed', { status: 403, headers: corsHeaders(origin) })
  }

  const outgoingHeaders = new Headers()
  outgoingHeaders.set('Accept', req.headers.get('Accept') ?? '*/*')
  outgoingHeaders.set('User-Agent', 'Sonde/1.0')

  const auth = req.headers.get('Authorization')
  if (auth) outgoingHeaders.set('Authorization', auth)

  const contentType = req.headers.get('Content-Type')
  if (contentType) outgoingHeaders.set('Content-Type', contentType)

  const hasBody = !['GET', 'HEAD'].includes(req.method.toUpperCase())
  const upstream = await fetch(targetUrl.toString(), {
    method: req.method,
    headers: outgoingHeaders,
    body: hasBody ? req.body : undefined,
  })

  const responseHeaders = new Headers(corsHeaders(origin))
  responseHeaders.set('Cache-Control', 'public, max-age=3600')
  responseHeaders.set('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json')

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  })
}
