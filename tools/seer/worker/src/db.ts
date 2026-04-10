import {
  type AerHoldWarning,
  type Opportunity,
  type SuggestedStakeTier,
  aerHoldWarningFromDays,
  aerWarningLevelFromDays,
  getTieredSuggestedStake,
  MIN_VOLUME_USD
} from "./analysis";

export interface Env {
  DB: D1Database;
  /** When set, all `/api/*` routes require `Authorization: Bearer <token>`. */
  API_BEARER_TOKEN?: string;
  /** Required for `POST /admin/*` one-time and test routes. */
  ADMIN_SECRET?: string;
  BETFAIR_APP_KEY?: string;
  BETFAIR_USERNAME?: string;
  BETFAIR_PASSWORD?: string;
  MATCHBOOK_USERNAME?: string;
  MATCHBOOK_PASSWORD?: string;
  SMARKETS_CLIENT_ID?: string;
  SMARKETS_CLIENT_SECRET?: string;
  SMARKETS_REDIRECT_URI?: string;
  SMARKETS_OAUTH_AUTHORIZE_URL?: string;
  SMARKETS_OAUTH_TOKEN_URL?: string;
}

export interface PositionRow {
  id: number;
  market_id: string;
  direction: string;
  stake: number;
  entry_price: number;
  exit_price: number | null;
  profit_loss: number | null;
  status: string;
  mode: string;
  layer: string | null;
  signals_json: string | null;
  created_at: string;
  resolved_at: string | null;
  market_question: string | null;
  market_yes_price: number | null;
  market_no_price: number | null;
  market_end_date: string | null;
  /** From joined markets row; null when no market row matches. */
  market_resolved: number | null;
  market_resolution_outcome: string | null;
}

export interface MarketRow {
  id: string;
  question: string;
  category: string;
  /** ISO 8601 UTC string (`pipeline.normalizeGammaEndDateToIso` from Gamma endDate / endDateIso). */
  end_date: string;
  yes_price: number;
  no_price: number;
  volume: number;
  liquidity: number;
  resolved: number;
  resolution_outcome: string | null;
  /** Implied YES from last trade; used for calibration bucketing (esp. resolved markets). */
  last_trade_price: number | null;
}

/**
 * Minimal `markets` row so `positions.market_id` FK succeeds for exchange-only ids
 * (e.g. paper-betfair). Does not overwrite an existing row (`INSERT OR IGNORE`).
 * Schema uses `end_date` (not resolution_date) and `resolved` integer (0 = open, not a status text column).
 */
export async function insertShadowExchangeMarketIfMissing(
  db: D1Database,
  params: { id: string; question: string; endDateIso: string }
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO markets (
        id, question, category, end_date, yes_price, no_price, volume, liquidity, resolved, resolution_outcome, last_trade_price
      ) VALUES (?, ?, 'exchange', ?, 0.5, 0.5, 0, 0, 0, NULL, NULL)`
    )
    .bind(params.id, params.question, params.endDateIso)
    .run();
}

export async function upsertMarket(env: Env, market: MarketRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO markets (
      id, question, category, end_date, yes_price, no_price, volume, liquidity, resolved, resolution_outcome, last_trade_price
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      question = excluded.question,
      category = excluded.category,
      end_date = excluded.end_date,
      yes_price = excluded.yes_price,
      no_price = excluded.no_price,
      volume = excluded.volume,
      liquidity = excluded.liquidity,
      resolved = excluded.resolved,
      resolution_outcome = excluded.resolution_outcome,
      last_trade_price = COALESCE(excluded.last_trade_price, markets.last_trade_price),
      updated_at = CURRENT_TIMESTAMP`
  )
    .bind(
      market.id,
      market.question,
      market.category,
      market.end_date,
      market.yes_price,
      market.no_price,
      market.volume,
      market.liquidity,
      market.resolved,
      market.resolution_outcome,
      market.last_trade_price
    )
    .run();
}

export async function insertPriceSnapshot(
  env: Env,
  marketId: string,
  yesPrice: number,
  volume: number
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO price_history (market_id, yes_price, volume) VALUES (?, ?, ?)"
  )
    .bind(marketId, yesPrice, volume)
    .run();
}

export async function listActiveMarkets(env: Env): Promise<MarketRow[]> {
  const result = await env.DB
    .prepare(
      `SELECT * FROM markets
       WHERE resolved = 0
         AND volume >= ?
         AND end_date > datetime('now')
       ORDER BY volume DESC`
    )
    .bind(MIN_VOLUME_USD)
    .all<MarketRow>();

  return result.results ?? [];
}

type CalibrationRow = {
  category: string;
  last_trade_price: number | null;
  yes_price: number | null;
  resolution_outcome: string;
};

function impliedYesForCalibration(r: CalibrationRow): number | null {
  const lt = r.last_trade_price;
  if (lt !== null && lt !== undefined) {
    const n = Number(lt);
    if (Number.isFinite(n)) return n;
  }
  const y = r.yes_price;
  if (y !== null && y !== undefined) {
    const n = Number(y);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Rebuild calibration from resolved markets. Uses last_trade_price when set;
 * otherwise falls back to outcome YES price (from outcomePrices) for bucketing.
 */
export async function rebuildCalibrationFromMarkets(env: Env): Promise<number> {
  const result = await env.DB.prepare(
    `SELECT category, last_trade_price, yes_price, resolution_outcome FROM markets
     WHERE resolved = 1
       AND resolution_outcome IN ('YES', 'NO')`
  ).all<CalibrationRow>();

  const rows = result.results ?? [];
  type Agg = { n: number; yes: number };
  const byCatBucket = new Map<string, Map<string, Agg>>();

  for (const r of rows) {
    const implied = impliedYesForCalibration(r);
    if (implied === null) continue;
    const bucket = impliedYesToBucket(implied);
    if (bucket === null) continue;
    let inner = byCatBucket.get(r.category);
    if (!inner) {
      inner = new Map();
      byCatBucket.set(r.category, inner);
    }
    const agg = inner.get(bucket) ?? { n: 0, yes: 0 };
    agg.n += 1;
    if (r.resolution_outcome === "YES") agg.yes += 1;
    inner.set(bucket, agg);
  }

  await env.DB.prepare("DELETE FROM calibration").run();

  let inserted = 0;
  const statements: D1PreparedStatement[] = [];
  for (const [category, buckets] of byCatBucket) {
    for (const [price_bucket, agg] of buckets) {
      const rate = agg.n > 0 ? agg.yes / agg.n : 0;
      statements.push(
        env.DB.prepare(
          `INSERT INTO calibration (category, price_bucket, sample_size, resolution_rate, last_updated)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
        ).bind(category, price_bucket, agg.n, rate)
      );
      inserted += 1;
    }
  }

  const chunk = 90;
  for (let i = 0; i < statements.length; i += chunk) {
    await env.DB.batch(statements.slice(i, i + chunk));
  }

  return inserted;
}

/** 0–10%, … 90–100% from implied YES in [0, 1]. */
export function impliedYesToBucket(impliedYes: number): string | null {
  if (Number.isNaN(impliedYes)) return null;
  const p = Math.max(0, Math.min(1, impliedYes));
  const idx = Math.min(9, Math.floor(p * 10));
  const low = idx * 10;
  return `${low}-${low + 10}%`;
}

const OPP_BATCH = 80;

function opportunityInsertStatements(
  db: D1Database,
  opportunities: Opportunity[],
  computedAt: string
): D1PreparedStatement[] {
  return opportunities.map((o) =>
    db
      .prepare(
        `INSERT INTO opportunities (
          computed_at, market_id, question, category, direction, current_price,
          days_to_resolution, aer, time_to_double, psychology_score, layer,
          kelly_fraction, suggested_stake, calibrated_probability, market_probability, signals_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        computedAt,
        o.marketId,
        o.question,
        o.category,
        o.direction,
        o.currentPrice,
        o.daysToResolution,
        o.aer,
        o.timeToDouble,
        o.psychologyScore,
        o.layer,
        o.kellyFraction,
        o.suggestedStake,
        o.calibratedProbability,
        o.marketProbability,
        JSON.stringify(o.signals)
      )
  );
}

async function runOpportunityInserts(
  db: D1Database,
  statements: D1PreparedStatement[]
): Promise<void> {
  for (let i = 0; i < statements.length; i += OPP_BATCH) {
    await db.batch(statements.slice(i, i + OPP_BATCH));
  }
}

export async function replaceOpportunities(
  db: D1Database,
  opportunities: Opportunity[],
  computedAt: string
): Promise<void> {
  await db.prepare("DELETE FROM opportunities").run();
  if (opportunities.length === 0) return;
  await runOpportunityInserts(
    db,
    opportunityInsertStatements(db, opportunities, computedAt)
  );
}

/** Append rows without clearing (paginated analysis after the first page). */
export async function insertOpportunities(
  db: D1Database,
  opportunities: Opportunity[],
  computedAt: string
): Promise<void> {
  if (opportunities.length === 0) return;
  await runOpportunityInserts(
    db,
    opportunityInsertStatements(db, opportunities, computedAt)
  );
}

export async function clearOpportunities(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM opportunities").run();
}

/** Latest `computed_at` across stored opportunities (cron / analysis refresh time). */
export async function getOpportunitiesLastUpdated(
  db: D1Database
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT MAX(computed_at) AS last_updated FROM opportunities`)
    .first<{ last_updated: string | null }>();
  return row?.last_updated ?? null;
}

export type StoredOpportunity = {
  marketId: string;
  question: string;
  category: string;
  direction: string;
  currentPrice: number;
  daysToResolution: number;
  aer: number;
  timeToDouble: number;
  psychologyScore: number;
  layer: string;
  kellyFraction: number;
  suggestedStake: number;
  calibratedProbability: number;
  marketProbability: number;
  signals: string[];
  computedAt: string;
  aerHoldWarning?: AerHoldWarning;
  aerWarning?: "amber" | "red";
  tieredStakeFraction: number;
  suggestedStakeTier: SuggestedStakeTier;
  /** Set by GET /api/opportunities when joined to open positions. */
  hasOpenPosition?: boolean;
  openPositionDirection?: "YES" | "NO" | null;
};

function layerForTieredStake(layer: string): "1" | "2" | "3" {
  const t = layer.trim();
  if (t === "1") return "1";
  if (t === "3") return "3";
  return "2";
}

export async function listStoredOpportunities(
  db: D1Database
): Promise<StoredOpportunity[]> {
  const { results = [] } = await db
    .prepare(
      `SELECT market_id, question, category, direction, current_price, days_to_resolution,
              aer, time_to_double, psychology_score, layer, kelly_fraction, suggested_stake,
              calibrated_probability, market_probability, signals_json, computed_at
       FROM opportunities
       ORDER BY aer DESC`
    )
    .all<{
      market_id: string;
      question: string;
      category: string;
      direction: string;
      current_price: number;
      days_to_resolution: number;
      aer: number;
      time_to_double: number;
      psychology_score: number;
      layer: string;
      kelly_fraction: number;
      suggested_stake: number;
      calibrated_probability: number;
      market_probability: number;
      signals_json: string;
      computed_at: string;
    }>();

  return results.map((r) => {
    const w = aerHoldWarningFromDays(r.days_to_resolution);
    const aw = aerWarningLevelFromDays(r.days_to_resolution);
    const tiered = getTieredSuggestedStake(1, {
      daysToResolution: r.days_to_resolution,
      currentPrice: r.current_price,
      layer: layerForTieredStake(r.layer)
    });
    return {
      marketId: r.market_id,
      question: r.question,
      category: r.category,
      direction: r.direction,
      currentPrice: r.current_price,
      daysToResolution: r.days_to_resolution,
      aer: r.aer,
      timeToDouble: r.time_to_double,
      psychologyScore: r.psychology_score,
      layer: r.layer,
      kellyFraction: r.kelly_fraction,
      suggestedStake: r.suggested_stake,
      tieredStakeFraction: tiered.stake,
      suggestedStakeTier: tiered.tier,
      calibratedProbability: r.calibrated_probability,
      marketProbability: r.market_probability,
      signals: safeParseSignals(r.signals_json),
      computedAt: r.computed_at,
      ...(w ? { aerHoldWarning: w } : {}),
      ...(aw ? { aerWarning: aw } : {})
    };
  });
}

function safeParseSignals(json: string): string[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export async function listPositionsWithMarket(
  db: D1Database
): Promise<PositionRow[]> {
  const { results = [] } = await db
    .prepare(
      `SELECT p.id, p.market_id, p.direction, p.stake, p.entry_price, p.exit_price, p.profit_loss,
              p.status, p.mode, p.layer, p.signals_json, p.created_at, p.resolved_at,
              COALESCE(m.question, p.market_question) AS market_question,
              m.yes_price AS market_yes_price,
              m.no_price AS market_no_price,
              m.end_date AS market_end_date,
              m.resolved AS market_resolved,
              m.resolution_outcome AS market_resolution_outcome
       FROM positions p
       LEFT JOIN markets m ON CAST(p.market_id AS TEXT) = CAST(m.id AS TEXT)
       ORDER BY p.created_at DESC`
    )
    .all<PositionRow>();

  return results;
}

export async function getMarketForPosition(
  db: D1Database,
  marketId: string
): Promise<{ yes_price: number; no_price: number; question: string } | null> {
  const row = await db
    .prepare(
      "SELECT yes_price, no_price, question FROM markets WHERE id = ? LIMIT 1"
    )
    .bind(marketId)
    .first<{
      yes_price: number;
      no_price: number;
      question: string;
    }>();
  return row ?? null;
}

/** Count OPEN rows for same market + direction (duplicate guard). */
export async function countOpenPositionsForMarketAndDirection(
  db: D1Database,
  marketId: string,
  direction: "YES" | "NO"
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM positions
       WHERE CAST(market_id AS TEXT) = CAST(? AS TEXT)
         AND UPPER(TRIM(direction)) = UPPER(?)
         AND status = 'OPEN'`
    )
    .bind(marketId, direction)
    .first<{ c: number }>();
  return Number(row?.c ?? 0);
}

/** True if an OPEN row exists for this market and direction (paper or live). */
export async function hasOpenPositionForMarketAndDirection(
  db: D1Database,
  marketId: string,
  direction: "YES" | "NO"
): Promise<boolean> {
  return (await countOpenPositionsForMarketAndDirection(db, marketId, direction)) > 0;
}

/** First OPEN direction per market_id (for opportunities placement hints). */
export async function listOpenPositionsMarketDirections(
  db: D1Database
): Promise<Map<string, "YES" | "NO">> {
  const { results = [] } = await db
    .prepare(
      `SELECT market_id, direction FROM positions WHERE status = 'OPEN'`
    )
    .all<{ market_id: string; direction: string }>();
  const m = new Map<string, "YES" | "NO">();
  for (const r of results) {
    const id = String(r.market_id);
    if (m.has(id)) continue;
    const d = String(r.direction ?? "").trim().toUpperCase();
    m.set(id, d === "NO" ? "NO" : "YES");
  }
  return m;
}

export type InsertOpenPositionParams = {
  marketId: string;
  direction: "YES" | "NO";
  stake: number;
  mode: "LIVE" | "PAPER";
  entryPrice: number;
  layer: string | number | null;
  signalsJson: string | null;
  /** Denormalised label when there is no `markets` row (e.g. exchange paper). Falls back to `marketId`. */
  marketQuestion?: string | null;
  platform: string | null;
  platform_bet_id: string | null;
  platform_odds: number | null;
  appliedCommission?: number | null;
};

export async function insertOpenPosition(
  db: D1Database,
  p: InsertOpenPositionParams
): Promise<{ id: number }> {
  const layer =
    p.layer === null || p.layer === undefined ? null : String(p.layer);
  const signalsJson = p.signalsJson ?? "[]";
  const ac =
    p.appliedCommission != null && Number.isFinite(p.appliedCommission)
      ? p.appliedCommission
      : 0;
  const marketQuestion = p.marketQuestion ?? p.marketId;

  const row = await db
    .prepare(
      `INSERT INTO positions (
        market_id, direction, stake, mode, status, entry_price, layer, signals_json,
        market_question, platform, platform_bet_id, platform_odds, applied_commission
      ) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id`
    )
    .bind(
      p.marketId,
      p.direction,
      p.stake,
      p.mode,
      p.entryPrice,
      layer,
      signalsJson,
      marketQuestion,
      p.platform,
      p.platform_bet_id,
      p.platform_odds,
      ac
    )
    .first<{ id: number }>();

  if (!row?.id) {
    throw new Error("insertOpenPosition: missing id");
  }
  return { id: row.id };
}

export async function deletePositionById(
  db: D1Database,
  positionId: number
): Promise<void> {
  await db.prepare(`DELETE FROM positions WHERE id = ?`).bind(positionId).run();
}

export async function updatePositionPlatformBetId(
  db: D1Database,
  positionId: number,
  betId: string
): Promise<void> {
  await db
    .prepare(`UPDATE positions SET platform_bet_id = ? WHERE id = ?`)
    .bind(betId, positionId)
    .run();
}

/** Close OPEN positions whose markets are resolved (YES/NO). */
export async function autoResolveOpenPositions(db: D1Database): Promise<number> {
  type Row = {
    id: number;
    stake: number;
    entry_price: number;
    direction: string;
    yes_price: number;
    no_price: number;
    resolution_outcome: string;
  };
  const { results = [] } = await db
    .prepare(
      `SELECT p.id, p.stake, p.entry_price, p.direction,
              m.yes_price, m.no_price, m.resolution_outcome
       FROM positions p
       INNER JOIN markets m ON CAST(p.market_id AS TEXT) = CAST(m.id AS TEXT)
       WHERE p.status = 'OPEN'
         AND m.resolved = 1
         AND m.resolution_outcome IS NOT NULL
         AND m.resolution_outcome IN ('YES', 'NO')`
    )
    .all<Row>();

  let count = 0;
  for (const row of results) {
    if (row.entry_price <= 0) continue;
    const won =
      row.direction === "YES"
        ? row.resolution_outcome === "YES"
        : row.resolution_outcome === "NO";
    const profit = won
      ? row.stake * (1 / row.entry_price - 1)
      : -row.stake;
    const exitPrice =
      row.direction === "YES" ? row.yes_price : row.no_price;
    await db
      .prepare(
        `UPDATE positions
         SET status = 'CLOSED', exit_price = ?, profit_loss = ?, resolved_at = datetime('now')
         WHERE id = ?`
      )
      .bind(exitPrice, profit, row.id)
      .run();
    count += 1;
  }
  return count;
}

export async function getAppMeta(
  db: D1Database,
  key: string
): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM app_meta WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setAppMeta(
  db: D1Database,
  key: string,
  value: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .bind(key, value)
    .run();
}

type CalibrationDbRow = {
  category: string;
  price_bucket: string;
  sample_size: number;
  resolution_rate: number;
  last_updated: string;
};

export async function listCalibrationRows(
  db: D1Database
): Promise<CalibrationDbRow[]> {
  const { results = [] } = await db
    .prepare(
      "SELECT category, price_bucket, sample_size, resolution_rate, last_updated FROM calibration ORDER BY category, price_bucket"
    )
    .all<CalibrationDbRow>();

  return results;
}

type PositionMarketJoin = {
  id: number;
  stake: number;
  entry_price: number;
  direction: string;
  status: string;
  resolved: number;
  resolution_outcome: string | null;
  yes_price: number;
  no_price: number;
};

/**
 * Close an OPEN position using the linked market's resolution (for paper testing).
 */
export async function resolveOpenPositionWithMarket(
  db: D1Database,
  positionId: number
): Promise<
  | { ok: true; profit_loss: number; exit_price: number }
  | { ok: false; error: string }
> {
  const row = await db
    .prepare(
      `SELECT p.id, p.stake, p.entry_price, p.direction, p.status,
              m.resolved, m.resolution_outcome, m.yes_price, m.no_price
       FROM positions p
       JOIN markets m ON CAST(p.market_id AS TEXT) = CAST(m.id AS TEXT)
       WHERE p.id = ?`
    )
    .bind(positionId)
    .first<PositionMarketJoin>();

  if (!row) return { ok: false, error: "position_not_found" };
  if (row.status !== "OPEN") return { ok: false, error: "not_open" };
  if (row.resolved !== 1 || !row.resolution_outcome) {
    return { ok: false, error: "market_not_resolved" };
  }
  if (row.entry_price <= 0) return { ok: false, error: "bad_entry" };

  const won =
    row.direction === "YES"
      ? row.resolution_outcome === "YES"
      : row.resolution_outcome === "NO";
  const profit = won ? row.stake / row.entry_price - row.stake : -row.stake;
  const exitPrice =
    row.direction === "YES" ? row.yes_price : row.no_price;

  await db
    .prepare(
      `UPDATE positions
       SET status = 'CLOSED', exit_price = ?, profit_loss = ?, resolved_at = datetime('now')
       WHERE id = ?`
    )
    .bind(exitPrice, profit, positionId)
    .run();

  return { ok: true, profit_loss: profit, exit_price: exitPrice };
}
