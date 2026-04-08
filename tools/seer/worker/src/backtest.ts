import {
  loadCalibrationMap,
  scoreResolvedMarketsForBacktest,
  type BacktestScoredRow
} from "./analysis";
import { impliedYesToBucket, type Env } from "./db";
import { COMMISSION_ON_WINNINGS } from "./platforms";

const STAKE = 10;
const AVG_HOLD_DAYS = 30;
const STARTING_BANKROLL = 200;

type PlatformBucket =
  | "polymarket"
  | "paper-betfair"
  | "paper-matchbook"
  | "paper-smarkets"
  | "other";

const PLATFORM_ORDER: { key: PlatformBucket; label: string }[] = [
  { key: "polymarket", label: "Polymarket" },
  { key: "paper-betfair", label: "Paper / Betfair" },
  { key: "paper-matchbook", label: "Paper / Matchbook" },
  { key: "paper-smarkets", label: "Paper / Smarkets" },
  { key: "other", label: "Other" }
];

function normalizePlatformBucket(
  platform: string | null | undefined
): PlatformBucket {
  const p = String(platform ?? "").trim().toLowerCase();
  if (!p || p === "polymarket" || p === "pm" || p === "paper-pm") {
    return "polymarket";
  }
  if (p === "paper-betfair" || p === "betfair") return "paper-betfair";
  if (p === "paper-matchbook" || p === "matchbook") return "paper-matchbook";
  if (p === "paper-smarkets" || p === "smarkets") return "paper-smarkets";
  return "other";
}

function commissionForBucket(b: PlatformBucket): number {
  switch (b) {
    case "paper-betfair":
      return COMMISSION_ON_WINNINGS.betfair;
    case "paper-matchbook":
      return COMMISSION_ON_WINNINGS.matchbook;
    case "paper-smarkets":
      return COMMISSION_ON_WINNINGS.smarkets;
    default:
      return COMMISSION_ON_WINNINGS.polymarket;
  }
}

type ClosedPositionRow = {
  direction: string;
  stake: number;
  entry_price: number;
  profit_loss: number | null;
  platform: string | null;
  created_at: string;
  resolved_at: string | null;
  resolution_outcome: string | null;
  question: string | null;
};

function parseSqliteOrIsoMs(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isNaN(t) ? null : t;
}

function holdDays(createdAt: string, resolvedAt: string | null): number {
  const a = parseSqliteOrIsoMs(createdAt);
  const b = parseSqliteOrIsoMs(resolvedAt) ?? a;
  if (a == null || b == null) return AVG_HOLD_DAYS;
  const d = Math.max(1, Math.round((b - a) / 86_400_000));
  return d;
}

function positionWon(
  direction: string,
  resolution: string | null,
  profitLoss: number | null
): boolean {
  const res = String(resolution ?? "").trim().toUpperCase();
  const dir = String(direction ?? "").trim().toUpperCase();
  if (res === "YES" || res === "NO") {
    return (
      (dir === "YES" && res === "YES") || (dir === "NO" && res === "NO")
    );
  }
  return profitLoss != null && Number.isFinite(profitLoss) && profitLoss > 0;
}

/** Net P&L after commission on winnings (UK venues); PM / other 0%. */
function netPnlAfterCommission(
  won: boolean,
  stake: number,
  entryPrice: number,
  rate: number
): number | null {
  if (!Number.isFinite(stake) || stake <= 0) return null;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || entryPrice >= 1) {
    return null;
  }
  if (!won) return -stake;
  const grossWin = stake * (1 / entryPrice - 1);
  if (grossWin <= 0) return -stake;
  const r = Math.min(0.99, Math.max(0, rate));
  return grossWin * (1 - r);
}

function impliedYesForBackedSide(
  direction: string,
  entryPrice: number
): number | null {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || entryPrice >= 1) {
    return null;
  }
  const dir = String(direction ?? "").trim().toUpperCase();
  if (dir === "YES") return entryPrice;
  if (dir === "NO") return 1 - entryPrice;
  return null;
}

type CalibCell = { wins: number; n: number };

function emptyCalibMap(): Map<string, CalibCell> {
  return new Map();
}

async function buildPositionPlatformBacktest(env: Env): Promise<{
  positionsClosedAnalysed: number;
  positionsByPlatform: Record<string, unknown>[];
  calibrationByPlatform: Record<string, Record<string, unknown>[]>;
}> {
  const { results: rows = [] } = await env.DB.prepare(
    `SELECT p.direction, p.stake, p.entry_price, p.profit_loss, p.platform,
            p.created_at, p.resolved_at,
            m.resolution_outcome,
            COALESCE(m.question, p.market_question) AS question
     FROM positions p
     LEFT JOIN markets m ON CAST(p.market_id AS TEXT) = CAST(m.id AS TEXT)
     WHERE p.status = 'CLOSED'
       AND p.profit_loss IS NOT NULL
       AND p.stake > 0
       AND p.entry_price > 0
     ORDER BY p.resolved_at DESC
     LIMIT 5000`
  ).all<ClosedPositionRow>();

  type Agg = {
    bets: number;
    wins: number;
    totalNet: number;
    totalStaked: number;
    sumDays: number;
    calib: Map<string, CalibCell>;
  };

  const aggs: Record<PlatformBucket, Agg> = {
    polymarket: {
      bets: 0,
      wins: 0,
      totalNet: 0,
      totalStaked: 0,
      sumDays: 0,
      calib: emptyCalibMap()
    },
    "paper-betfair": {
      bets: 0,
      wins: 0,
      totalNet: 0,
      totalStaked: 0,
      sumDays: 0,
      calib: emptyCalibMap()
    },
    "paper-matchbook": {
      bets: 0,
      wins: 0,
      totalNet: 0,
      totalStaked: 0,
      sumDays: 0,
      calib: emptyCalibMap()
    },
    "paper-smarkets": {
      bets: 0,
      wins: 0,
      totalNet: 0,
      totalStaked: 0,
      sumDays: 0,
      calib: emptyCalibMap()
    },
    other: {
      bets: 0,
      wins: 0,
      totalNet: 0,
      totalStaked: 0,
      sumDays: 0,
      calib: emptyCalibMap()
    }
  };

  let used = 0;
  for (const r of rows) {
    const bucket = normalizePlatformBucket(r.platform);
    const rate = commissionForBucket(bucket);
    const won = positionWon(r.direction, r.resolution_outcome, r.profit_loss);
    const net = netPnlAfterCommission(
      won,
      Number(r.stake),
      Number(r.entry_price),
      rate
    );
    if (net == null) continue;

    used += 1;
    const agg = aggs[bucket];
    agg.bets += 1;
    if (won) agg.wins += 1;
    agg.totalNet += net;
    agg.totalStaked += Number(r.stake);
    agg.sumDays += holdDays(r.created_at, r.resolved_at);

    const iy = impliedYesForBackedSide(r.direction, Number(r.entry_price));
    const bLabel = iy != null ? impliedYesToBucket(iy) : null;
    if (bLabel) {
      const cell = agg.calib.get(bLabel) ?? { wins: 0, n: 0 };
      cell.n += 1;
      if (won) cell.wins += 1;
      agg.calib.set(bLabel, cell);
    }
  }

  const positionsByPlatform: Record<string, unknown>[] = [];
  const calibrationByPlatform: Record<string, Record<string, unknown>[]> = {};

  for (const { key, label } of PLATFORM_ORDER) {
    const a = aggs[key];
    const winRate = a.bets > 0 ? a.wins / a.bets : 0;
    const roi = a.totalStaked > 0 ? a.totalNet / a.totalStaked : 0;
    const avgDays = a.bets > 0 ? a.sumDays / a.bets : AVG_HOLD_DAYS;
    const netAer =
      a.totalStaked > 0 && avgDays > 0
        ? Math.pow(1 + a.totalNet / a.totalStaked, 365 / avgDays) - 1
        : 0;
    const cr = commissionForBucket(key);
    positionsByPlatform.push({
      key,
      label,
      bets: a.bets,
      wins: a.wins,
      winRate,
      totalNetProfit: a.totalNet,
      totalStaked: a.totalStaked,
      roi,
      netAer,
      avgDaysHeld: avgDays,
      commissionRate: cr
    });

    const calRows: Record<string, unknown>[] = [];
    const labels = [...a.calib.keys()].sort();
    for (const bk of labels) {
      const c = a.calib.get(bk)!;
      calRows.push({
        priceBucket: bk,
        sampleSize: c.n,
        hitRate: c.n > 0 ? c.wins / c.n : 0
      });
    }
    calibrationByPlatform[key] = calRows;
  }

  return {
    positionsClosedAnalysed: used,
    positionsByPlatform,
    calibrationByPlatform
  };
}

function normalizeCategoryKey(cat: string): string {
  const x = cat.toLowerCase();
  if (x.includes("politic") || x.includes("election")) return "politics";
  if (
    x.includes("sport") ||
    x.includes("nba") ||
    x.includes("nfl") ||
    x.includes("soccer")
  )
    return "sports";
  if (x.includes("crypto") || x.includes("bitcoin") || x.includes("eth"))
    return "crypto";
  return "other";
}

function simBet(sc: BacktestScoredRow): {
  pnl: number;
  won: boolean;
  question: string;
  category: string;
} | null {
  const lt = sc.lastTradeYes;
  const noP = 1 - lt;
  let dir: "YES" | "NO";
  if (lt > 0.85) dir = "YES";
  else if (noP > 0.85) dir = "NO";
  else dir = sc.modelDirection;
  const entry = dir === "YES" ? lt : noP;
  if (entry <= 0 || entry >= 1) return null;
  const won = dir === sc.resolution_outcome;
  const pnl = won ? STAKE * (1 / entry - 1) : -STAKE;
  return { pnl, won, question: sc.question, category: sc.category };
}

type CatAgg = { bets: number; wins: number; profit: number; staked: number };

function aggregateStrategy(
  name: string,
  rows: BacktestScoredRow[],
  predicate: (sc: BacktestScoredRow) => boolean
): Record<string, unknown> {
  const bets: Array<{ pnl: number; won: boolean; question: string; cat: string }> =
    [];
  for (const sc of rows) {
    if (!predicate(sc)) continue;
    const b = simBet(sc);
    if (!b) continue;
    bets.push({
      pnl: b.pnl,
      won: b.won,
      question: b.question,
      cat: b.category
    });
  }

  const totalBets = bets.length;
  const wins = bets.filter((x) => x.won).length;
  const losses = totalBets - wins;
  const totalStaked = totalBets * STAKE;
  const totalProfit = bets.reduce((s, x) => s + x.pnl, 0);
  const winRate = totalBets > 0 ? wins / totalBets : 0;
  const roi = totalStaked > 0 ? totalProfit / totalStaked : 0;
  const aer =
    totalStaked > 0 && AVG_HOLD_DAYS > 0
      ? Math.pow(1 + totalProfit / totalStaked, 365 / AVG_HOLD_DAYS) - 1
      : 0;

  let bestBet: { question: string; profit: number } | null = null;
  let worstBet: { question: string; loss: number } | null = null;
  let minPnl = Infinity;
  for (const b of bets) {
    if (bestBet == null || b.pnl > bestBet.profit) {
      bestBet = { question: b.question, profit: b.pnl };
    }
    if (b.pnl < minPnl) {
      minPnl = b.pnl;
      worstBet = {
        question: b.question,
        loss: b.pnl < 0 ? Math.abs(b.pnl) : 0
      };
    }
  }

  const catMap: Record<string, CatAgg> = {};
  for (const b of bets) {
    const k = normalizeCategoryKey(b.cat);
    if (!catMap[k]) {
      catMap[k] = { bets: 0, wins: 0, profit: 0, staked: 0 };
    }
    const c = catMap[k];
    c.bets += 1;
    if (b.won) c.wins += 1;
    c.profit += b.pnl;
    c.staked += STAKE;
  }

  const byCategory: Record<string, { bets: number; wins: number; roi: number }> =
    {};
  for (const [k, c] of Object.entries(catMap)) {
    byCategory[k] = {
      bets: c.bets,
      wins: c.wins,
      roi: c.staked > 0 ? c.profit / c.staked : 0
    };
  }

  let bestCategory: string | null = null;
  let worstCategory: string | null = null;
  let bestRoi = -Infinity;
  let worstRoi = Infinity;
  for (const [k, v] of Object.entries(byCategory)) {
    if (v.bets < 2) continue;
    if (v.roi > bestRoi) {
      bestRoi = v.roi;
      bestCategory = k;
    }
    if (v.roi < worstRoi) {
      worstRoi = v.roi;
      worstCategory = k;
    }
  }

  return {
    name,
    totalBets,
    wins,
    losses,
    winRate,
    totalStaked,
    totalProfit,
    roi,
    aer,
    avgDaysHeld: AVG_HOLD_DAYS,
    bestBet,
    worstBet,
    byCategory,
    bestCategory,
    worstCategory,
    bankrollProjection: {
      startingBankroll: STARTING_BANKROLL,
      endingBankroll: STARTING_BANKROLL * (1 + roi)
    },
    note:
      "Simulated on resolved Polymarket corpus (flat £10 stakes, 0% commission — research prices)."
  };
}

export async function runBacktest(env: Env): Promise<Record<string, unknown>> {
  const { results: marketRows = [] } = await env.DB.prepare(
    `SELECT m.id, m.question, m.category, m.yes_price, m.no_price,
              m.end_date, m.resolution_outcome, m.last_trade_price,
              h.price_30d_before
       FROM markets m
       LEFT JOIN market_price_history h ON m.id = h.market_id
       WHERE m.resolved = 1
         AND m.resolution_outcome IN ('YES', 'NO')
         AND (
           (h.price_30d_before IS NOT NULL AND h.price_30d_before > 0)
           OR (
             (m.last_trade_price IS NOT NULL
              AND m.last_trade_price > 0
              AND m.last_trade_price != m.yes_price)
             OR (m.last_trade_price IS NULL AND m.yes_price > 0)
           )
         )
       LIMIT 2000`
  ).all<Record<string, unknown>>();

  const marketsAnalysed = marketRows.length;

  const calMap = await loadCalibrationMap(env.DB);
  const scored = scoreResolvedMarketsForBacktest(marketRows, calMap);
  const marketsQualified = scored.length;

  const strategies = [
    aggregateStrategy("Strategy A: 4+ stars", scored, (s) => s.psychologyScore >= 4),
    aggregateStrategy("Strategy B: 5 star (7+ score)", scored, (s) => s.psychologyScore >= 7),
    aggregateStrategy("Strategy C: Layer 1 only", scored, (s) => s.layer === "1"),
    aggregateStrategy(
      "Strategy D: Layer 1 + 2",
      scored,
      (s) => s.layer === "1" || s.layer === "2"
    )
  ];

  let bestIdx = 0;
  let bestRoi = -Infinity;
  strategies.forEach((s, i) => {
    const r = s.roi as number;
    const bets = s.totalBets as number;
    if (bets === 0) return;
    if (r > bestRoi) {
      bestRoi = r;
      bestIdx = i;
    }
  });

  const best = strategies[bestIdx] as Record<string, unknown>;

  const positionVenue = await buildPositionPlatformBacktest(env);

  return {
    marketsAnalysed,
    marketsQualified,
    strategies,
    bestStrategyIndex: bestIdx,
    bestStrategyName: best.name,
    projection: {
      strategyName: best.name,
      startingBankroll: STARTING_BANKROLL,
      endingBankroll: (best.bankrollProjection as { endingBankroll: number })
        .endingBankroll
    },
    ...positionVenue,
    commissionLegend: {
      polymarket: "0%",
      betfair: "5% on winnings",
      matchbook: "1% on winnings",
      smarkets: "2% on winnings"
    }
  };
}
