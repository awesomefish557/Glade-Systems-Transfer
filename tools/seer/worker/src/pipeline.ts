/**
 * Polymarket Gamma / CLOB ingestion — signal and research / D1 corpus only.
 * Seer does not treat Polymarket as a UK tradeable venue; live trading uses Betfair, Matchbook, and Smarkets.
 */

import type { Env } from "./db";
import {
  insertPriceSnapshot,
  rebuildCalibrationFromMarkets,
  upsertMarket
} from "./db";

const OPEN_MARKETS_URL =
  "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=500";
const RESOLVED_MARKETS_URL =
  "https://gamma-api.polymarket.com/markets?closed=true&limit=500&order=endDate&ascending=false";

export interface PipelineResult {
  ok: boolean;
  errors: string[];
  openFetched: number;
  resolvedFetched: number;
  marketsUpserted: number;
  priceSnapshotsWritten: number;
  calibrationBucketsWritten: number;
}

export type PolymarketMarket = {
  id?: string;
  conditionId?: string;
  question?: string;
  title?: string;
  clobTokenIds?: string;
  umaEndDate?: string;
  closedTime?: string;
  endDate?: string;
  closed?: boolean;
  active?: boolean;
  volume?: string | number;
  volumeNum?: number;
  outcomes?: string;
  outcomePrices?: string;
  [key: string]: unknown;
};

/** Row shape for D1 `markets` upsert (matches worker `MarketRow`). */
export type PipelineMarketRow = {
  id: string;
  question: string;
  category: string;
  end_date: string;
  yes_price: number;
  no_price: number;
  volume: number;
  liquidity: number;
  resolved: number;
  resolution_outcome: "YES" | "NO" | null;
  last_trade_price: number | null;
};

function parseJsonStringArray(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x));
  } catch {
    return [];
  }
}

function clampProb(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(0.99, Math.max(0.01, p));
}

export function normalizeGammaEndDateToIso(raw: PolymarketMarket): string {
  const end = raw.endDate;
  if (typeof end === "string" && end.trim().length > 0) {
    const ms = Date.parse(end.trim());
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  }
  return new Date(Date.now() + 30 * 864e5).toISOString();
}

/**
 * Map a Gamma market JSON object into a `markets` table row. Returns null if unusable.
 */
export function normalizeMarketRow(raw: PolymarketMarket): PipelineMarketRow | null {
  const id = String(raw.id ?? raw.conditionId ?? "").trim();
  if (!id) return null;

  const question = String(raw.question ?? raw.title ?? "Unknown").slice(0, 4000);
  const priceStrs = parseJsonStringArray(raw.outcomePrices);
  const prices = priceStrs
    .map((s) => parseFloat(s))
    .filter((n) => Number.isFinite(n));

  let yes_price = 0.5;
  let no_price = 0.5;
  if (prices.length >= 2) {
    yes_price = clampProb(prices[0]!);
    no_price = clampProb(prices[1]!);
  } else if (prices.length === 1) {
    yes_price = clampProb(prices[0]!);
    no_price = clampProb(1 - yes_price);
  }

  const volRaw = raw.volumeNum ?? raw.volume;
  const volume =
    typeof volRaw === "number" && Number.isFinite(volRaw)
      ? Math.max(0, volRaw)
      : typeof volRaw === "string"
        ? Math.max(0, parseFloat(volRaw) || 0)
        : 0;

  const closed = Boolean(raw.closed);
  let resolution_outcome: "YES" | "NO" | null = null;
  if (closed && prices.length >= 2) {
    if (prices[0]! >= 0.95) resolution_outcome = "YES";
    else if (prices[1]! >= 0.95) resolution_outcome = "NO";
  }

  return {
    id,
    question,
    category: "other",
    end_date: normalizeGammaEndDateToIso(raw),
    yes_price,
    no_price,
    volume,
    liquidity: 0,
    resolved: closed ? 1 : 0,
    resolution_outcome,
    last_trade_price: yes_price
  };
}

async function fetchMarketsSafe(
  url: string,
  label: string,
  errors: string[]
): Promise<PolymarketMarket[]> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(
        "[seer/pipeline] Polymarket HTTP error",
        label,
        response.status,
        text.slice(0, 200)
      );
      errors.push(`${label}: HTTP ${response.status}`);
      return [];
    }
    const data = (await response.json()) as unknown;
    if (!Array.isArray(data)) {
      console.error("[seer/pipeline] unexpected JSON shape", label);
      errors.push(`${label}: response was not an array`);
      return [];
    }
    return data as PolymarketMarket[];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seer/pipeline] Polymarket fetch failed", label, msg);
    errors.push(`${label}: ${msg}`);
    return [];
  }
}

/**
 * Polymarket → D1: upsert open + resolved, snapshots for open rows, rebuild calibration.
 */
export async function runPipeline(env: Env): Promise<PipelineResult> {
  const errors: string[] = [];
  let marketsUpserted = 0;
  let priceSnapshotsWritten = 0;
  let calibrationBucketsWritten = 0;

  const [openRaw, resolvedRaw] = await Promise.all([
    fetchMarketsSafe(OPEN_MARKETS_URL, "open markets", errors),
    fetchMarketsSafe(RESOLVED_MARKETS_URL, "resolved markets", errors)
  ]);

  const openFetched = openRaw.length;
  const resolvedFetched = resolvedRaw.length;

  const merged = new Map<string, PolymarketMarket>();
  for (const m of openRaw) {
    const id = String(m.id ?? m.conditionId ?? "").trim();
    if (id) merged.set(id, { ...m, id });
  }
  for (const m of resolvedRaw) {
    const id = String(m.id ?? m.conditionId ?? "").trim();
    if (id) merged.set(id, { ...m, id });
  }

  for (const raw of merged.values()) {
    const row = normalizeMarketRow(raw);
    if (!row) continue;

    try {
      await upsertMarket(env, row);
      marketsUpserted += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[seer/pipeline] upsertMarket failed", row.id, msg);
      errors.push(`upsert ${row.id}: ${msg}`);
      continue;
    }

    if (row.resolved === 0) {
      try {
        await insertPriceSnapshot(env, row.id, row.yes_price, row.volume);
        priceSnapshotsWritten += 1;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[seer/pipeline] price snapshot failed", row.id, msg);
        errors.push(`snapshot ${row.id}: ${msg}`);
      }
    }
  }

  try {
    calibrationBucketsWritten = await rebuildCalibrationFromMarkets(env);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seer/pipeline] rebuildCalibrationFromMarkets failed", msg);
    errors.push(`calibration rebuild: ${msg}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    openFetched,
    resolvedFetched,
    marketsUpserted,
    priceSnapshotsWritten,
    calibrationBucketsWritten
  };
}
