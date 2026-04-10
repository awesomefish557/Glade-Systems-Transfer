import {
  hasOpenPositionForMarketAndDirection,
  insertOpenPosition,
  insertShadowExchangeMarketIfMissing,
  type Env
} from "./db";
import {
  COMMISSION_ON_WINNINGS,
  fetchAllPlatformMarketsWithFeeds
} from "./platforms";
import type { UniversalMarket, UniversalPlatform } from "./platforms/types";
import {
  parsePaperPlatformId,
  resolvePaperVenuePricing,
  type PaperPlatformId
} from "./paperPricing";

function clampOddsFromImpliedProb(p: number): number {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return 1.01;
  const o = 1 / p;
  return Math.max(1.01, Math.min(2000, o));
}

function livePlatformForPaper(
  paperPlatform: PaperPlatformId
): UniversalPlatform | null {
  if (paperPlatform === "paper-betfair") return "betfair";
  if (paperPlatform === "paper-matchbook") return "matchbook";
  if (paperPlatform === "paper-smarkets") return "smarkets";
  return null;
}

function defaultCommissionForPaperExchange(
  paperPlatform: PaperPlatformId
): number {
  const live = livePlatformForPaper(paperPlatform);
  if (live === "betfair") return COMMISSION_ON_WINNINGS.betfair;
  if (live === "matchbook") return COMMISSION_ON_WINNINGS.matchbook;
  if (live === "smarkets") return COMMISSION_ON_WINNINGS.smarkets;
  return 0;
}

const SHADOW_END_FALLBACK_ISO = "2099-12-31T23:59:59.000Z";

/**
 * Paper bet on a live exchange row (LIVE tab). Match `marketId` against the
 * current feed; if missing, entry_price = 0. `feed` is the matched row for
 * shadow `markets` question / end_date when inserting a position.
 */
async function resolveExchangePaperWithoutD1(
  env: Env,
  marketId: string,
  direction: "YES" | "NO",
  paperPlatform: PaperPlatformId
): Promise<{
  entryPrice: number;
  appliedCommission: number;
  platform_odds: number | null;
  feed: UniversalMarket | null;
}> {
  const expected = livePlatformForPaper(paperPlatform);
  const fallbackCommission = defaultCommissionForPaperExchange(paperPlatform);

  if (!expected) {
    return {
      entryPrice: 0,
      appliedCommission: fallbackCommission,
      platform_odds: null,
      feed: null
    };
  }

  const { markets } = await fetchAllPlatformMarketsWithFeeds(env);
  const m = markets.find(
    (row) => row.id === marketId && row.platform === expected
  );

  if (!m) {
    return {
      entryPrice: 0,
      appliedCommission: fallbackCommission,
      platform_odds: null,
      feed: null
    };
  }

  const p = direction === "YES" ? m.yesPrice : m.noPrice;
  if (!Number.isFinite(p) || p <= 0 || p >= 1) {
    return {
      entryPrice: 0,
      appliedCommission: m.commission,
      platform_odds: null,
      feed: m
    };
  }

  return {
    entryPrice: p,
    appliedCommission: m.commission,
    platform_odds: clampOddsFromImpliedProb(p),
    feed: m
  };
}

export type PostPaperPositionBody = {
  marketId: string;
  direction: "YES" | "NO";
  stake: number;
  mode: string;
  layer?: number | string;
  signals?: string[];
  /** Default Polymarket research price; use paper-betfair etc. for exchange snapshot. */
  paperPlatform?: string | null;
};

/**
 * Detect paper POSTs and normalise aliases (`paper_platform`, implied mode from `paperPlatform`).
 */
export function normalizePostPaperBody(body: unknown): PostPaperPositionBody | null {
  if (!body || typeof body !== "object") return null;
  const r = body as Record<string, unknown>;

  let mode = String(r.mode ?? "").trim().toLowerCase();
  const ppRaw = r.paperPlatform ?? r.paper_platform;
  if (!mode && ppRaw != null && String(ppRaw).trim() !== "") {
    mode = "paper";
  }
  if (mode !== "paper") return null;

  const marketId = String(r.marketId ?? "").trim();
  const dirRaw = String(r.direction ?? "").trim().toUpperCase();
  const direction: "YES" | "NO" = dirRaw === "NO" ? "NO" : "YES";

  let stake: number;
  if (typeof r.stake === "number" && Number.isFinite(r.stake)) {
    stake = r.stake;
  } else {
    stake = Number(String(r.stake ?? "").replace(/,/g, "").trim());
  }

  return {
    marketId,
    direction,
    stake,
    mode: "paper",
    layer: r.layer as number | string | undefined,
    signals: Array.isArray(r.signals) ? r.signals.map(String) : undefined,
    paperPlatform:
      ppRaw == null || String(ppRaw).trim() === ""
        ? undefined
        : String(ppRaw).trim()
  };
}

/**
 * Open a PAPER position using Polymarket or live exchange-implied prices (+ commission metadata).
 * Wire this from `POST /api/positions` when `mode` is paper / PAPER.
 */
export async function openPaperPositionWithVenuePricing(
  env: Env,
  body: PostPaperPositionBody
): Promise<
  | { ok: true; positionId: number; entryPrice: number; paperPlatform: PaperPlatformId }
  | { ok: false; error: string; message?: string }
> {
  const mode = (body.mode ?? "").trim().toLowerCase();
  if (mode !== "paper") {
    return { ok: false, error: "not_paper_mode" };
  }

  const stake = Number(body.stake);
  if (!Number.isFinite(stake) || stake <= 0) {
    return { ok: false, error: "invalid_stake" };
  }

  const direction = body.direction === "NO" ? "NO" : "YES";
  const paperPlatform = parsePaperPlatformId(body.paperPlatform);

  const layerRaw = body.layer;
  const layerNum =
    typeof layerRaw === "number" && Number.isFinite(layerRaw)
      ? layerRaw
      : parseInt(String(layerRaw ?? "2").replace(/\D/g, ""), 10) || 2;
  const layerStr = String(layerNum);

  const isExchangePaper =
    paperPlatform === "paper-betfair" ||
    paperPlatform === "paper-matchbook" ||
    paperPlatform === "paper-smarkets";

  let entryPrice: number;
  let appliedCommission: number;
  let platform_odds: number | null;
  let storedPlatform: string;
  /** Exchange paper: shadow `markets.end_date`; unused for PM paper. */
  let exchangePaperEndDateIso = SHADOW_END_FALLBACK_ISO;
  /** Exchange paper: feed question or id; PM paper: corpus question. */
  let marketQuestion: string;

  if (isExchangePaper) {
    const r = await resolveExchangePaperWithoutD1(
      env,
      String(body.marketId),
      direction,
      paperPlatform
    );
    entryPrice = r.entryPrice;
    appliedCommission = r.appliedCommission;
    platform_odds = r.platform_odds;
    storedPlatform = paperPlatform;
    const qFromFeed = r.feed?.question?.trim();
    marketQuestion =
      qFromFeed && qFromFeed.length > 0 ? qFromFeed : String(body.marketId);
    const endFromFeed = r.feed?.endDate?.trim();
    exchangePaperEndDateIso =
      endFromFeed && endFromFeed.length > 0 ? endFromFeed : SHADOW_END_FALLBACK_ISO;
  } else {
    const pricing = await resolvePaperVenuePricing(env, {
      polymarketMarketId: String(body.marketId),
      direction,
      paperPlatform
    });

    if (!pricing.ok) {
      return {
        ok: false,
        error: pricing.error,
        message:
          pricing.error === "no_matched_exchange_price"
            ? "No fuzzy-matched exchange quote for this market — try Paper (PM) or refresh live feeds."
            : undefined
      };
    }

    entryPrice = pricing.entryPrice;
    appliedCommission = pricing.appliedCommission;
    platform_odds = clampOddsFromImpliedProb(pricing.entryPrice);
    storedPlatform = pricing.positionPlatform;
    marketQuestion = pricing.marketQuestion;
  }

  const signalsJson = isExchangePaper
    ? "[]"
    : JSON.stringify(Array.isArray(body.signals) ? body.signals : []);

  if (
    await hasOpenPositionForMarketAndDirection(
      env.DB,
      String(body.marketId),
      direction
    )
  ) {
    return {
      ok: false,
      error: "duplicate_position",
      message:
        "Already have an open position on this market in this direction"
    };
  }

  try {
    if (isExchangePaper) {
      await insertShadowExchangeMarketIfMissing(env.DB, {
        id: String(body.marketId),
        question: marketQuestion,
        endDateIso: exchangePaperEndDateIso
      });
    }
    const ins = await insertOpenPosition(env.DB, {
      marketId: String(body.marketId),
      direction,
      stake,
      mode: "PAPER",
      entryPrice,
      layer: layerStr,
      signalsJson,
      marketQuestion,
      platform: storedPlatform,
      platform_bet_id: null,
      platform_odds,
      appliedCommission
    });

    return {
      ok: true,
      positionId: ins.id,
      entryPrice,
      paperPlatform
    };
  } catch (e) {
    const d1Msg =
      e instanceof Error
        ? e.message
        : typeof e === "object" &&
            e !== null &&
            "message" in e &&
            typeof (e as { message: unknown }).message === "string"
          ? (e as { message: string }).message
          : String(e);
    console.error("[seer] openPaperPosition D1 error (shadow or position):", d1Msg, e);
    return { ok: false, error: "insert_failed" };
  }
}
