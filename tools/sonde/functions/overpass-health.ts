const HEALTH_URL =
  'https://overpass-api.de/api/interpreter?data=%5Bout:json%5D;node(1);out;'

export async function onRequest(): Promise<Response> {
  try {
    const res = await fetch(HEALTH_URL, {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: 30, cacheEverything: false },
    } as RequestInit)
    if (!res.ok) {
      return new Response(
        JSON.stringify({ ok: false, status: res.status, endpoint: 'https://overpass-api.de/api/interpreter' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    }
    return new Response(
      JSON.stringify({ ok: true, status: 200, endpoint: 'https://overpass-api.de/api/interpreter' }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' } }
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
