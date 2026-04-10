import type { Env } from "./db";

/** UK tax year: 6 April (inclusive) → 5 April next year (inclusive end-of-day). */
function ukTaxYearWindowUTC(reference: Date): { start: Date; end: Date } {
  const y = reference.getUTCFullYear();
  const m = reference.getUTCMonth();
  const d = reference.getUTCDate();
  const onOrAfterApril6 = m > 3 || (m === 3 && d >= 6);
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

function daysBetween(aMs: number, bMs: number): number {
  return Math.max(1, Math.round((bMs - aMs) / 86_400_000));
}

type ResolvedRow = {
  stake: number;
  profit_loss: number;
  created_at: string;
  resolved_at: string | null;
  layer: string | null;
};

type OpenAgg = { openCount: number; totalAtRisk: number };

/**
 * Stats from D1 `positions` only (resolved = status CLOSED with P&L + stake).
 */
export async function buildPortfolioStats(
  env: Env
): Promise<Record<string, unknown>> {
  const { results: closedRaw = [] } = await env.DB.prepare(
    `SELECT stake, profit_loss, created_at, resolved_at, layer
     FROM positions
     WHERE status = 'CLOSED'
       AND profit_loss IS NOT NULL
       AND stake > 0`
  ).all<ResolvedRow>();

  const closed = closedRaw.filter(
    (r) =>
      Number.isFinite(r.stake) &&
      r.stake > 0 &&
      r.profit_loss != null &&
      Number.isFinite(r.profit_loss)
  );

  const totalProfitLoss = closed.reduce((s, r) => s + r.profit_loss, 0);

  const aerSamples: number[] = [];
  for (const p of closed) {
    const created = parseSqliteOrIsoDate(p.created_at);
    const resolved = parseSqliteOrIsoDate(p.resolved_at);
    if (created == null || resolved == null) continue;
    const days = daysBetween(created, resolved);
    const r = p.profit_loss / p.stake;
    if (r <= -1) continue;
    const annualized = Math.pow(1 + r, 365 / days) - 1;
    if (Number.isFinite(annualized)) aerSamples.push(annualized);
  }
  const aerSinceLaunch =
    aerSamples.length > 0
      ? aerSamples.reduce((a, b) => a + b, 0) / aerSamples.length
      : 0;

  const layerStats: Record<
    string,
    { wins: number; total: number; winRate: number }
  > = {};
  for (const p of closed) {
    const layer = p.layer?.trim() || "unassigned";
    if (!layerStats[layer]) {
      layerStats[layer] = { wins: 0, total: 0, winRate: 0 };
    }
    layerStats[layer].total += 1;
    if (p.profit_loss > 0) layerStats[layer].wins += 1;
  }
  for (const k of Object.keys(layerStats)) {
    const L = layerStats[k];
    L.winRate = L.total > 0 ? L.wins / L.total : 0;
  }

  const now = new Date();
  const { start: tyStart, end: tyEnd } = ukTaxYearWindowUTC(now);
  const tyStartMs = tyStart.getTime();
  const tyEndMs = tyEnd.getTime();

  let hmrcAnnualProfit = 0;
  for (const p of closed) {
    const rt = parseSqliteOrIsoDate(p.resolved_at);
    if (rt == null) continue;
    if (rt >= tyStartMs && rt <= tyEndMs) {
      hmrcAnnualProfit += p.profit_loss;
    }
  }

  const yearAgo = now.getTime() - 365 * 86_400_000;
  let runningAnnualProfit = 0;
  for (const p of closed) {
    const rt = parseSqliteOrIsoDate(p.resolved_at);
    if (rt == null || rt < yearAgo) continue;
    runningAnnualProfit += p.profit_loss;
  }

  const threshold1000Warning = runningAnnualProfit >= 1000;

  const totalStakedClosed = closed.reduce((s, p) => s + p.stake, 0);
  let firstClosedBetMs: number | null = null;
  for (const p of closed) {
    const t = parseSqliteOrIsoDate(p.created_at);
    if (t != null && (firstClosedBetMs == null || t < firstClosedBetMs)) {
      firstClosedBetMs = t;
    }
  }
  const daysSinceFirstClosed =
    firstClosedBetMs != null
      ? Math.max(1, (Date.now() - firstClosedBetMs) / 86_400_000)
      : 0;
  const liveAerSimple =
    totalStakedClosed > 0 && daysSinceFirstClosed > 0
      ? (totalProfitLoss / totalStakedClosed) * (365 / daysSinceFirstClosed)
      : null;

  let weightedHoldDays = 0;
  for (const p of closed) {
    const created = parseSqliteOrIsoDate(p.created_at);
    const resolved = parseSqliteOrIsoDate(p.resolved_at);
    if (created == null || resolved == null) continue;
    const dh = Math.max(1, (resolved - created) / 86_400_000);
    weightedHoldDays += dh * p.stake;
  }
  const avgHoldDaysClosed =
    totalStakedClosed > 0 ? weightedHoldDays / totalStakedClosed : 0;
  const roiPortfolio =
    totalStakedClosed > 0 ? totalProfitLoss / totalStakedClosed : 0;
  const liveAerBlended =
    totalStakedClosed > 0 &&
    avgHoldDaysClosed > 0 &&
    roiPortfolio > -0.999
      ? Math.pow(1 + roiPortfolio, 365 / avgHoldDaysClosed) - 1
      : null;

  const sortedByResolved = [...closed]
    .map((p) => ({
      p,
      rt: parseSqliteOrIsoDate(p.resolved_at)
    }))
    .filter((x) => x.rt != null)
    .sort((a, b) => (a.rt ?? 0) - (b.rt ?? 0));
  let liveAerTrend: "improving" | "stable" | "declining" | null = null;
  if (sortedByResolved.length >= 4) {
    const mid = Math.floor(sortedByResolved.length / 2);
    const firstHalf = sortedByResolved.slice(0, mid);
    const secondHalf = sortedByResolved.slice(mid);
    const aerHalf = (rows: typeof firstHalf) => {
      let s = 0;
      let w = 0;
      for (const { p } of rows) {
        const c = parseSqliteOrIsoDate(p.created_at);
        const r = parseSqliteOrIsoDate(p.resolved_at);
        if (c == null || r == null) continue;
        const days = Math.max(1, (r - c) / 86_400_000);
        const rRet = p.profit_loss / p.stake;
        if (rRet <= -1) continue;
        const ann = Math.pow(1 + rRet, 365 / days) - 1;
        if (Number.isFinite(ann)) {
          s += ann * p.stake;
          w += p.stake;
        }
      }
      return w > 0 ? s / w : null;
    };
    const a1 = aerHalf(firstHalf);
    const a2 = aerHalf(secondHalf);
    if (a1 != null && a2 != null && Number.isFinite(a1) && Number.isFinite(a2)) {
      const diff = a2 - a1;
      if (diff > 0.02) liveAerTrend = "improving";
      else if (diff < -0.02) liveAerTrend = "declining";
      else liveAerTrend = "stable";
    }
  }

  const winsClosed = closed.filter((p) => p.profit_loss > 0).length;
  const resolvedClosedCount = closed.length;
  const winRateClosed =
    resolvedClosedCount > 0 ? winsClosed / resolvedClosedCount : 0;

  const openRow = await env.DB
    .prepare(
      `SELECT COUNT(*) AS openCount, COALESCE(SUM(stake), 0) AS totalAtRisk
       FROM positions
       WHERE status = 'OPEN'`
    )
    .first<OpenAgg>();

  const openCount = Number(openRow?.openCount ?? 0);
  const totalAtRisk = Number(openRow?.totalAtRisk ?? 0);

  return {
    totalProfitLoss,
    aerSinceLaunch,
    hmrcAnnualProfit,
    runningAnnualProfit,
    winRateClosed,
    winRateClosedBreakdown: {
      wins: winsClosed,
      total: resolvedClosedCount,
      pct: winRateClosed
    },
    winRateByLayer: layerStats,
    openCount,
    openPositionsCount: openCount,
    totalAtRisk,
    threshold1000Warning,
    resolvedClosedCount,
    liveAerSimple,
    liveAerBlended,
    avgHoldDaysClosed:
      avgHoldDaysClosed > 0 ? avgHoldDaysClosed : null,
    liveAerTrend,
    backtestStrategyBTarget: 0.474,
    ukTaxYear: {
      start: tyStart.toISOString(),
      end: tyEnd.toISOString()
    }
  };
}
