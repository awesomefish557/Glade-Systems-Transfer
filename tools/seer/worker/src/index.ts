import { analyseMarketsPage, DEFAULT_ANALYSIS_PAGE_SIZE } from "./analysis";
import { authRequired, checkBearerAuth } from "./auth";
import {
  type Env,
  autoResolveOpenPositions,
  getAppMeta,
  getMarketForPosition,
  countOpenPositionsForMarketAndDirection,
  clearOpportunities,
  getOpportunitiesLastUpdated,
  insertOpenPosition,
  insertOpportunities,
  listCalibrationRows,
  listPositionsWithMarket,
  listOpenPositionsMarketDirections,
  listStoredOpportunities,
  rebuildCalibrationFromMarkets,
  replaceOpportunities,
  resolveOpenPositionWithMarket,
  setAppMeta
} from "./db";
import { runBacktest } from "./backtest";
import { buildLiveOpportunitiesResponse } from "./liveOpportunities";
import { runHistoricalLoadBatch } from "./historicalLoad";
import { fetchAllPlatformMarketsWithFeeds } from "./platforms";
import { placeExchangeBetAndOpenPosition } from "./platforms/exchangeOrders";
import { runPipeline } from "./pipeline";
import { tryHandlePaperPositionPost } from "./postPositionsHandler";
import { buildPortfolioStats } from "./portfolioStats";
import { corsCsv, corsJson, corsPreflight } from "./cors";

function json(data: unknown, status = 200): Response {
  return corsJson(data, status);
}

function textCsv(body: string, status = 200): Response {
  return corsCsv(body, status);
}

function authFailureResponse(
  r: Extract<ReturnType<typeof checkBearerAuth>, { ok: false }>
): Response {
  return json({ error: r.error, message: r.message }, r.status);
}

function requireApiAuth(request: Request, env: Env): Response | null {
  if (!authRequired(env)) return null;
  const r = checkBearerAuth(request, env);
  if (!r.ok) return authFailureResponse(r);
  return null;
}

function requireAdmin(request: Request, env: Env): Response | null {
  if (!env.ADMIN_SECRET?.length) {
    return json(
      {
        error: "admin_disabled",
        message: "Set ADMIN_SECRET in env to use /admin/* routes"
      },
      503
    );
  }
  if (request.headers.get("X-Seer-Admin") !== env.ADMIN_SECRET) {
    return json({ error: "forbidden" }, 403);
  }
  return null;
}

function timeToDoubleFromAer(aer: number): number | null {
  if (aer <= 0 || !Number.isFinite(aer)) return null;
  return 72 / (aer * 100);
}

async function portfolioAerCalculator(env: Env): Promise<{
  aerSinceLaunch: number;
  timeToDoubleDays: number | null;
  totalProfitLoss: number;
}> {
  const stats = await buildPortfolioStats(env);
  const aer = stats.aerSinceLaunch as number;
  return {
    aerSinceLaunch: aer,
    timeToDoubleDays: timeToDoubleFromAer(aer),
    totalProfitLoss: stats.totalProfitLoss as number
  };
}

/** Normalise pathname so `/api/portfolio/stats` matches after proxy quirks. */
function normalizeRequestPath(pathname: string): string {
  const collapsed = pathname.replace(/\/{2,}/g, "/");
  const trimmed = collapsed.replace(/\/+$/, "");
  return trimmed || "/";
}

/**
 * Cron: Polymarket pipeline, then paginated analysis (same pattern as admin run-analysis).
 */
async function runScheduledPipelineAndAnalysis(env: Env): Promise<void> {
  await runPipeline(env);
  await clearOpportunities(env.DB);
  const computedAt = new Date().toISOString();
  const limit = DEFAULT_ANALYSIS_PAGE_SIZE;
  let offset = 0;
  let totalFound = 0;

  while (true) {
    const { opportunities, hasMore } = await analyseMarketsPage(
      env.DB,
      offset,
      limit
    );
    await insertOpportunities(env.DB, opportunities, computedAt);
    totalFound += opportunities.length;
    if (!hasMore) break;
    offset += limit;
  }

  console.log(`[seer] Cron complete: ${totalFound} opportunities stored`);

  const resolvedN = await autoResolveOpenPositions(env.DB);
  if (resolvedN > 0) {
    console.log(`[seer] Auto-resolved ${resolvedN} positions`);
  }
}

/** UK tax year: 6 April (inclusive) → 5 April next year (inclusive end-of-day). */
function ukTaxYearWindowUTC(reference: Date): { start: Date; end: Date } {
  const y = reference.getUTCFullYear();
  const m = reference.getUTCMonth();
  const d = reference.getUTCDate();
  const onOrAfterApril6 =
    m > 3 || (m === 3 && d >= 6);
  const startYear = onOrAfterApril6 ? y : y - 1;
  const start = new Date(Date.UTC(startYear, 3, 6, 0, 0, 0, 0));
  const end = new Date(Date.UTC(startYear + 1, 3, 5, 23, 59, 59, 999));
  return { start, end };
}

function parseSqliteOrIsoDate(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isNaN(t) ? null : t;
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function parseQueryDone(param: string | null): boolean {
  if (param === null) return false;
  const s = param.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function parseNonNegInt(
  raw: string | null,
  defaultVal: number
): { ok: true; value: number } | { ok: false } {
  if (raw === null) return { ok: true, value: defaultVal };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return { ok: false };
  return { ok: true, value: n };
}

function parseAnalysisLimit(raw: string | null): number {
  if (raw === null || raw.trim() === "") return DEFAULT_ANALYSIS_PAGE_SIZE;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return DEFAULT_ANALYSIS_PAGE_SIZE;
  }
  return Math.min(200, n);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return corsPreflight();

    try {
      const url = new URL(request.url);
      const path = normalizeRequestPath(url.pathname);

      if (
        path === "/admin/historical-load" &&
        (request.method === "POST" || request.method === "GET")
      ) {
        const ad = requireAdmin(request, env);
        if (ad) return ad;
        const oo = parseNonNegInt(url.searchParams.get("openOffset"), 0);
        const co = parseNonNegInt(url.searchParams.get("closedOffset"), 0);
        if (!oo.ok || !co.ok) {
          return json(
            {
              error: "validation_error",
              message: "openOffset and closedOffset must be non-negative integers"
            },
            400
          );
        }
        const openDone = parseQueryDone(url.searchParams.get("openDone"));
        const closedDone = parseQueryDone(url.searchParams.get("closedDone"));
        const result = await runHistoricalLoadBatch(env, {
          openOffset: oo.value,
          closedOffset: co.value,
          openDone,
          closedDone
        });
        return json({ ok: true, ...result });
      }

      if (path === "/admin/clear-markets" && request.method === "POST") {
        const ad = requireAdmin(request, env);
        if (ad) return ad;
        await env.DB.prepare("DELETE FROM price_history").run();
        await env.DB.prepare("DELETE FROM markets").run();
        return json({ ok: true });
      }

      if (path === "/admin/run-analysis" && request.method === "POST") {
        const ad = requireAdmin(request, env);
        if (ad) return ad;
        const off = parseNonNegInt(url.searchParams.get("offset"), 0);
        if (!off.ok) {
          return json(
            {
              error: "validation_error",
              message: "offset must be a non-negative integer"
            },
            400
          );
        }
        const limit = parseAnalysisLimit(url.searchParams.get("limit"));
        const { opportunities, hasMore } = await analyseMarketsPage(
          env.DB,
          off.value,
          limit
        );
        const computedAt = new Date().toISOString();
        if (off.value === 0) {
          await replaceOpportunities(env.DB, opportunities, computedAt);
        } else {
          await insertOpportunities(env.DB, opportunities, computedAt);
        }
        const found = opportunities.length;
        if (hasMore) {
          return json({
            ok: true,
            done: false,
            nextOffset: off.value + limit,
            found
          });
        }
        return json({
          ok: true,
          done: true,
          found,
          totalFound: off.value + found
        });
      }

      if (path === "/admin/clear-opportunities" && request.method === "POST") {
        const ad = requireAdmin(request, env);
        if (ad) return ad;
        await env.DB.prepare("DELETE FROM opportunities").run();
        return json({ ok: true });
      }

      if (path === "/admin/rebuild-calibration" && request.method === "POST") {
        const ad = requireAdmin(request, env);
        if (ad) return ad;
        const bucketsWritten = await rebuildCalibrationFromMarkets(env);
        return json({ ok: true, bucketsWritten });
      }

      if (path === "/admin/auto-resolve" && request.method === "POST") {
        const ad = requireAdmin(request, env);
        if (ad) return ad;
        const n = await autoResolveOpenPositions(env.DB);
        console.log(`[seer] Auto-resolved ${n} positions`);
        return json({ ok: true, resolved: n });
      }

      if (path === "/admin/mock-resolve" && request.method === "POST") {
        const ad = requireAdmin(request, env);
        if (ad) return ad;
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "invalid_json" }, 400);
        }
        const id = Number((body as { positionId?: unknown }).positionId);
        if (!Number.isFinite(id) || id <= 0) {
          return json({ error: "validation_error", message: "positionId" }, 400);
        }
        const r = await resolveOpenPositionWithMarket(env.DB, id);
        if (!r.ok) return json(r, 400);
        return json({
          ok: true,
          profit_loss: r.profit_loss,
          exit_price: r.exit_price
        });
      }

      /** Test only: force a market to resolved YES/NO so mock-resolve can settle positions. */
      if (path === "/admin/set-market-outcome" && request.method === "POST") {
        const ad = requireAdmin(request, env);
        if (ad) return ad;
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "invalid_json" }, 400);
        }
        const b = body as { marketId?: string; outcome?: string };
        if (!b.marketId || (b.outcome !== "YES" && b.outcome !== "NO")) {
          return json(
            { error: "validation_error", message: "marketId, outcome YES|NO" },
            400
          );
        }
        const y = b.outcome === "YES" ? 1 : 0;
        const n = b.outcome === "YES" ? 0 : 1;
        await env.DB.prepare(
          `UPDATE markets SET resolved = 1, resolution_outcome = ?, yes_price = ?, no_price = ?,
           updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        )
          .bind(b.outcome, y, n, b.marketId)
          .run();
        return json({ ok: true, marketId: b.marketId, outcome: b.outcome });
      }

      const authErr = requireApiAuth(request, env);
      if (authErr) return authErr;

      if (path === "/api/live-opportunities" && request.method === "GET") {
        const r = await buildLiveOpportunitiesResponse(env);
        return json(r);
      }

      if (path === "/api/backtest" && request.method === "GET") {
        const r = await runBacktest(env);
        return json(r);
      }

      if (path === "/api/platform-bet" && request.method === "POST") {
        const body = (await request.json()) as {
          marketId?: string;
          platform?: string;
          direction?: string;
          stake?: number;
        };
        const { markets } = await fetchAllPlatformMarketsWithFeeds(env);
        const m = markets.find((x) => x.id === body.marketId);
        if (!m) return json({ ok: false, error: "market_not_found" }, 400);
        const platform =
          body.platform === "matchbook"
            ? "matchbook"
            : body.platform === "betfair"
              ? "betfair"
              : null;
        if (!platform || m.platform !== platform) {
          return json({ ok: false, error: "platform_mismatch" }, 400);
        }
        const dir = body.direction === "NO" ? "NO" : "YES";
        const stake = Number(body.stake);
        if (!Number.isFinite(stake) || stake <= 0) {
          return json({ ok: false, error: "invalid_stake" }, 400);
        }
        const r = await placeExchangeBetAndOpenPosition(env, m, {
          direction: dir,
          stake
        });
        if (!r.ok) {
          if (r.error === "duplicate_position") {
            return json(
              {
                ok: false,
                error: "duplicate_position",
                message:
                  "Already have an open position on this market in this direction"
              },
              400
            );
          }
          return json({ ok: false, error: r.error }, 400);
        }
        return json({
          ok: true,
          betId: r.betId,
          positionId: r.positionId,
          platform: r.platform
        });
      }

      if (path === "/api/opportunities" && request.method === "GET") {
        const [opportunities, aerCalc, openByMarket] = await Promise.all([
          listStoredOpportunities(env.DB),
          portfolioAerCalculator(env),
          listOpenPositionsMarketDirections(env.DB)
        ]);
        const enriched = opportunities.map((o) => ({
          ...o,
          hasOpenPosition: openByMarket.has(o.marketId),
          openPositionDirection: openByMarket.get(o.marketId) ?? null
        }));
        return json({
          opportunities: enriched,
          count: enriched.length,
          aerSinceLaunch: aerCalc.aerSinceLaunch,
          timeToDoubleDays: aerCalc.timeToDoubleDays,
          totalProfitLoss: aerCalc.totalProfitLoss,
          aerCalculator: aerCalc
        });
      }

      if (path === "/api/last-updated" && request.method === "GET") {
        const lastUpdated = await getOpportunitiesLastUpdated(env.DB);
        return json({ lastUpdated });
      }

      if (path === "/api/digest" && request.method === "GET") {
        const digest = await buildDailyDigest(env);
        return json(digest);
      }

      if (path === "/api/portfolio/stats" && request.method === "GET") {
        return json(await buildPortfolioStats(env));
      }

      if (path === "/api/portfolio" && request.method === "GET") {
        const diagCount = await env.DB
          .prepare("SELECT COUNT(*) as c FROM positions")
          .first<{ c: number }>();
        const diagJoin = await env.DB
          .prepare(
            `SELECT COUNT(*) as c FROM positions p
             LEFT JOIN markets m ON CAST(p.market_id AS TEXT) = CAST(m.id AS TEXT)
             WHERE m.id IS NOT NULL`
          )
          .first<{ c: number }>();
        console.log("[seer] positions total:", diagCount, "joined:", diagJoin);
        const positions = await listPositionsWithMarket(env.DB);
        const open = positions.filter((p) => p.status === "OPEN");
        const resolved = positions.filter((p) => p.status === "CLOSED");
        const cancelled = positions.filter((p) => p.status === "CANCELLED");
        const totalPnl = positions.reduce((sum, p) => {
          if (p.status !== "CLOSED" || p.profit_loss == null) return sum;
          return sum + p.profit_loss;
        }, 0);
        return json({
          open,
          resolved,
          cancelled,
          totalPnl,
          positions,
          _debug: { total: diagCount, joined: diagJoin }
        });
      }

      if (path === "/api/positions" && request.method === "POST") {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json(
            { error: "invalid_json", message: "Body is not valid JSON" },
            400
          );
        }
        const paper = await tryHandlePaperPositionPost(env, body);
        if (paper) return paper;
        return await handlePostPositionBody(env, body);
      }

      if (path === "/api/tax" && request.method === "GET") {
        const stats = await buildPortfolioStats(env);
        return json({
          rows: [],
          totalProfitLoss: stats.totalProfitLoss,
          aerSinceLaunch: stats.aerSinceLaunch,
          hmrcAnnualProfit: stats.hmrcAnnualProfit,
          runningAnnualProfit: stats.runningAnnualProfit,
          threshold1000Warning: stats.threshold1000Warning,
          winRateClosed: stats.winRateClosed,
          winRateByLayer: stats.winRateByLayer,
          openCount: stats.openCount,
          totalAtRisk: stats.totalAtRisk,
          resolvedClosedCount: stats.resolvedClosedCount,
          ukTaxYear: stats.ukTaxYear
        });
      }

      if (path === "/api/tax/export" && request.method === "GET") {
        return await handleTaxExport(env);
      }

      if (path === "/api/calibration" && request.method === "GET") {
        const rows = await listCalibrationRows(env.DB);
        const byCategory: Record<
          string,
          Array<{
            priceBucket: string;
            sampleSize: number;
            resolutionRate: number;
            lastUpdated: string;
          }>
        > = {};
        for (const r of rows) {
          if (!byCategory[r.category]) byCategory[r.category] = [];
          byCategory[r.category].push({
            priceBucket: r.price_bucket,
            sampleSize: r.sample_size,
            resolutionRate: r.resolution_rate,
            lastUpdated: r.last_updated
          });
        }
        return json({ categories: byCategory });
      }

      if (path === "/" && request.method === "GET") {
        return json({
          service: "seer-worker",
          routes: [
            "GET /api/live-opportunities",
            "GET /api/backtest",
            "POST /api/platform-bet",
            "GET /api/opportunities",
            "GET /api/last-updated",
            "GET /api/portfolio",
            "GET /api/portfolio/stats",
            "POST /api/positions",
            "GET /api/tax",
            "GET /api/tax/export",
            "GET /api/calibration",
            "POST|GET /admin/historical-load",
            "POST /admin/clear-markets",
            "POST /admin/run-analysis",
            "POST /admin/clear-opportunities",
            "POST /admin/rebuild-calibration",
            "POST /admin/auto-resolve",
            "POST /admin/mock-resolve",
            "POST /admin/set-market-outcome",
            "GET /api/digest"
          ]
        });
      }

      return json({ error: "not_found" }, 404);
    } catch (error) {
      console.error("[seer] fetch error", error);
      return json(
        {
          error: "internal_error",
          message: error instanceof Error ? error.message : String(error)
        },
        500
      );
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    try {
      await runScheduledPipelineAndAnalysis(env);
    } catch (error) {
      console.error("[seer] scheduled pipeline failed:", error);
    }
  }
};

type DigestOpp = {
  marketId: string;
  question: string;
  direction: string;
  aer: number;
  days: number;
  layer: string;
};

type DigestResolvedRow = {
  id: number;
  market_id: string;
  direction: string;
  stake: number;
  profit_loss: number | null;
  resolved_at: string;
  market_question: string | null;
  resolution_outcome: string | null;
};

type DigestSoonRow = {
  id: number;
  market_id: string;
  direction: string;
  stake: number;
  market_question: string | null;
  end_date: string;
};

async function buildDailyDigest(env: Env): Promise<{
  newOpportunities: DigestOpp[];
  resolvingSoon: DigestSoonRow[];
  recentlyResolved: DigestResolvedRow[];
  portfolioSummary: {
    openCount: number;
    totalAtRisk: number;
    unrealisedPnl: number;
  };
  bestOpportunity: {
    question: string;
    direction: string;
    aer: number;
    days: number;
    layer: string;
  } | null;
}> {
  const lastDigestAt =
    (await getAppMeta(env.DB, "last_digest_at")) ?? "1970-01-01T00:00:00.000Z";
  let prevKeys = new Set<string>();
  try {
    const raw = await getAppMeta(env.DB, "digest_prev_opp_keys");
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        for (const x of arr) prevKeys.add(String(x));
      }
    }
  } catch {
    prevKeys = new Set();
  }

  const opps = await listStoredOpportunities(env.DB);
  const sorted = [...opps].sort((a, b) => b.aer - a.aer);
  const allKeys = opps.map((o) => `${o.marketId}:${o.direction}`);

  const newOpportunities: DigestOpp[] = sorted
    .filter((o) => !prevKeys.has(`${o.marketId}:${o.direction}`))
    .slice(0, 5)
    .map((o) => ({
      marketId: o.marketId,
      question: o.question,
      direction: o.direction,
      aer: o.aer,
      days: o.daysToResolution,
      layer: o.layer
    }));

  const best = sorted[0];
  const bestOpportunity = best
    ? {
        question: best.question,
        direction: best.direction,
        aer: best.aer,
        days: best.daysToResolution,
        layer: best.layer
      }
    : null;

  const { results: soonRaw = [] } = await env.DB
    .prepare(
      `SELECT p.id, p.market_id, p.direction, p.stake,
              m.question AS market_question, m.end_date AS end_date
       FROM positions p
       INNER JOIN markets m ON CAST(p.market_id AS TEXT) = CAST(m.id AS TEXT)
       WHERE p.status = 'OPEN'
         AND datetime(m.end_date) > datetime('now')
         AND datetime(m.end_date) <= datetime('now', '+1 day')`
    )
    .all<DigestSoonRow>();

  const { results: recentRaw = [] } = await env.DB
    .prepare(
      `SELECT p.id, p.market_id, p.direction, p.stake, p.profit_loss, p.resolved_at,
              COALESCE(m.question, p.market_question) AS market_question, m.resolution_outcome AS resolution_outcome
       FROM positions p
       LEFT JOIN markets m ON CAST(p.market_id AS TEXT) = CAST(m.id AS TEXT)
       WHERE p.status = 'CLOSED'
         AND p.resolved_at IS NOT NULL
         AND p.resolved_at > ?
       ORDER BY p.resolved_at DESC
       LIMIT 25`
    )
    .bind(lastDigestAt)
    .all<DigestResolvedRow>();

  const positions = await listPositionsWithMarket(env.DB);
  const open = positions.filter((p) => p.status === "OPEN");
  let unrealisedPnl = 0;
  for (const p of open) {
    const cur =
      p.direction === "YES"
        ? p.market_yes_price
        : p.direction === "NO"
          ? p.market_no_price
          : null;
    if (cur == null || p.entry_price <= 0) continue;
    unrealisedPnl += p.stake * (cur / p.entry_price - 1);
  }

  const portfolioSummary = {
    openCount: open.length,
    totalAtRisk: open.reduce((s, p) => s + p.stake, 0),
    unrealisedPnl
  };

  const nowIso = new Date().toISOString();
  await setAppMeta(env.DB, "last_digest_at", nowIso);
  await setAppMeta(env.DB, "digest_prev_opp_keys", JSON.stringify(allKeys));

  return {
    newOpportunities,
    resolvingSoon: soonRaw,
    recentlyResolved: recentRaw,
    portfolioSummary,
    bestOpportunity
  };
}

function parsePositionPostBody(body: Record<string, unknown>): {
  ok: true;
  marketId: string;
  direction: "YES" | "NO";
  stake: number;
  mode: "PAPER" | "LIVE";
  layer: string | null;
  signalsJson: string | null;
  platform: "betfair" | "matchbook" | "smarkets" | null;
  platformBetId: string | null;
  entryPriceOverride: number | null;
} | {
  ok: false;
  validationErrors: Array<{ field: string; reason: string }>;
} {
  const errors: Array<{ field: string; reason: string }> = [];
  const b = body;

  const marketIdRaw = b.marketId;
  const marketId =
    typeof marketIdRaw === "string"
      ? marketIdRaw.trim()
      : marketIdRaw != null
        ? String(marketIdRaw).trim()
        : "";
  if (!marketId) {
    errors.push({
      field: "marketId",
      reason:
        typeof marketIdRaw === "undefined"
          ? "missing"
          : `expected non-empty string, got ${JSON.stringify(marketIdRaw)}`
    });
  }

  const dirRaw = b.direction;
  const dirStr =
    typeof dirRaw === "string"
      ? dirRaw.trim().toUpperCase()
      : dirRaw != null
        ? String(dirRaw).trim().toUpperCase()
        : "";
  const direction =
    dirStr === "YES" || dirStr === "NO" ? dirStr : null;
  if (!direction) {
    errors.push({
      field: "direction",
      reason: `expected YES or NO, got ${JSON.stringify(dirRaw)}`
    });
  }

  const stakeRaw = b.stake;
  const stakeNum =
    typeof stakeRaw === "number"
      ? stakeRaw
      : typeof stakeRaw === "string"
        ? Number(String(stakeRaw).replace(/,/g, "").trim())
        : Number(stakeRaw);
  if (!Number.isFinite(stakeNum) || stakeNum <= 0) {
    errors.push({
      field: "stake",
      reason: `expected finite number > 0, got ${JSON.stringify(stakeRaw)} (parsed ${stakeNum})`
    });
  }

  const modeRaw = b.mode;
  const modeStr =
    typeof modeRaw === "string"
      ? modeRaw.trim().toLowerCase()
      : modeRaw != null
        ? String(modeRaw).trim().toLowerCase()
        : "";
  const mode =
    modeStr === "paper" ? "PAPER" : modeStr === "live" ? "LIVE" : null;
  if (!mode) {
    errors.push({
      field: "mode",
      reason: `expected paper or live (any case), got ${JSON.stringify(modeRaw)}`
    });
  }

  const layerRaw = b.layer;
  const layerNum =
    layerRaw === undefined || layerRaw === null
      ? NaN
      : typeof layerRaw === "number" && Number.isFinite(layerRaw)
        ? Math.trunc(layerRaw)
        : typeof layerRaw === "string"
          ? parseInt(layerRaw.replace(/^L/i, "").trim(), 10)
          : NaN;
  const layer =
    layerNum === 1 || layerNum === 2 || layerNum === 3
      ? String(layerNum)
      : layerRaw === undefined || layerRaw === null
        ? null
        : null;
  if (
    layerRaw !== undefined &&
    layerRaw !== null &&
    (layer === null || Number.isNaN(layerNum))
  ) {
    errors.push({
      field: "layer",
      reason: `if provided, must be 1, 2, or 3; got ${JSON.stringify(layerRaw)}`
    });
  }

  let signalsJson: string | null = null;
  const sigRaw = b.signals;
  if (sigRaw !== undefined && sigRaw !== null) {
    if (!Array.isArray(sigRaw)) {
      errors.push({
        field: "signals",
        reason: "expected array of strings or omit"
      });
    } else {
      const strings = sigRaw.map((x) => String(x));
      signalsJson = JSON.stringify(strings);
    }
  }

  const platRaw = b.platform;
  let platform: "betfair" | "matchbook" | "smarkets" | null = null;
  if (typeof platRaw === "string") {
    const p = platRaw.trim().toLowerCase();
    if (p === "betfair" || p === "matchbook" || p === "smarkets") {
      platform = p;
    }
  }

  const bidRaw = b.platformBetId ?? b.betId;
  const platformBetId =
    bidRaw != null && String(bidRaw).trim() !== ""
      ? String(bidRaw).trim()
      : null;

  const epRaw = b.entryPrice ?? b.price;
  let entryPriceOverride: number | null = null;
  if (epRaw !== undefined && epRaw !== null) {
    const ep =
      typeof epRaw === "number"
        ? epRaw
        : Number(String(epRaw).replace(/,/g, "").trim());
    if (Number.isFinite(ep) && ep > 0 && ep < 1) {
      entryPriceOverride = ep;
    }
  }

  if (errors.length > 0) return { ok: false, validationErrors: errors };
  return {
    ok: true,
    marketId,
    direction: direction!,
    stake: stakeNum,
    mode: mode!,
    layer,
    signalsJson,
    platform,
    platformBetId,
    entryPriceOverride
  };
}

async function handlePostPositionBody(
  env: Env,
  body: unknown
): Promise<Response> {
  if (!body || typeof body !== "object") {
    return json(
      {
        error: "invalid_body",
        message: "Expected a JSON object",
        validationErrors: [{ field: "body", reason: "not an object" }]
      },
      400
    );
  }
  const b = body as Record<string, unknown>;
  const parsed = parsePositionPostBody(b);
  if (!parsed.ok) {
    console.warn("[seer] POST /api/positions validation failed:", parsed.validationErrors);
    return json(
      {
        error: "validation_error",
        message: "One or more fields failed validation",
        validationErrors: parsed.validationErrors
      },
      400
    );
  }

  const {
    marketId,
    direction,
    stake,
    mode,
    layer,
    signalsJson,
    platform,
    platformBetId,
    entryPriceOverride
  } = parsed;

  console.log("[seer] POST /api/positions body:", JSON.stringify(b));
  console.log("[seer] entry_price lookup for market:", marketId);

  const market = await getMarketForPosition(env.DB, marketId);
  if (!market) {
    return json({ error: "market_not_found", marketId }, 404);
  }

  let entryPrice =
    direction === "YES" ? market.yes_price : market.no_price;
  if (
    mode === "LIVE" &&
    entryPriceOverride != null &&
    Number.isFinite(entryPriceOverride) &&
    entryPriceOverride > 0 &&
    entryPriceOverride < 1
  ) {
    entryPrice = entryPriceOverride;
  }
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    console.warn("[seer] POST /api/positions bad entry price from market", {
      marketId,
      direction,
      yes_price: market.yes_price,
      no_price: market.no_price
    });
    return json(
      {
        error: "invalid_market_prices",
        message: "Market has no valid price for this direction",
        field: "entry_price",
        yes_price: market.yes_price,
        no_price: market.no_price
      },
      400
    );
  }

  if (
    (await countOpenPositionsForMarketAndDirection(
      env.DB,
      marketId,
      direction
    )) > 0
  ) {
    return json(
      {
        ok: false,
        error: "duplicate_position",
        message:
          "Already have an open position on this market in this direction"
      },
      400
    );
  }

  const platformOddsClamped = Math.max(
    1.01,
    Math.min(2000, 1 / Math.max(entryPrice, 1e-6))
  );
  const storedPlatform = mode === "LIVE" && platform ? platform : null;
  let mergedSignals = signalsJson ?? "[]";
  if (mode === "LIVE" && storedPlatform) {
    try {
      const arr = JSON.parse(mergedSignals) as unknown;
      const list = Array.isArray(arr) ? arr.map(String) : [];
      list.push(`[MANUAL_LOG:${storedPlatform}]`);
      mergedSignals = JSON.stringify(list);
    } catch {
      mergedSignals = JSON.stringify([`[MANUAL_LOG:${storedPlatform}]`]);
    }
  }

  let insertResult: { id: number };
  try {
    insertResult = await insertOpenPosition(env.DB, {
      marketId,
      direction,
      stake,
      mode,
      entryPrice,
      layer,
      signalsJson: mergedSignals,
      marketQuestion: market.question,
      platform: storedPlatform,
      platform_bet_id: platformBetId,
      platform_odds: storedPlatform ? platformOddsClamped : null,
      appliedCommission: 0
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[seer] insertOpenPosition threw:", e);
    return json(
      {
        ok: false,
        error: "insert_failed",
        message,
        hint:
          "If this mentions signals_json or app_meta, apply D1 migrations from seer/migrations/"
      },
      500
    );
  }

  const id = insertResult.id;
  if (!Number.isFinite(id) || id <= 0) {
    console.error("[seer] insertOpenPosition returned invalid id", insertResult);
    return json(
      {
        ok: false,
        error: "insert_failed",
        message: "Position was not created; check D1 binding and schema."
      },
      500
    );
  }

  return json({
    ok: true,
    positionId: id,
    marketId,
    direction,
    stake,
    mode,
    entryPrice,
    layer
  });
}

async function handleTaxExport(env: Env): Promise<Response> {
  const positions = await listPositionsWithMarket(env.DB);
  const { start, end } = ukTaxYearWindowUTC(new Date());
  const startMs = start.getTime();
  const endMs = end.getTime();

  const inYear = positions.filter((p) => {
    const rt = parseSqliteOrIsoDate(p.resolved_at);
    const ct = parseSqliteOrIsoDate(p.created_at);
    const t = p.status === "CLOSED" ? rt : ct;
    if (t == null) return false;
    return t >= startMs && t <= endMs;
  });

  const header = "date,market,direction,stake,return,profit";
  const lines: string[] = [header];
  let totalProfit = 0;

  for (const p of inYear) {
    const dateStr =
      p.status === "CLOSED" && p.resolved_at
        ? p.resolved_at
        : p.created_at;
    const market = p.market_question ?? p.market_id;
    const ret =
      p.status === "CLOSED" && p.stake > 0 && p.profit_loss != null
        ? String((p.profit_loss / p.stake).toFixed(6))
        : "";
    const profit =
      p.profit_loss != null ? String(p.profit_loss.toFixed(2)) : "";
    if (p.profit_loss != null) totalProfit += p.profit_loss;

    lines.push(
      [
        escapeCsvCell(dateStr),
        escapeCsvCell(market),
        escapeCsvCell(p.direction),
        escapeCsvCell(String(p.stake)),
        escapeCsvCell(ret),
        escapeCsvCell(profit)
      ].join(",")
    );
  }

  lines.push(
    [
      escapeCsvCell("TOTAL"),
      "",
      "",
      "",
      "",
      escapeCsvCell(totalProfit.toFixed(2))
    ].join(",")
  );

  return textCsv(lines.join("\r\n"));
}
