import { buildLivePlatformComparison } from "./platforms";
import type { UniversalMarket } from "./platforms";

/**
 * Attach cross-venue comparison to Polymarket-scored trading rows (TRADING tab).
 * Call from `/api/opportunities` after scoring, with the same `universal` + PM snapshot as LIVE.
 */
export function attachPlatformComparisonToOpportunities<
  T extends {
    question: string;
    direction: "YES" | "NO";
    suggestedStake: number;
    marketId: string;
  }
>(
  rows: T[],
  universal: UniversalMarket[],
  polymarketRows: Array<{
    question: string;
    yes_price: number;
    no_price: number;
  }>
): Array<
  T & {
    platformComparison: ReturnType<typeof buildLivePlatformComparison>;
  }
> {
  return rows.map((r) => ({
    ...r,
    platformComparison: buildLivePlatformComparison(
      r.question,
      r.direction,
      universal,
      polymarketRows,
      { suggestedStake: r.suggestedStake }
    )
  }));
}
