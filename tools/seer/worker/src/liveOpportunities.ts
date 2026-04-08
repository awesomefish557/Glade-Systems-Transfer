import {
  calcAnnualisedReturnNetOfCommission,
  calcTimeToDoubleNetAer,
  loadCalibrationMap,
  scoreMarketsFromRows,
  type LiveOpportunity,
  type PriceHistory,
  MIN_VOLUME_USD
} from "./analysis";
import type { Env } from "./db";
import {
  buildLivePlatformComparison,
  detectArbitrageOpportunities,
  fetchAllPlatformMarketsWithFeeds,
  type PlatformFeedsSnapshot,
  type UniversalMarket
} from "./platforms";

function universalToRow(um: UniversalMarket): Record<string, unknown> {
  return {
    id: um.id,
    question: um.question,
    category: um.category,
    end_date: um.endDate,
    yes_price: um.yesPrice,
    no_price: um.noPrice,
    volume: um.volume,
    liquidity: 0,
    resolved: um.resolved ? 1 : 0,
    resolution_outcome: um.resolutionOutcome ?? null,
    last_trade_price: null
  };
}

export async function buildLiveOpportunitiesResponse(env: Env): Promise<{
  opportunities: LiveOpportunity[];
  arbitrage: ReturnType<typeof detectArbitrageOpportunities>;
  count: number;
  fetchedMarkets: number;
  combinedExchangeVolume: number;
  combinedExchangeVolumeByPlatform: {
    betfair: number;
    matchbook: number;
    smarkets: number;
  };
  priceFeeds: PlatformFeedsSnapshot;
}> {
  const { markets: universal, feeds: priceFeeds } =
    await fetchAllPlatformMarketsWithFeeds(env);
  const open = universal.filter(
    (m) =>
      !m.resolved &&
      m.volume >= MIN_VOLUME_USD &&
      m.platform !== "polymarket"
  );
  const rows = open.map(universalToRow);
  const byId = new Map(open.map((m) => [m.id, m]));

  const emptyHist = new Map<string, PriceHistory[]>();
  const calMap = await loadCalibrationMap(env.DB);
  const base = scoreMarketsFromRows(rows, emptyHist, calMap);
  const now = new Date().toISOString();

  const combinedExchangeVolumeByPlatform = {
    betfair: 0,
    matchbook: 0,
    smarkets: 0
  };
  let combinedExchangeVolume = 0;
  for (const m of universal) {
    if (m.platform === "polymarket") continue;
    const v = Number.isFinite(m.volume) ? m.volume : 0;
    combinedExchangeVolume += v;
    if (m.platform === "betfair") combinedExchangeVolumeByPlatform.betfair += v;
    else if (m.platform === "matchbook")
      combinedExchangeVolumeByPlatform.matchbook += v;
    else if (m.platform === "smarkets")
      combinedExchangeVolumeByPlatform.smarkets += v;
  }

  const { results: pmRows = [] } = await env.DB.prepare(
    `SELECT question, yes_price, no_price FROM markets
     WHERE resolved = 0 AND datetime(end_date) > datetime('now')
     ORDER BY volume DESC
     LIMIT 400`
  ).all<{ question: string; yes_price: number; no_price: number }>();

  const opportunities: LiveOpportunity[] = [];
  for (const o of base) {
    const um = byId.get(o.marketId);
    if (!um) continue;
    const gross = o.aer;
    const net = calcAnnualisedReturnNetOfCommission(
      o.currentPrice,
      o.daysToResolution,
      um.commission
    );
    const td = calcTimeToDoubleNetAer(net);
    opportunities.push({
      ...o,
      aer: net,
      aerGross: gross,
      timeToDouble: Number.isFinite(td) ? td : 0,
      platform: um.platform as LiveOpportunity["platform"],
      commission: um.commission,
      externalUrl: um.externalUrl,
      computedAt: now,
      placement: um.placement,
      platformComparison: buildLivePlatformComparison(
        o.question,
        o.direction,
        universal,
        pmRows,
        { suggestedStake: o.suggestedStake }
      )
    });
  }

  opportunities.sort((a, b) => b.aer - a.aer);

  return {
    opportunities,
    arbitrage: detectArbitrageOpportunities(open),
    count: opportunities.length,
    fetchedMarkets: universal.length,
    combinedExchangeVolume,
    combinedExchangeVolumeByPlatform,
    priceFeeds
  };
}
