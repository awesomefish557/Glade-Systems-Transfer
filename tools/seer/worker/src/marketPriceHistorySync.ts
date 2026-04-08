import type { Env } from "./db";
import { upsertMarket } from "./db";
import {
  normalizeGammaEndDateToIso,
  normalizeMarketRow,
  type PolymarketMarket
} from "./pipeline";

const GAMMA_CLOSED =
  "https://gamma-api.polymarket.com/markets?closed=true&order=endDate&ascending=false";

const SEC_PER_DAY = 86_400;

function parseYesClobTokenId(raw: PolymarketMarket): string | null {
  const ids = raw.clobTokenIds;
  if (!ids || typeof ids !== "string") return null;
  try {
    const arr = JSON.parse(ids) as unknown;
    if (!Array.isArray(arr) || arr.length < 1) return null;
    const first = String(arr[0]).trim();
    return first.length > 0 ? first : null;
  } catch {
    return null;
  }
}

function parseGammaResolutionMs(raw: PolymarketMarket): number | null {
  if (raw.umaEndDate) {
    const ms = Date.parse(raw.umaEndDate);
    if (!Number.isNaN(ms)) return ms;
  }
  const ct = raw.closedTime;
  if (ct && typeof ct === "string") {
    let s = ct.trim().replace(" ", "T");
    if (/\+\d{2}$/.test(s)) s += ":00";
    const ms = Date.parse(s);
    if (!Number.isNaN(ms)) return ms;
  }
  const iso = normalizeGammaEndDateToIso(raw);
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function clampYesPrice(p: number): number {
  if (!Number.isFinite(p) || p <= 0) return 0.01;
  if (p >= 1) return 0.99;
  return p;
}

/**
 * YES price at or before (resolution − daysBefore); if no earlier point, earliest candle in series.
 */
function yesPriceBeforeResolution(
  history: Array<{ t: number; p: number }>,
  resolutionSec: number,
  daysBefore: number
): number | null {
  if (history.length === 0 || !Number.isFinite(resolutionSec)) return null;
  const sorted = [...history].sort((a, b) => a.t - b.t);
  const target = resolutionSec - daysBefore * SEC_PER_DAY;
  let chosen: { t: number; p: number } | null = null;
  for (const pt of sorted) {
    if (pt.t <= target) chosen = pt;
    else break;
  }
  if (!chosen) chosen = sorted[0];
  return clampYesPrice(chosen.p);
}

async function fetchClobPriceHistory(
  tokenId: string
): Promise<Array<{ t: number; p: number }>> {
  const url = `https://clob.polymarket.com/prices-history?market=${encodeURIComponent(tokenId)}&interval=max&fidelity=720`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const j = (await res.json()) as { history?: Array<{ t: number; p: number }> };
  if (!Array.isArray(j.history)) return [];
  return j.history.filter(
    (x) =>
      x &&
      typeof x.t === "number" &&
      typeof x.p === "number" &&
      Number.isFinite(x.t) &&
      Number.isFinite(x.p)
  );
}

async function fetchClosedMarketsPage(
  limit: number,
  offset: number
): Promise<PolymarketMarket[]> {
  const url = `${GAMMA_CLOSED}&limit=${limit}&offset=${offset}`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Gamma HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error("Gamma: expected JSON array");
  return data as PolymarketMarket[];
}

export interface SyncMarketPriceHistoryResult {
  ok: boolean;
  fetched: number;
  written: number;
  skipped: number;
  errors: string[];
}

/**
 * Pull closed markets from Gamma, CLOB `prices-history` per YES token, upsert `market_price_history`.
 * Keep `limit` modest per call (e.g. 25–40) to stay within Worker subrequest limits.
 */
export async function syncMarketPriceHistoryFromPolymarket(
  env: Env,
  options: { limit: number; offset: number }
): Promise<SyncMarketPriceHistoryResult> {
  const { limit, offset } = options;
  const errors: string[] = [];
  let written = 0;
  let skipped = 0;

  let markets: PolymarketMarket[];
  try {
    markets = await fetchClosedMarketsPage(limit, offset);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(msg);
    return { ok: false, fetched: 0, written: 0, skipped: 0, errors };
  }

  for (const raw of markets) {
    const row = normalizeMarketRow(raw);
    if (!row) {
      skipped += 1;
      continue;
    }
    if (
      row.resolved !== 1 ||
      (row.resolution_outcome !== "YES" && row.resolution_outcome !== "NO")
    ) {
      skipped += 1;
      continue;
    }

    const tokenId = parseYesClobTokenId(raw);
    const resMs = parseGammaResolutionMs(raw);
    if (!tokenId || resMs === null) {
      skipped += 1;
      continue;
    }
    const resolutionSec = Math.floor(resMs / 1000);

    let history: Array<{ t: number; p: number }>;
    try {
      history = await fetchClobPriceHistory(tokenId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${row.id} clob: ${msg}`);
      skipped += 1;
      continue;
    }

    const p30 = yesPriceBeforeResolution(history, resolutionSec, 30);
    const p7 = yesPriceBeforeResolution(history, resolutionSec, 7);
    const p1 = yesPriceBeforeResolution(history, resolutionSec, 1);
    if (p30 == null || p30 <= 0) {
      skipped += 1;
      continue;
    }

    try {
      await upsertMarket(env, row);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${row.id} upsert: ${msg}`);
      skipped += 1;
      continue;
    }

    try {
      await env.DB.prepare(
        `INSERT INTO market_price_history (
           market_id, price_30d_before, price_7d_before, price_1d_before, resolution_outcome, updated_at
         ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(market_id) DO UPDATE SET
           price_30d_before = excluded.price_30d_before,
           price_7d_before = excluded.price_7d_before,
           price_1d_before = excluded.price_1d_before,
           resolution_outcome = excluded.resolution_outcome,
           updated_at = CURRENT_TIMESTAMP`
      )
        .bind(row.id, p30, p7, p1, row.resolution_outcome)
        .run();
      written += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${row.id} d1: ${msg}`);
      skipped += 1;
    }
  }

  return {
    ok: errors.length === 0,
    fetched: markets.length,
    written,
    skipped,
    errors
  };
}
