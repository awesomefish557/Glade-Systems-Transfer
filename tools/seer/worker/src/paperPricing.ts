import type { Env } from "./db";
import {
  buildLivePlatformComparison,
  COMMISSION_ON_WINNINGS,
  fetchAllPlatformMarketsWithFeeds
} from "./platforms";

export const PAPER_PLATFORM_IDS = [
  "polymarket",
  "paper-betfair",
  "paper-matchbook",
  "paper-smarkets"
] as const;

export type PaperPlatformId = (typeof PAPER_PLATFORM_IDS)[number];

export function parsePaperPlatformId(
  raw: string | undefined | null
): PaperPlatformId {
  const x = (raw ?? "").trim().toLowerCase();
  if (x === "" || x === "polymarket" || x === "pm" || x === "paper-pm") {
    return "polymarket";
  }
  if (
    x === "paper-betfair" ||
    x === "paper_bf" ||
    x === "bf" ||
    x === "betfair"
  ) {
    return "paper-betfair";
  }
  if (
    x === "paper-matchbook" ||
    x === "paper_mb" ||
    x === "mb" ||
    x === "matchbook"
  ) {
    return "paper-matchbook";
  }
  if (
    x === "paper-smarkets" ||
    x === "paper_sm" ||
    x === "sm" ||
    x === "smarkets"
  ) {
    return "paper-smarkets";
  }
  if ((PAPER_PLATFORM_IDS as readonly string[]).includes(x)) {
    return x as PaperPlatformId;
  }
  return "polymarket";
}

export type ResolvedPaperPricing =
  | {
      ok: true;
      entryPrice: number;
      appliedCommission: number;
      /** Polymarket corpus question (for `positions.market_question`). */
      marketQuestion: string;
      /** Stored on `positions.platform` */
      positionPlatform: PaperPlatformId;
      /** Which exchange column supplied the price (PM = corpus). */
      priceSource: "polymarket" | "betfair" | "matchbook" | "smarkets";
    }
  | { ok: false; error: string };

/**
 * Resolve entry price for a paper bet: Polymarket corpus row, or live BF/MB/SM via fuzzy match.
 */
export async function resolvePaperVenuePricing(
  env: Env,
  params: {
    polymarketMarketId: string;
    direction: "YES" | "NO";
    paperPlatform: PaperPlatformId;
  }
): Promise<ResolvedPaperPricing> {
  const row = await env.DB.prepare(
    `SELECT id, question, yes_price, no_price FROM markets WHERE id = ?`
  )
    .bind(params.polymarketMarketId)
    .first<{
      id: string;
      question: string;
      yes_price: number;
      no_price: number;
    }>();

  if (!row) return { ok: false, error: "market_not_found" };

  if (params.paperPlatform === "polymarket") {
    const entry =
      params.direction === "YES" ? row.yes_price : row.no_price;
    if (!Number.isFinite(entry) || entry <= 0 || entry >= 1) {
      return { ok: false, error: "invalid_polymarket_price" };
    }
    return {
      ok: true,
      entryPrice: entry,
      appliedCommission: COMMISSION_ON_WINNINGS.polymarket,
      marketQuestion: row.question,
      positionPlatform: "polymarket",
      priceSource: "polymarket"
    };
  }

  const { markets: universal } = await fetchAllPlatformMarketsWithFeeds(env);
  const pmRows = [
    {
      question: row.question,
      yes_price: row.yes_price,
      no_price: row.no_price
    }
  ];
  const comp = buildLivePlatformComparison(
    row.question,
    params.direction,
    universal,
    pmRows,
    {}
  );

  const slot =
    params.paperPlatform === "paper-betfair"
      ? { col: comp.betfair, source: "betfair" as const }
      : params.paperPlatform === "paper-matchbook"
        ? { col: comp.matchbook, source: "matchbook" as const }
        : { col: comp.smarkets, source: "smarkets" as const };

  const col = slot.col;
  const p = col?.price;
  if (p == null || !Number.isFinite(p) || p <= 0 || p >= 1) {
    return { ok: false, error: "no_matched_exchange_price" };
  }

  return {
    ok: true,
    entryPrice: p,
    appliedCommission: col!.commission,
    marketQuestion: row.question,
    positionPlatform: params.paperPlatform,
    priceSource: slot.source
  };
}
