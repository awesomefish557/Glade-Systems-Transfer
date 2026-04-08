import type { UniversalMarket } from "./types";

export type ArbitrageRow = {
  question: string;
  betfairPrice: number;
  matchbookPrice: number;
  difference: number;
  action: string;
  expectedProfit: string;
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

/**
 * Pairwise match Betfair vs Matchbook (same legal exchange family) on fuzzy question + price gap.
 */
export function detectArbitrageOpportunities(
  markets: UniversalMarket[]
): ArbitrageRow[] {
  const bf = markets.filter((m) => m.platform === "betfair");
  const mb = markets.filter((m) => m.platform === "matchbook");
  const rows: ArbitrageRow[] = [];

  for (const a of bf) {
    const ka = normalizeKey(a.question);
    if (ka.length < 8) continue;
    for (const b of mb) {
      const kb = normalizeKey(b.question);
      const sim = jaccard(ka, kb);
      if (sim < 0.35) continue;
      const diff = Math.abs(a.yesPrice - b.yesPrice);
      if (diff < 0.02) continue;
      const hi = a.yesPrice >= b.yesPrice ? a : b;
      const lo = a.yesPrice >= b.yesPrice ? b : a;
      const stake = 10;
      const rough = stake * diff * 0.5;
      const bfPx = a.platform === "betfair" ? a.yesPrice : b.yesPrice;
      const mbPx = a.platform === "matchbook" ? a.yesPrice : b.yesPrice;
      rows.push({
        question: a.question.length <= b.question.length ? a.question : b.question,
        betfairPrice: bfPx,
        matchbookPrice: mbPx,
        difference: Math.round(diff * 1000) / 1000,
        action:
          hi.platform === "matchbook"
            ? "Back (yes) on Matchbook vs Betfair — verify same outcome & liquidity"
            : "Back (yes) on Betfair vs Matchbook — verify same outcome & liquidity",
        expectedProfit: `~${rough.toFixed(2)} GBP per ${stake} GBP notional (before commission & slippage)`
      });
    }
  }

  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = `${r.question.slice(0, 40)}:${r.difference}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
