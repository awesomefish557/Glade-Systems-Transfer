import type { Env } from "../db";
import {
  deletePositionById,
  hasOpenPositionForMarketAndDirection,
  insertOpenPosition,
  updatePositionPlatformBetId,
  upsertMarket,
  type MarketRow
} from "../db";
import { placeBetfairBackBet } from "./betfair";
import { submitMatchbookBackOffer } from "./matchbook";
import type { UniversalMarket } from "./types";

/**
 * Upsert shadow `markets` row, open LIVE position, place BACK on Betfair or Matchbook, store bet id.
 * Entry price is the live exchange implied probability; P&L on settlement is net of that venue's commission on winnings.
 */
export async function placeExchangeBetAndOpenPosition(
  env: Env,
  market: UniversalMarket,
  params: { direction: "YES" | "NO"; stake: number }
): Promise<
  | { ok: true; positionId: number; betId: string; platform: string }
  | { ok: false; error: string }
> {
  const platform =
    market.platform === "betfair"
      ? "betfair"
      : market.platform === "matchbook"
        ? "matchbook"
        : null;
  if (platform !== "betfair" && platform !== "matchbook") {
    return { ok: false, error: "unsupported_platform" };
  }

  if (
    await hasOpenPositionForMarketAndDirection(
      env.DB,
      market.id,
      params.direction
    )
  ) {
    return { ok: false, error: "duplicate_position" };
  }

  const entryPrice =
    params.direction === "YES" ? market.yesPrice : market.noPrice;

  let selectionId: number;
  let decimalOdds: number;

  if (platform === "betfair") {
    const p = market.placement?.betfair;
    if (!p) return { ok: false, error: "missing_placement" };
    if (params.direction === "YES") {
      selectionId = p.yesSelectionId;
      decimalOdds = p.yesDecimalOdds;
    } else {
      if (p.noSelectionId == null || p.noDecimalOdds == null) {
        return { ok: false, error: "no_leg_not_available" };
      }
      selectionId = p.noSelectionId;
      decimalOdds = p.noDecimalOdds;
    }
  } else {
    const p = market.placement?.matchbook;
    if (!p) return { ok: false, error: "missing_placement" };
    if (params.direction === "YES") {
      selectionId = p.yesRunnerId;
      decimalOdds = p.yesDecimalOdds;
    } else {
      if (p.noRunnerId == null || p.noDecimalOdds == null) {
        return { ok: false, error: "no_leg_not_available" };
      }
      selectionId = p.noRunnerId;
      decimalOdds = p.noDecimalOdds;
    }
  }

  if (
    !Number.isFinite(selectionId) ||
    !Number.isFinite(decimalOdds) ||
    decimalOdds <= 1
  ) {
    return { ok: false, error: "invalid_odds" };
  }

  const row: MarketRow = {
    id: market.id,
    question: market.question,
    category: market.category,
    end_date: market.endDate,
    yes_price: market.yesPrice,
    no_price: market.noPrice,
    volume: market.volume,
    liquidity: 0,
    resolved: market.resolved ? 1 : 0,
    resolution_outcome: market.resolutionOutcome ?? null,
    last_trade_price: market.yesPrice
  };
  await upsertMarket(env, row);

  const oddsClamped = Math.max(1.01, Math.min(2000, decimalOdds));

  const ins = await insertOpenPosition(env.DB, {
    marketId: market.id,
    direction: params.direction,
    stake: params.stake,
    mode: "LIVE",
    entryPrice,
    layer: null,
    signalsJson: JSON.stringify({
      source: "exchange_feed",
      commissionOnWinnings: market.commission,
      quotedPrice: entryPrice
    }),
    marketQuestion: market.question,
    platform,
    platform_bet_id: null,
    platform_odds: oddsClamped,
    appliedCommission: market.commission
  });

  const positionId = ins.id;

  if (platform === "betfair") {
    const p = market.placement!.betfair!;
    const r = await placeBetfairBackBet(env, {
      marketId: p.marketId,
      selectionId,
      size: params.stake,
      price: oddsClamped,
      customerOrderRef: `seer-${positionId}`
    });
    if (!r.ok) {
      await deletePositionById(env.DB, positionId);
      return { ok: false, error: r.error };
    }
    await updatePositionPlatformBetId(env.DB, positionId, r.betId);
    return { ok: true, positionId, betId: r.betId, platform };
  }

  const r = await submitMatchbookBackOffer(env, {
    runnerId: selectionId,
    odds: oddsClamped,
    stake: params.stake
  });
  if (!r.ok) {
    await deletePositionById(env.DB, positionId);
    return { ok: false, error: r.error };
  }
  await updatePositionPlatformBetId(env.DB, positionId, r.betId);
  return { ok: true, positionId, betId: r.betId, platform };
}
