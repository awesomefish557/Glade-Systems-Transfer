import type { UniversalMarket, UniversalPlatform } from "./types";

/** Commission on winnings (not stake) per venue — used for net P&L estimates. */
export const COMMISSION_ON_WINNINGS: Record<
  "polymarket" | "betfair" | "matchbook" | "smarkets",
  number
> = {
  polymarket: 0,
  betfair: 0.05,
  matchbook: 0.01,
  smarkets: 0.02
};

export type ComparisonPlatformKey =
  | "polymarket"
  | "betfair"
  | "matchbook"
  | "smarkets";

export type LivePlatformPriceColumn = {
  price: number | null;
  /** Profit if the bet wins, per 1 unit staked, after commission on winnings. */
  netProfitIfWinPerUnit: number | null;
  commission: number;
  matchedQuestion?: string;
  /** Same as netProfitIfWinPerUnit × suggested stake, when stake was passed in. */
  expectedNetProfitIfWin?: number | null;
};

export type LivePlatformComparison = {
  direction: "YES" | "NO";
  polymarket: LivePlatformPriceColumn | null;
  betfair: LivePlatformPriceColumn | null;
  matchbook: LivePlatformPriceColumn | null;
  smarkets: LivePlatformPriceColumn | null;
  bestPlatform: ComparisonPlatformKey | null;
  /** Stake used for expectedNetProfitIfWin fields, if any. */
  suggestedStake?: number;
};

function normalizeKey(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .sort()
    .join(" ");
}

function jaccard(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

export function netProfitIfWinPerUnit(
  contractPrice: number,
  commission: number
): number | null {
  if (contractPrice <= 0 || contractPrice >= 1 || !Number.isFinite(contractPrice)) {
    return null;
  }
  const grossWin = 1 / contractPrice - 1;
  if (grossWin <= 0) return null;
  return grossWin * (1 - Math.min(0.99, Math.max(0, commission)));
}

function withStake(
  col: LivePlatformPriceColumn | null,
  stake: number | undefined
): LivePlatformPriceColumn | null {
  if (!col || stake == null || !Number.isFinite(stake) || stake <= 0) {
    return col;
  }
  const per = col.netProfitIfWinPerUnit;
  return {
    ...col,
    expectedNetProfitIfWin:
      per != null && Number.isFinite(per) ? per * stake : null
  };
}

function bestMatchUniversal(
  anchorNorm: string,
  platform: UniversalPlatform,
  universal: UniversalMarket[],
  minSim: number
): UniversalMarket | null {
  let best: UniversalMarket | null = null;
  let bestSim = 0;
  for (const m of universal) {
    if (m.platform !== platform) continue;
    const sim = jaccard(anchorNorm, normalizeKey(m.question));
    if (sim >= minSim && sim > bestSim) {
      bestSim = sim;
      best = m;
    }
  }
  return best;
}

function bestMatchPolymarket(
  anchorNorm: string,
  rows: Array<{ question: string; yes_price: number; no_price: number }>,
  minSim: number
): { question: string; yes_price: number; no_price: number } | null {
  let best: { question: string; yes_price: number; no_price: number } | null =
    null;
  let bestSim = 0;
  for (const r of rows) {
    const sim = jaccard(anchorNorm, normalizeKey(r.question));
    if (sim >= minSim && sim > bestSim) {
      bestSim = sim;
      best = r;
    }
  }
  return best;
}

function columnFromMarket(
  m: UniversalMarket,
  direction: "YES" | "NO"
): LivePlatformPriceColumn {
  const price = direction === "YES" ? m.yesPrice : m.noPrice;
  return {
    price,
    netProfitIfWinPerUnit: netProfitIfWinPerUnit(price, m.commission),
    commission: m.commission,
    matchedQuestion: m.question
  };
}

function columnFromPm(
  row: { question: string; yes_price: number; no_price: number },
  direction: "YES" | "NO"
): LivePlatformPriceColumn {
  const c = COMMISSION_ON_WINNINGS.polymarket;
  const price = direction === "YES" ? row.yes_price : row.no_price;
  return {
    price,
    netProfitIfWinPerUnit: netProfitIfWinPerUnit(price, c),
    commission: c,
    matchedQuestion: row.question
  };
}

export type BuildLivePlatformComparisonOptions = {
  minSim?: number;
  /** When set, each column gets expectedNetProfitIfWin = per-unit × stake. */
  suggestedStake?: number;
};

/**
 * Fuzzy-match the same idea across Polymarket (D1 corpus) and UK exchanges.
 * Anchor is typically the exchange opportunity question or the Polymarket question.
 */
export function buildLivePlatformComparison(
  anchorQuestion: string,
  direction: "YES" | "NO",
  universal: UniversalMarket[],
  polymarketRows: Array<{
    question: string;
    yes_price: number;
    no_price: number;
  }>,
  options?: BuildLivePlatformComparisonOptions
): LivePlatformComparison {
  const minSim = options?.minSim ?? 0.28;
  const stake = options?.suggestedStake;
  const anchorNorm = normalizeKey(anchorQuestion);

  const pmMatch = bestMatchPolymarket(anchorNorm, polymarketRows, minSim);
  const bfMatch = bestMatchUniversal(anchorNorm, "betfair", universal, minSim);
  const mbMatch = bestMatchUniversal(
    anchorNorm,
    "matchbook",
    universal,
    minSim
  );
  const smMatch = bestMatchUniversal(
    anchorNorm,
    "smarkets",
    universal,
    minSim
  );

  const polymarket = pmMatch ? columnFromPm(pmMatch, direction) : null;
  const betfair = bfMatch ? columnFromMarket(bfMatch, direction) : null;
  const matchbook = mbMatch ? columnFromMarket(mbMatch, direction) : null;
  const smarkets = smMatch ? columnFromMarket(smMatch, direction) : null;

  const candidates: Array<{ k: ComparisonPlatformKey; v: number }> = [];
  const push = (k: ComparisonPlatformKey, col: LivePlatformPriceColumn | null) => {
    if (
      col?.netProfitIfWinPerUnit != null &&
      Number.isFinite(col.netProfitIfWinPerUnit)
    ) {
      candidates.push({ k, v: col.netProfitIfWinPerUnit });
    }
  };
  push("polymarket", polymarket);
  push("betfair", betfair);
  push("matchbook", matchbook);
  push("smarkets", smarkets);

  let bestPlatform: LivePlatformComparison["bestPlatform"] = null;
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.v - a.v);
    bestPlatform = candidates[0]!.k;
  }

  return {
    direction,
    polymarket: withStake(polymarket, stake),
    betfair: withStake(betfair, stake),
    matchbook: withStake(matchbook, stake),
    smarkets: withStake(smarkets, stake),
    bestPlatform,
    suggestedStake: stake
  };
}
