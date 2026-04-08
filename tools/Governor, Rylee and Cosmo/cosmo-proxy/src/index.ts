interface Env {
  RATE_LIMITER: RateLimit;
  /**
   * Full origin base with a real hostname (never a raw IP in the URL — Workers return 1003).
   * Add an A record for that hostname → 178.104.106.123 (DNS-only is fine).
   */
  COSMO_ORIGIN: string;
}

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    const { success } = await env.RATE_LIMITER.limit({ key: path });
    if (!success) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const base = env.COSMO_ORIGIN.replace(/\/$/, '');
    const target = `${base}${path}${url.search}`;

    try {
      const cosmoRes = await fetch(target, {
        method: request.method,
        headers: { 'Content-Type': 'application/json' },
        body:
          request.method !== 'GET' && request.method !== 'HEAD'
            ? request.body
            : undefined,
      });

      const data = await cosmoRes.text();

      return new Response(data, {
        status: cosmoRes.status,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    } catch {
      return new Response(JSON.stringify({ error: 'Cosmo unreachable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};
