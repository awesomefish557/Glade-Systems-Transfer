import type { Env } from "../db";
import { fetchBetfairMarkets } from "./betfair";
import { fetchMatchbookMarkets } from "./matchbook";
import { fetchSmarketsMarkets } from "./smarkets";
import type { UniversalMarket } from "./types";

export type PlatformPriceFeedStatus = {
  ok: boolean;
  count: number;
  error?: string;
};

export type PlatformFeedsSnapshot = {
  betfair: PlatformPriceFeedStatus;
  matchbook: PlatformPriceFeedStatus;
  smarkets: PlatformPriceFeedStatus;
};

function feedFromSettled(
  r: PromiseSettledResult<UniversalMarket[]>,
  label: string
): PlatformPriceFeedStatus {
  if (r.status === "fulfilled") {
    return { ok: true, count: r.value.length };
  }
  const err =
    r.reason instanceof Error ? r.reason.message : String(r.reason ?? label);
  return { ok: false, count: 0, error: err };
}

/**
 * Aggregates open markets from UK-facing exchanges (no Polymarket),
 * plus per-feed status for the LIVE tab.
 */
export async function fetchAllPlatformMarketsWithFeeds(
  env: Env
): Promise<{ markets: UniversalMarket[]; feeds: PlatformFeedsSnapshot }> {
  const [betfair, matchbook, smarkets] = await Promise.allSettled([
    fetchBetfairMarkets(env),
    fetchMatchbookMarkets(env),
    fetchSmarketsMarkets()
  ]);

  const markets = [
    ...(betfair.status === "fulfilled" ? betfair.value : []),
    ...(matchbook.status === "fulfilled" ? matchbook.value : []),
    ...(smarkets.status === "fulfilled" ? smarkets.value : [])
  ].filter((m) => m.platform !== "polymarket");

  console.log(`[seer] Fetched ${markets.length} markets across platforms`);

  return {
    markets,
    feeds: {
      betfair: feedFromSettled(betfair, "betfair"),
      matchbook: feedFromSettled(matchbook, "matchbook"),
      smarkets: feedFromSettled(smarkets, "smarkets")
    }
  };
}

/** @deprecated Prefer fetchAllPlatformMarketsWithFeeds when you need feed health. */
export async function fetchAllPlatformMarkets(env: Env): Promise<UniversalMarket[]> {
  const { markets } = await fetchAllPlatformMarketsWithFeeds(env);
  return markets;
}

export type { UniversalMarket } from "./types";
export { detectArbitrageOpportunities } from "./arbitrage";
export type { ArbitrageRow } from "./arbitrage";
export {
  buildLivePlatformComparison,
  COMMISSION_ON_WINNINGS,
  netProfitIfWinPerUnit
} from "./platformComparison";
export type {
  BuildLivePlatformComparisonOptions,
  ComparisonPlatformKey,
  LivePlatformComparison,
  LivePlatformPriceColumn
} from "./platformComparison";
export { placeExchangeBetAndOpenPosition } from "./exchangeOrders";
export { syncExchangePositionSettlements } from "./settlementSync";
export {
  buildSmarketsAuthorizeUrl,
  exchangeSmarketsOAuthCode
} from "./smarketsOAuth";
export type { SmarketsTokenResponse } from "./smarketsOAuth";
