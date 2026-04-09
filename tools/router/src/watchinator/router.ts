import bootHtml from '../../../watchinator/boot.html';
import configHtml from './config.html';
import dashboardHtml from './dashboard.html';

const DASHBOARD_PIN_HEADER = '3489'; // Shared PIN for all devices in the network

const CORS_BASE: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Dashboard-Pin',
};

function mergeHeaders(base: Record<string, string>, extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  for (const [k, v] of Object.entries(base)) {
    h.set(k, v);
  }
  return h;
}

function corsJsonHeaders(): Headers {
  return mergeHeaders(CORS_BASE, {
    'Content-Type': 'application/json; charset=utf-8',
  });
}

function corsHtmlHeaders(): Headers {
  return mergeHeaders(CORS_BASE, {
    'Content-Type': 'text/html; charset=utf-8',
  });
}

export interface WatchinatorEnv {
  WATCHINATOR_DB?: D1Database;
}

type ConfigRow = {
  target_url: string;
  hardlock: number;
  domain_lock: string;
  wifi_ssid: string;
  wifi_pass: string;
  version: string;
  updated_at: string;
};

/** Pin sent but wrong -> 401. Absent pin -> public (device config page). */
function dashboardPinStatus(request: Request): 'absent' | 'valid' | 'invalid' {
  const raw = request.headers.get('X-Dashboard-Pin');
  if (raw === null || raw.trim() === '') return 'absent';
  if (raw.trim() === DASHBOARD_PIN_HEADER) return 'valid';
  return 'invalid';
}

/**
 * Match /watchinator, /watchinator/, trailing slashes, and case on the first segment
 * (e.g. /Watchinator/api/config). Inner path is lowercased for stable route keys.
 */
function normalizeWatchinatorPath(pathname: string): string | null {
  const segments = pathname.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  if (segments[0].toLowerCase() !== 'watchinator') return null;
  if (segments.length === 1) return '/';
  const inner = '/' + segments.slice(1).join('/');
  const trimmed = inner.replace(/\/+$/, '');
  return trimmed.length ? trimmed.toLowerCase() : '/';
}

export async function handleWatchinator(
  request: Request,
  url: URL,
  env: WatchinatorEnv
): Promise<Response> {
  const route = normalizeWatchinatorPath(url.pathname);
  if (route === null) {
    return new Response('Not found', { status: 404 });
  }

  const db = env.WATCHINATOR_DB;

  if (route === '/api/ping') {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: mergeHeaders(CORS_BASE) });
    }
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: corsJsonHeaders(),
      });
    }
    return new Response(JSON.stringify({ ok: true, version: 'v0.1.0-alpha' }), {
      headers: corsJsonHeaders(),
    });
  }

  if (route === '/api/config') {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: mergeHeaders(CORS_BASE) });
    }

    if (!db) {
      return new Response(JSON.stringify({ error: 'Database not configured' }), {
        status: 503,
        headers: corsJsonHeaders(),
      });
    }

    if (request.method === 'GET') {
      const pinSt = dashboardPinStatus(request);
      if (pinSt === 'invalid') {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: corsJsonHeaders(),
        });
      }
      const row = await db
        .prepare(
          'SELECT target_url, hardlock, domain_lock, wifi_ssid, wifi_pass, version, updated_at FROM watchinator_config WHERE id = 1'
        )
        .first<ConfigRow>();
      if (!row) {
        return new Response(JSON.stringify({ error: 'No config row' }), {
          status: 404,
          headers: corsJsonHeaders(),
        });
      }
      return new Response(JSON.stringify(row), { headers: corsJsonHeaders() });
    }

    if (request.method === 'POST') {
      const pinStPost = dashboardPinStatus(request);
      if (pinStPost === 'invalid') {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: corsJsonHeaders(),
        });
      }
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400,
          headers: corsJsonHeaders(),
        });
      }

      const target_url =
        typeof body.target_url === 'string' ? body.target_url : String(body.target_url ?? '');
      let hardlock = 0;
      if (typeof body.hardlock === 'boolean') {
        hardlock = body.hardlock ? 1 : 0;
      } else if (typeof body.hardlock === 'number' && Number.isFinite(body.hardlock)) {
        hardlock = body.hardlock ? 1 : 0;
      }
      const wifi_ssid =
        typeof body.wifi_ssid === 'string' ? body.wifi_ssid : String(body.wifi_ssid ?? '');
      const wifi_pass =
        typeof body.wifi_pass === 'string' ? body.wifi_pass : String(body.wifi_pass ?? '');

      const updated_at = new Date().toISOString();

      await db
        .prepare(
          `UPDATE watchinator_config SET
            target_url = ?,
            hardlock = ?,
            wifi_ssid = ?,
            wifi_pass = ?,
            updated_at = ?
          WHERE id = 1`
        )
        .bind(target_url, hardlock, wifi_ssid, wifi_pass, updated_at)
        .run();

      const row = await db
        .prepare(
          'SELECT target_url, hardlock, domain_lock, wifi_ssid, wifi_pass, version, updated_at FROM watchinator_config WHERE id = 1'
        )
        .first<ConfigRow>();

      return new Response(JSON.stringify(row ?? { ok: true }), {
        headers: corsJsonHeaders(),
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsJsonHeaders(),
    });
  }

  if (route === '/boot') {
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }
    return new Response(bootHtml, { headers: corsHtmlHeaders() });
  }

  if (route === '/config') {
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }
    return new Response(configHtml, { headers: corsHtmlHeaders() });
  }

  if (route === '/dashboard') {
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }
    return new Response(dashboardHtml, { headers: corsHtmlHeaders() });
  }

  if (route === '/') {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: corsJsonHeaders(),
    });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: corsJsonHeaders(),
  });
}
