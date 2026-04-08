export interface Env {
  DB: D1Database;
  ADMIN_SECRET: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Secret',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

const err = (msg: string, status = 400) => json({ error: msg }, status);

function isAuthed(req: Request, env: Env): boolean {
  return req.headers.get('X-Admin-Secret') === env.ADMIN_SECRET;
}

/** UI and proxies use `/api/*`; normalize to internal routes. */
function normalizePath(pathname: string): string {
  if (pathname.startsWith('/api/')) return `/${pathname.slice(5)}`;
  return pathname;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(req.url);
    const path = normalizePath(url.pathname);

    // Governor summary — public endpoint (Governor pulls this)
    if (path === '/governor-summary' && req.method === 'GET') {
      return handleGovernorSummary(env);
    }

    if (!isAuthed(req, env)) return err('Unauthorised', 401);

    // ── Dashboard (bookies-ui) ────────────────────────────────────────────
    if (path === '/dashboard' && req.method === 'GET') return handleDashboard(env);

    // ── Check-in alias for commandments (bookies-ui: GET/PUT /api/checkin) ─
    if (path === '/checkin' && req.method === 'GET') return handleGetCheckin(url, env);
    if (path === '/checkin' && (req.method === 'PUT' || req.method === 'POST')) {
      return handleSaveCommandments(req, env);
    }

    // ── Bookies ──────────────────────────────────────────────────────────
    if (path === '/bookies') {
      if (req.method === 'GET') return handleGetBookies(env);
      if (req.method === 'POST') return handleCreateBookie(req, env);
    }

    const bookieMatch = path.match(/^\/bookies\/(\d+)$/);
    if (bookieMatch) {
      const id = parseInt(bookieMatch[1]);
      if (req.method === 'PATCH') return handleUpdateBookie(id, req, env);
      if (req.method === 'DELETE') return handleDeleteBookie(id, env);
    }

    // ── Bets ─────────────────────────────────────────────────────────────
    if (path === '/bets') {
      if (req.method === 'GET') return handleGetBets(url, env);
      if (req.method === 'POST') return handleCreateBet(req, env);
    }

    const betMatch = path.match(/^\/bets\/(\d+)$/);
    if (betMatch) {
      const id = parseInt(betMatch[1]);
      if (req.method === 'DELETE') return handleDeleteBet(id, env);
    }

    // ── Stats ─────────────────────────────────────────────────────────────
    if (path === '/stats' && req.method === 'GET') return handleStats(env);

    // ── Commandments ──────────────────────────────────────────────────────
    if (path === '/commandments/today' && req.method === 'GET') return handleGetToday(env);
    if (path === '/commandments' && req.method === 'POST') return handleSaveCommandments(req, env);
    if (path === '/commandments' && req.method === 'GET') return handleGetCommandmentHistory(url, env);

    return err('Not found', 404);
  },
};

// ── Dashboard ───────────────────────────────────────────────────────────────

async function handleDashboard(env: Env) {
  const [stats, monthlyBets, welcomeRow, recentResult, recentLog] = await Promise.all([
    env.DB.prepare(
      `SELECT
         SUM(total_pl) as total_pl,
         COUNT(*) as total_bookies,
         SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active,
         SUM(CASE WHEN status='gubbed' THEN 1 ELSE 0 END) as gubbed
       FROM bookies WHERE status != 'closed'`
    ).first() as Record<string, number | null> | null,
    env.DB.prepare(
      `SELECT SUM(pl) as monthly_pl, COUNT(*) as bet_count
       FROM bets WHERE placed_at >= date('now', 'start of month')`
    ).first() as { monthly_pl: number | null } | null,
    env.DB.prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN welcome_claimed=1 THEN 1 ELSE 0 END) as claimed
       FROM bookies WHERE status != 'closed'`
    ).first() as { total: number | null; claimed: number | null } | null,
    env.DB.prepare(
      `SELECT b.*, bk.name as bookie_name FROM bets b
       JOIN bookies bk ON b.bookie_id = bk.id
       ORDER BY b.placed_at DESC LIMIT 10`
    ).all(),
    env.DB.prepare(
      `SELECT date, checks, mug_bet_placed FROM commandment_logs ORDER BY date DESC LIMIT 1`
    ).first() as { date: string; checks: string; mug_bet_placed: number } | null,
  ]);

  const checks = recentLog ? JSON.parse(recentLog.checks ?? '{}') : {};
  const checkVals = Object.values(checks as Record<string, unknown>);
  const allYes =
    typeof checks === 'object' &&
    checks !== null &&
    checkVals.length >= 12 &&
    checkVals.every((v) => v === true);
  const anyNo = checkVals.some((v) => v === false);

  let compliance_status = 'Incomplete';
  if (allYes) compliance_status = 'Compliant';
  else if (anyNo) compliance_status = 'Needs review';

  return json({
    total_pl: stats?.total_pl ?? 0,
    monthly_pl: monthlyBets?.monthly_pl ?? 0,
    active_bookie_count: stats?.active ?? 0,
    gubbed_count: stats?.gubbed ?? 0,
    welcome_claimed: welcomeRow?.claimed ?? 0,
    welcome_total: welcomeRow?.total ?? 0,
    compliance_status,
    recent_bets: recentResult.results ?? [],
  });
}

// ── Check-in (parsed checks object for UI) ──────────────────────────────────

async function handleGetCheckin(url: URL, env: Env) {
  const date =
    url.searchParams.get('date') ?? new Date().toISOString().split('T')[0];
  const existing = await env.DB.prepare('SELECT * FROM commandment_logs WHERE date = ?')
    .bind(date)
    .first() as {
    date: string;
    checks: string;
    activity_notes: string;
    mug_bet_placed: number;
  } | null;

  if (!existing) {
    return json({
      date,
      checks: {},
      activity_notes: '',
      mug_bet_placed: 0,
    });
  }

  return json({
    date: existing.date,
    checks: JSON.parse(existing.checks ?? '{}') as Record<string, boolean>,
    activity_notes: existing.activity_notes ?? '',
    mug_bet_placed: existing.mug_bet_placed,
  });
}

// ── Bookies ──────────────────────────────────────────────────────────────────

async function handleGetBookies(env: Env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM bookies ORDER BY status ASC, name ASC'
  ).all();
  return json(results);
}

async function handleCreateBookie(req: Request, env: Env) {
  const body = (await req.json()) as Record<string, unknown>;
  if (!body.name) return err('name required');
  const stage =
    typeof body.onboarding_stage === 'number' && body.onboarding_stage >= 1 && body.onboarding_stage <= 5
      ? Math.floor(body.onboarding_stage)
      : 1;
  const { meta } = await env.DB.prepare(
    `INSERT INTO bookies (name, status, welcome_claimed, welcome_profit, current_balance, notes, onboarding_stage)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.name,
      body.status ?? 'active',
      body.welcome_claimed ? 1 : 0,
      body.welcome_profit ?? 0,
      body.current_balance ?? 0,
      body.notes ?? null,
      stage
    )
    .run();
  const created = await env.DB.prepare('SELECT * FROM bookies WHERE id = ?')
    .bind(meta.last_row_id)
    .first();
  return json(created, 201);
}

async function handleUpdateBookie(id: number, req: Request, env: Env) {
  const body = (await req.json()) as Record<string, unknown>;
  if ('onboarding_stage' in body) {
    const n = Number(body.onboarding_stage);
    if (!Number.isFinite(n) || n < 1 || n > 5) return err('onboarding_stage must be 1–5');
    body.onboarding_stage = Math.floor(n);
  }
  const fields: string[] = [];
  const values: unknown[] = [];

  const allowed = [
    'name',
    'status',
    'welcome_claimed',
    'welcome_profit',
    'current_balance',
    'total_pl',
    'notes',
    'onboarding_stage',
  ];
  for (const key of allowed) {
    if (key in body) {
      fields.push(`${key} = ?`);
      values.push(body[key]);
    }
  }
  if (!fields.length) return err('Nothing to update');

  fields.push('last_activity = CURRENT_TIMESTAMP');
  values.push(id);

  await env.DB.prepare(`UPDATE bookies SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
  const updated = await env.DB.prepare('SELECT * FROM bookies WHERE id = ?').bind(id).first();
  return json(updated);
}

async function handleDeleteBookie(id: number, env: Env) {
  await env.DB.prepare(`UPDATE bookies SET status = 'closed' WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}

// ── Bets ─────────────────────────────────────────────────────────────────────

async function handleGetBets(url: URL, env: Env) {
  const bookieId = url.searchParams.get('bookie_id');
  const limit = parseInt(url.searchParams.get('limit') ?? '50');
  let query =
    'SELECT b.*, bk.name as bookie_name FROM bets b JOIN bookies bk ON b.bookie_id = bk.id';
  const params: unknown[] = [];
  if (bookieId) {
    query += ' WHERE b.bookie_id = ?';
    params.push(parseInt(bookieId));
  }
  query += ' ORDER BY b.placed_at DESC LIMIT ?';
  params.push(limit);
  const { results } = await env.DB.prepare(query).bind(...params).all();
  return json(results);
}

async function handleCreateBet(req: Request, env: Env) {
  const b = (await req.json()) as Record<string, unknown>;
  if (!b.bookie_id || !b.bet_type || !b.market) return err('bookie_id, bet_type, market required');

  const { meta } = await env.DB.prepare(
    `INSERT INTO bets (bookie_id, bet_type, market, back_stake, back_odds, lay_stake, lay_odds, commission, pl, is_free_bet, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      b.bookie_id,
      b.bet_type,
      b.market,
      b.back_stake,
      b.back_odds,
      b.lay_stake,
      b.lay_odds,
      b.commission ?? 2.0,
      b.pl,
      b.is_free_bet ? 1 : 0,
      b.notes ?? null
    )
    .run();

  await env.DB.prepare(
    `UPDATE bookies SET total_pl = total_pl + ?, last_activity = CURRENT_TIMESTAMP WHERE id = ?`
  )
    .bind(b.pl, b.bookie_id)
    .run();

  const created = await env.DB.prepare(
    'SELECT b.*, bk.name as bookie_name FROM bets b JOIN bookies bk ON b.bookie_id = bk.id WHERE b.id = ?'
  )
    .bind(meta.last_row_id)
    .first();
  return json(created, 201);
}

async function handleDeleteBet(id: number, env: Env) {
  const bet = (await env.DB.prepare('SELECT * FROM bets WHERE id = ?').bind(id).first()) as {
    pl: number;
    bookie_id: number;
  } | null;
  if (!bet) return err('Bet not found', 404);
  await env.DB.prepare('DELETE FROM bets WHERE id = ?').bind(id).run();
  await env.DB.prepare('UPDATE bookies SET total_pl = total_pl - ? WHERE id = ?')
    .bind(bet.pl, bet.bookie_id)
    .run();
  return json({ ok: true });
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function handleStats(env: Env) {
  const [totals, bookieCounts, monthlyBets] = await Promise.all([
    env.DB.prepare(
      'SELECT SUM(total_pl) as total_pl, SUM(welcome_profit) as welcome_pl FROM bookies WHERE status != "closed"'
    ).first(),
    env.DB.prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active,
         SUM(CASE WHEN status='gubbed' THEN 1 ELSE 0 END) as gubbed,
         SUM(CASE WHEN status='restricted' THEN 1 ELSE 0 END) as restricted,
         SUM(CASE WHEN welcome_claimed=1 THEN 1 ELSE 0 END) as welcome_done
       FROM bookies WHERE status != 'closed'`
    ).first(),
    env.DB.prepare(
      `SELECT SUM(pl) as monthly_pl, COUNT(*) as bet_count
       FROM bets WHERE placed_at >= date('now', 'start of month')`
    ).first(),
  ]);

  return json({ totals, bookieCounts, monthlyBets });
}

// ── Commandments ──────────────────────────────────────────────────────────────

async function handleGetToday(env: Env) {
  const today = new Date().toISOString().split('T')[0];
  const existing = await env.DB.prepare('SELECT * FROM commandment_logs WHERE date = ?')
    .bind(today)
    .first();
  return json(existing ?? { date: today, checks: '{}', activity_notes: '', mug_bet_placed: 0 });
}

async function handleSaveCommandments(req: Request, env: Env) {
  const body = (await req.json()) as Record<string, unknown>;
  const today = (body.date as string) ?? new Date().toISOString().split('T')[0];
  await env.DB.prepare(
    `INSERT INTO commandment_logs (date, checks, activity_notes, mug_bet_placed)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       checks = excluded.checks,
       activity_notes = excluded.activity_notes,
       mug_bet_placed = excluded.mug_bet_placed,
       logged_at = CURRENT_TIMESTAMP`
  )
    .bind(
      today,
      JSON.stringify(body.checks ?? {}),
      body.activity_notes ?? '',
      body.mug_bet_placed ? 1 : 0
    )
    .run();
  return json({ ok: true, date: today });
}

async function handleGetCommandmentHistory(url: URL, env: Env) {
  const limit = parseInt(url.searchParams.get('limit') ?? '30');
  const { results } = await env.DB.prepare(
    'SELECT * FROM commandment_logs ORDER BY date DESC LIMIT ?'
  )
    .bind(limit)
    .all();
  return json(results);
}

// ── Governor Summary ──────────────────────────────────────────────────────────

async function handleGovernorSummary(env: Env) {
  const [stats, recentLog] = await Promise.all([
    env.DB.prepare(
      `SELECT
         SUM(total_pl) as total_pl,
         COUNT(*) as total_bookies,
         SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active,
         SUM(CASE WHEN status='gubbed' THEN 1 ELSE 0 END) as gubbed,
         SUM(CASE WHEN status='restricted' THEN 1 ELSE 0 END) as restricted,
         SUM(CASE WHEN welcome_claimed=1 THEN 1 ELSE 0 END) as welcome_done
       FROM bookies WHERE status != 'closed'`
    ).first() as Record<string, number | null> | null,
    env.DB.prepare(
      `SELECT date, checks, mug_bet_placed FROM commandment_logs ORDER BY date DESC LIMIT 1`
    ).first() as { date: string; checks: string; mug_bet_placed: number } | null,
  ]);

  const checks = recentLog ? JSON.parse(recentLog.checks ?? '{}') : {};
  const violationCount = Object.values(checks as Record<string, unknown>).filter((v) => v === false)
    .length;
  const checkedToday = recentLog?.date === new Date().toISOString().split('T')[0];

  return json({
    summary: {
      total_pl: stats?.total_pl ?? 0,
      active_bookies: stats?.active ?? 0,
      gubbed_bookies: stats?.gubbed ?? 0,
      restricted_bookies: stats?.restricted ?? 0,
      welcome_offers_done: stats?.welcome_done ?? 0,
    },
    compliance: {
      checked_in_today: checkedToday,
      last_check_date: recentLog?.date ?? null,
      violations_flagged: violationCount,
      mug_bet_placed_last_session: recentLog?.mug_bet_placed === 1,
    },
    risk_flag:
      violationCount > 0 || !checkedToday
        ? `⚠ ${!checkedToday ? 'No check-in today. ' : ''}${violationCount > 0 ? `${violationCount} commandment(s) flagged.` : ''}`
        : null,
  });
}
