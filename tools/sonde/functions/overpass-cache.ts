type Env = { SONDE_CACHE: KVNamespace }

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const req = context.request

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders() })
  }

  const query = await req.text()

  const encoder = new TextEncoder()
  const data = encoder.encode(query)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const cacheKey =
    'overpass_' + hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').substring(0, 32)

  const cached = await context.env.SONDE_CACHE.get(cacheKey)
  if (cached) {
    return new Response(cached, {
      headers: {
        ...corsHeaders(),
        'Content-Type': 'application/json',
        'X-Cache': 'HIT',
      },
    })
  }

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ]

  let response: Response | null = null
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
    return new Response('Overpass unavailable', { status: 503, headers: corsHeaders() })
  }

  const body = await response.text()

  await context.env.SONDE_CACHE.put(cacheKey, body, { expirationTtl: 604_800 })

  return new Response(body, {
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json',
      'X-Cache': 'MISS',
    },
  })
}
