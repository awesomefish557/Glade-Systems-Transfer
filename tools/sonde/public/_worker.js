/**
 * Cloudflare Pages advanced mode: proxies `/anthropic-api/*` to api.anthropic.com
 * with the server-side API key. Copied to `dist/` with the static build.
 *
 * Set `ANTHROPIC_API_KEY` in Pages → Settings → Environment variables (Production / Preview).
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    // Share URLs: /site?… → serve SPA at / (query preserved). Matches wrangler [[redirects]].
    if (url.pathname === '/site' || url.pathname === '/site/') {
      url.pathname = '/'
      return env.ASSETS.fetch(new Request(url.toString(), request))
    }
    if (url.pathname.startsWith('/anthropic-api/')) {
      if (!env.ANTHROPIC_API_KEY) {
        return new Response(
          JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured for this deployment.' }),
          { status: 503, headers: { 'content-type': 'application/json; charset=utf-8' } }
        )
      }
      const target = new URL(url.pathname.replace('/anthropic-api', ''), 'https://api.anthropic.com')
      target.search = url.search
      const headers = new Headers(request.headers)
      headers.set('x-api-key', env.ANTHROPIC_API_KEY)
      headers.delete('host')
      const newRequest = new Request(target, {
        method: request.method,
        headers,
        body: request.body,
        duplex: 'half',
      })
      return fetch(newRequest)
    }
    return env.ASSETS.fetch(request)
  },
}
