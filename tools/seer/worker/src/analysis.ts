/**
 * Seer analysis engine — AER, Kelly, calibration, psychology, opportunity ranking.
 */

export interface Market {
  id: string;
  question: string;
  category: string;
  end_date: string;
  yes_price: number;
  no_price: number;
  volume: number;
  liquidity: number;
  resolved: number;
  resolution_outcome: string | null;
  last_trade_price: number | null;
}

export interface PriceHistory {
  id: number;
  market_id: string;
  yes_price: number;
  volume: number;
  recorded_at: string;
}

export interface Opportunity {
  marketId: string;
  question: string;
  category: string;
  direction: "YES" | "NO";
  currentPrice: number;
  daysToResolution: number;
  aer: number;
  timeToDouble: number;
  psychologyScore: number;
  layer: "1" | "2" | "3";
  kellyFraction: number;
  suggestedStake: number;
  calibratedProbability: number;
  marketProbability: number;
  signals: string[];
}

const MIN_CALIBRATION_SAMPLES = 20;
/** Minimum liquidity (USD) for markets considered in opportunity analysis. */
export const MIN_VOLUME_USD = 1_000;
const MIN_AER_FOR_OPPORTUNITY = 0.05;
const MAX_DAYS_FOR_OPPORTUNITY = 365;

/** Shared WHERE for "tradeable open" markets (future end_date, analysis + listActiveMarkets). */
const OPEN_MARKETS_OPPORTUNITY_FILTER = `resolved = 0
       AND volume >= ?
       AND end_date > datetime('now')`;

/** Nominal bankroll for suggestedStake = kelly ├ù bankroll (UI hint). */
const DEFAULT_BANKROLL = 10_000;

const ROUND_ANCHORS = [0.1, 0.25, 0.5, 0.75, 0.9];
const MS_PER_DAY = 86_400_000;

/**
 * Annualised return for holding the contract at `price` until resolution (decimal AER).
 * Same structure for YES price or NO price: ((1/price) - 1) * (365 / days).
 */
export function calcAnnualisedReturn(
  noPrice: number,
  daysToResolution: number
): number {
  if (noPrice <= 0 || daysToResolution <= 0) return 0;
  return ((1 / noPrice - 1) * 365) / daysToResolution;
}

/** Rule-of-72 style; `aer` is decimal (e.g. 0.15 = 15%). */
export function calcTimeToDouble(aer: number): number {
  if (aer <= 0) return Infinity;
  return 72 / (aer * 100);
}

/** Kelly fraction as edge/odds, capped at 10% of bankroll. */
export function kellyFraction(edge: number, odds: number): number {
  if (odds <= 0 || edge <= 0) return 0;
  const raw = edge / odds;
  return Math.min(0.1, raw);
}

function yesPriceToBucket(yesPrice: number): string {
  const p = Math.max(0, Math.min(1, yesPrice));
  const idx = Math.min(9, Math.floor(p * 10));
  const low = idx * 10;
  return `${low}-${low + 10}%`;
}

export type CalibrationLookupRow = {
  sample_size: number;
  resolution_rate: number;
};

function calibrationKey(category: string, priceBucket: string): string {
  return `${category}\n${priceBucket}`;
}

function calibratedProbFromLookup(
  yesPrice: number,
  row: CalibrationLookupRow | undefined
): number {
  if (!row || row.sample_size < MIN_CALIBRATION_SAMPLES) {
    return yesPrice;
  }
  return row.resolution_rate;
}

/**
 * Historical resolution rate for this category + YES price bucket, or market price if sample too small.
 */
export async function getCalibratedProbability(
  category: string,
  yesPrice: number,
  db: D1Database
): Promise<number> {
  const price_bucket = yesPriceToBucket(yesPrice);
  const row = await db
    .prepare(
      `SELECT sample_size, resolution_rate FROM calibration
       WHERE category = ? AND price_bucket = ?`
    )
    .bind(category, price_bucket)
    .first<CalibrationLookupRow>();

  return calibratedProbFromLookup(yesPrice, row ?? undefined);
}

type PsychologyDetails = {
  score: number;
  signals: string[];
};

/**
 * For resolved or past-dated markets, raw `daysToResolution` floors near 0 and
 * blows up AER in mechanical rules — use a nominal horizon for scoring only.
 */
function effectiveDaysForScoring(market: Market): number {
  const d = daysToResolution(market.end_date);
  return d < 1 ? 30 : d;
}

function evaluatePsychology(
  market: Market,
  priceHistory: PriceHistory[],
  calibratedProb: number
): PsychologyDetails {
  const signals: string[] = [];
  const { yes_price: yesPrice, no_price: noPrice, category, volume } = market;
  const catLower = category.toLowerCase();
  const daysPsy = effectiveDaysForScoring(market);
  const aerYes = calcAnnualisedReturn(yesPrice, daysPsy);
  const aerNo = calcAnnualisedReturn(noPrice, daysPsy);
  /** AER for the heavily priced side (near-certain thesis), not max(NO cheap spike). */
  const structuralAer =
    yesPrice > 0.85 ? aerYes : noPrice > 0.85 ? aerNo : Math.max(aerYes, aerNo);

  let layer1 = 0;
  if ((yesPrice > 0.85 || noPrice > 0.85) && structuralAer > 0.08) {
    layer1 += 4;
    signals.push("mechanical: extreme lean (>85%) with AER > 8%");
  }
  if (yesPrice > 0.9 || noPrice > 0.9) {
    layer1 += 3;
    signals.push("mechanical: NEAR_CERT (>90% implied)");
  }
  if (layer1 < 4 && Math.max(aerYes, aerNo) > 0.08) {
    layer1 += 2;
    signals.push("mechanical: AER > 8%");
  }

  let layer2Points = 0;

  if (yesPrice < 0.08 && (catLower.includes("politics") || catLower.includes("entertainment"))) {
    layer2Points += 3;
    signals.push("behavioural: longshot bias (politics/entertainment)");
  }

  if (recencyMovedOver15Pct(priceHistory, yesPrice)) {
    layer2Points += 2;
    signals.push("behavioural: recency (>15% move in 48h)");
  }

  if (roundNumberAnchoring(yesPrice)) {
    layer2Points += 1;
    signals.push("behavioural: round-number anchoring");
  }

  if (attentionDecay(priceHistory, volume, daysToResolution(market.end_date))) {
    layer2Points += 2;
    signals.push("behavioural: attention decay (volume down, resolving soon)");
  }

  if (Math.abs(calibratedProb - yesPrice) > 0.04) {
    layer2Points += 2;
    signals.push("behavioural: calibration gap vs market");
  }

  layer2Points = Math.min(5, layer2Points);

  const signalsBeforeCompound = signals.length;
  let compound = 0;
  if (signalsBeforeCompound >= 3) {
    compound = 1;
    signals.push("compound: 3+ signals active");
  }

  const raw = layer1 + layer2Points + compound;
  const score = Math.min(10, Math.max(0, raw));

  return { score, signals };
}

function recencyMovedOver15Pct(
  history: PriceHistory[],
  currentYes: number
): boolean {
  const now = Date.now();
  const cutoff = now - 48 * 60 * 60 * 1000;
  const inWindow = history
    .filter((h) => {
      const t = Date.parse(h.recorded_at);
      return !Number.isNaN(t) && t >= cutoff;
    })
    .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
  if (inWindow.length === 0) return false;
  const oldest = inWindow[0].yes_price;
  const newest = inWindow[inWindow.length - 1].yes_price;
  const swing = Math.abs(newest - oldest);
  if (swing > 0.15) return true;
  if (Math.abs(currentYes - oldest) > 0.15) return true;
  if (Math.abs(currentYes - newest) > 0.15) return true;
  return false;
}

function roundNumberAnchoring(yesPrice: number): boolean {
  return ROUND_ANCHORS.some((a) => Math.abs(yesPrice - a) <= 0.03);
}

function attentionDecay(
  history: PriceHistory[],
  currentVolume: number,
  daysToResolutionVal: number
): boolean {
  if (daysToResolutionVal > 14 || history.length < 4) return false;
  const sorted = [...history].sort(
    (a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at)
  );
  const recent = sorted.slice(0, 3);
  const older = sorted.slice(3);
  const recentAvg =
    recent.reduce((s, h) => s + h.volume, 0) / Math.max(1, recent.length);
  const olderAvg =
    older.reduce((s, h) => s + h.volume, 0) / Math.max(1, older.length);
  if (olderAvg <= 0) return false;
  const dropped = recentAvg < 0.3 * olderAvg;
  const volDroppedVsMarket =
    currentVolume > 0 && recentAvg < 0.3 * currentVolume;
  return dropped || volDroppedVsMarket;
}

/**
 * Psychology score 0–10 from mechanical, behavioural, and compound rules.
 */
export function psychologyScore(
  market: Market,
  priceHistory: PriceHistory[],
  calibratedProb: number
): number {
  return evaluatePsychology(market, priceHistory, calibratedProb).score;
}

/**
 * Opportunity tier. Layer 1 = near-certain, short-dated, high-AER only.
 */
export function classifyLayer(
  score: number,
  aer: number,
  daysToResolution: number,
  yesPrice: number,
  noPrice: number,
  signals?: readonly string[]
): "1" | "2" | "3" {
  const judgement =
    signals?.some((s) => s.startsWith("behavioural:")) ?? false;
  const layer1Eligible =
    score >= 4 &&
    aer > 0.15 &&
    daysToResolution <= 30 &&
    (yesPrice > 0.85 || noPrice > 0.85);
  if (layer1Eligible) return "1";
  if (score >= 7 && judgement) return "3";
  if (score >= 4) return "2";
  return "2";
}

function decimalOddsFromPrice(price: number): number {
  if (price <= 0 || price >= 1) return 0;
  return (1 - price) / price;
}

function parseEndDateToMs(endDate: string): number | null {
  const trimmed = endDate.trim();
  if (!trimmed) return null;

  const fromDate = new Date(trimmed).getTime();
  if (Number.isFinite(fromDate)) {
    return fromDate;
  }

  if (/^\d{10,13}$/.test(trimmed)) {
    const n = Number(trimmed);
    const ms = n < 1e12 ? n * 1000 : n;
    const t = new Date(ms).getTime();
    return Number.isFinite(t) ? t : null;
  }

  const p = Date.parse(trimmed);
  return Number.isNaN(p) ? null : p;
}

/** Days until resolution; floored at 0.1 so AER does not blow up on bad or past dates. */
function daysToResolution(endDate: string): number {
  const endMs = parseEndDateToMs(endDate);
  if (endMs === null) {
    return 0.1;
  }
  const days = (endMs - Date.now()) / MS_PER_DAY;
  return Math.max(days, 0.1);
}

function rowToMarket(r: Record<string, unknown>): Market {
  return {
    id: String(r.id),
    question: String(r.question ?? ""),
    category: String(r.category ?? ""),
    end_date: String(r.end_date ?? ""),
    yes_price: Number(r.yes_price ?? 0),
    no_price: Number(r.no_price ?? 0),
    volume: Number(r.volume ?? 0),
    liquidity: Number(r.liquidity ?? 0),
    resolved: Number(r.resolved ?? 0),
    resolution_outcome:
      r.resolution_outcome === null || r.resolution_outcome === undefined
        ? null
        : String(r.resolution_outcome),
    last_trade_price:
      r.last_trade_price === null || r.last_trade_price === undefined
        ? null
        : Number(r.last_trade_price)
  };
}

type CalibrationTableRow = {
  category: string;
  price_bucket: string;
  sample_size: number;
  resolution_rate: number;
};

function buildHistoryByMarket(phRows: PriceHistory[]): Map<string, PriceHistory[]> {
  const historyByMarket = new Map<string, PriceHistory[]>();
  for (const h of phRows) {
    const list = historyByMarket.get(h.market_id);
    if (list) list.push(h);
    else historyByMarket.set(h.market_id, [h]);
  }
  return historyByMarket;
}

export function buildCalibrationMap(
  calRows: CalibrationTableRow[]
): Map<string, CalibrationLookupRow> {
  const calMap = new Map<string, CalibrationLookupRow>();
  for (const r of calRows) {
    calMap.set(calibrationKey(r.category, r.price_bucket), {
      sample_size: r.sample_size,
      resolution_rate: r.resolution_rate
    });
  }
  return calMap;
}

/** Load calibration table into a map for scoring (D1 + live + backtest). */
export async function loadCalibrationMap(
  db: D1Database
): Promise<Map<string, CalibrationLookupRow>> {
  const { results: calRows = [] } = await db
    .prepare(
      `SELECT category, price_bucket, sample_size, resolution_rate FROM calibration`
    )
    .all<CalibrationTableRow>();
  return buildCalibrationMap(calRows);
}

function lookupCalibratedProbability(
  category: string,
  yesPrice: number,
  calMap: Map<string, CalibrationLookupRow>
): number {
  const bucket = yesPriceToBucket(yesPrice);
  return calibratedProbFromLookup(
    yesPrice,
    calMap.get(calibrationKey(category, bucket))
  );
}

/**
 * Full scoring: direction, gross AER, Kelly, psychology 0–10, L1/L2/L3 — shared by
 * D1 opportunities and live exchange rows (gross AER; caller may apply commission).
 */
function scoreMarketToOpportunity(
  market: Market,
  history: PriceHistory[],
  calMap: Map<string, CalibrationLookupRow>
): Opportunity | null {
  const days = daysToResolution(market.end_date);
  const calibratedProbability = lookupCalibratedProbability(
    market.category,
    market.yes_price,
    calMap
  );

  const edgeYes = calibratedProbability - market.yes_price;
  const edgeNo = 1 - calibratedProbability - market.no_price;
  const aerYes = calcAnnualisedReturn(market.yes_price, days);
  const aerNo = calcAnnualisedReturn(market.no_price, days);

  let direction: "YES" | "NO";
  let currentPrice: number;
  let aer: number;
  let edge: number;
  let odds: number;
  let marketProbability: number;

  if (market.yes_price > 0.85) {
    direction = "YES";
    currentPrice = market.yes_price;
    aer = aerYes;
    edge = edgeYes;
    odds = decimalOddsFromPrice(market.yes_price);
    marketProbability = market.yes_price;
  } else if (market.no_price > 0.85) {
    direction = "NO";
    currentPrice = market.no_price;
    aer = aerNo;
    edge = edgeNo;
    odds = decimalOddsFromPrice(market.no_price);
    marketProbability = market.no_price;
  } else if (edgeYes >= edgeNo) {
    direction = "YES";
    currentPrice = market.yes_price;
    aer = aerYes;
    edge = edgeYes;
    odds = decimalOddsFromPrice(market.yes_price);
    marketProbability = market.yes_price;
  } else {
    direction = "NO";
    currentPrice = market.no_price;
    aer = aerNo;
    edge = edgeNo;
    odds = decimalOddsFromPrice(market.no_price);
    marketProbability = market.no_price;
  }

  const psych = evaluatePsychology(market, history, calibratedProbability);
  const kelly = kellyFraction(edge, odds);
  const layer = classifyLayer(
    psych.score,
    aer,
    days,
    market.yes_price,
    market.no_price,
    psych.signals
  );
  const timeToDouble = calcTimeToDouble(aer);

  if (aer <= MIN_AER_FOR_OPPORTUNITY) return null;
  if (days > MAX_DAYS_FOR_OPPORTUNITY) return null;

  return {
    marketId: market.id,
    question: market.question,
    category: market.category,
    direction,
    currentPrice,
    daysToResolution: days,
    aer,
    timeToDouble: Number.isFinite(timeToDouble) ? timeToDouble : 0,
    psychologyScore: psych.score,
    layer,
    kellyFraction: kelly,
    suggestedStake: kelly * DEFAULT_BANKROLL,
    calibratedProbability,
    marketProbability,
    signals: psych.signals
  };
}

function scoreD1OpportunityRows(
  marketRows: Record<string, unknown>[],
  historyByMarket: Map<string, PriceHistory[]>,
  calMap: Map<string, CalibrationLookupRow>
): Opportunity[] {
  const opportunities: Opportunity[] = [];

  for (const raw of marketRows) {
    const market = rowToMarket(raw);
    const history = historyByMarket.get(market.id) ?? [];
    const op = scoreMarketToOpportunity(market, history, calMap);
    if (op) opportunities.push(op);
  }

  opportunities.sort((a, b) => b.aer - a.aer);
  return opportunities;
}

/** Default page size for paginated admin analysis (Worker subrequest / CPU limits). */
export const DEFAULT_ANALYSIS_PAGE_SIZE = 200;

export type AnalyseMarketsPageResult = {
  opportunities: Opportunity[];
  hasMore: boolean;
};

/**
 * One analysis page: `limit` open markets by volume, three D1 reads, in-memory scoring.
 */
export async function analyseMarketsPage(
  db: D1Database,
  offset: number,
  limit: number
): Promise<AnalyseMarketsPageResult> {
  const { results: marketRows = [] } = await db
    .prepare(
      `SELECT * FROM markets
       WHERE ${OPEN_MARKETS_OPPORTUNITY_FILTER}
       ORDER BY volume DESC
       LIMIT ? OFFSET ?`
    )
    .bind(MIN_VOLUME_USD, limit, offset)
    .all<Record<string, unknown>>();

  if (marketRows.length === 0) {
    return { opportunities: [], hasMore: false };
  }

  const { results: phRows = [] } = await db
    .prepare(
      `WITH page_ids AS (
         SELECT id FROM markets
         WHERE ${OPEN_MARKETS_OPPORTUNITY_FILTER}
         ORDER BY volume DESC
         LIMIT ? OFFSET ?
       ),
       ranked AS (
         SELECT
           ph.id,
           ph.market_id,
           ph.yes_price,
           ph.volume,
           ph.recorded_at,
           ROW_NUMBER() OVER (
             PARTITION BY ph.market_id
             ORDER BY ph.recorded_at DESC
           ) AS rn
         FROM price_history ph
         WHERE ph.market_id IN (SELECT id FROM page_ids)
       )
       SELECT id, market_id, yes_price, volume, recorded_at
       FROM ranked
       WHERE rn <= 200`
    )
    .bind(MIN_VOLUME_USD, limit, offset)
    .all<PriceHistory>();

  const { results: calRows = [] } = await db
    .prepare(
      `SELECT category, price_bucket, sample_size, resolution_rate FROM calibration`
    )
    .all<CalibrationTableRow>();

  const opportunities = scoreD1OpportunityRows(
    marketRows,
    buildHistoryByMarket(phRows),
    buildCalibrationMap(calRows)
  );

  return {
    opportunities,
    hasMore: marketRows.length === limit
  };
}

/**
 * Full pass over liquid open markets; sorted by AER descending.
 * Three D1 round-trips: all open markets, batched price history (≤200 rows / market), calibration.
 */
export async function analyseAllMarkets(db: D1Database): Promise<Opportunity[]> {
  const { results: marketRows = [] } = await db
    .prepare(
      `SELECT * FROM markets WHERE ${OPEN_MARKETS_OPPORTUNITY_FILTER} ORDER BY volume DESC`
    )
    .bind(MIN_VOLUME_USD)
    .all<Record<string, unknown>>();

  if (marketRows.length === 0) {
    return [];
  }

  const { results: phRows = [] } = await db
    .prepare(
      `WITH open_ids AS (
         SELECT id FROM markets WHERE ${OPEN_MARKETS_OPPORTUNITY_FILTER}
       ),
       ranked AS (
         SELECT
           ph.id,
           ph.market_id,
           ph.yes_price,
           ph.volume,
           ph.recorded_at,
           ROW_NUMBER() OVER (
             PARTITION BY ph.market_id
             ORDER BY ph.recorded_at DESC
           ) AS rn
         FROM price_history ph
         WHERE ph.market_id IN (SELECT id FROM open_ids)
       )
       SELECT id, market_id, yes_price, volume, recorded_at
       FROM ranked
       WHERE rn <= 200`
    )
    .bind(MIN_VOLUME_USD)
    .all<PriceHistory>();

  const { results: calRows = [] } = await db
    .prepare(
      `SELECT category, price_bucket, sample_size, resolution_rate FROM calibration`
    )
    .all<CalibrationTableRow>();

  return scoreD1OpportunityRows(
    marketRows,
    buildHistoryByMarket(phRows),
    buildCalibrationMap(calRows)
  );
}

/** Live UK-exchange rows (no D1 calibration in the hot path). */
export type LiveOpportunity = {
  marketId: string;
  question: string;
  category: string;
  direction: "YES" | "NO";
  currentPrice: number;
  daysToResolution: number;
  aer: number;
  psychologyScore: number;
  signals: string[];
  suggestedStake: number;
  layer: string;
  kellyFraction: number;
  marketProbability: number;
  calibratedProbability: number;
  aerGross?: number;
  timeToDouble?: number;
  platform?: "betfair" | "matchbook" | "smarkets";
  commission?: number;
  externalUrl?: string;
  computedAt?: string;
  placement?: unknown;
  platformComparison?: unknown;
};

export type BacktestScoredRow = {
  question: string;
  category: string;
  layer: string;
  psychologyScore: number;
  lastTradeYes: number;
  modelDirection: "YES" | "NO";
  resolution_outcome: "YES" | "NO";
};

export function calcAnnualisedReturnNetOfCommission(
  currentPrice: number,
  daysToResolution: number,
  commission: number
): number {
  if (!Number.isFinite(daysToResolution) || daysToResolution <= 0) return 0;
  if (currentPrice <= 0 || currentPrice >= 1) return 0;
  const grossWin = 1 / currentPrice - 1;
  if (grossWin <= 0) return 0;
  const netWin = grossWin * (1 - Math.min(0.99, Math.max(0, commission)));
  const periodReturn = netWin;
  return Math.pow(1 + periodReturn, 365 / Math.max(daysToResolution, 0.5)) - 1;
}

/** Compound doubling time for net decimal AER (live exchange view). */
export function calcTimeToDoubleNetAer(aer: number): number {
  if (!Number.isFinite(aer) || aer <= 0) return Infinity;
  const daily = Math.pow(1 + aer, 1 / 365) - 1;
  if (daily <= 0) return Infinity;
  return Math.log(2) / Math.log(1 + daily);
}

/**
 * Score live / exchange-shaped rows with the same engine as D1 opportunities.
 * Pass price history per `market.id` when available; `calMap` from `loadCalibrationMap`.
 */
export function scoreMarketsFromRows(
  rows: Array<Record<string, unknown>>,
  historyByMarket: Map<string, PriceHistory[]>,
  calMap: Map<string, CalibrationLookupRow>
): LiveOpportunity[] {
  const out: LiveOpportunity[] = [];
  for (const r of rows) {
    const market = rowToMarket(r);
    if (
      !market.id ||
      !market.question ||
      !Number.isFinite(market.yes_price) ||
      !Number.isFinite(market.no_price)
    ) {
      continue;
    }
    const history = historyByMarket.get(market.id) ?? [];
    const op = scoreMarketToOpportunity(market, history, calMap);
    if (!op) continue;
    out.push({
      marketId: op.marketId,
      question: op.question,
      category: op.category,
      direction: op.direction,
      currentPrice: op.currentPrice,
      daysToResolution: op.daysToResolution,
      aer: op.aer,
      psychologyScore: op.psychologyScore,
      signals: op.signals,
      suggestedStake: op.suggestedStake,
      layer: op.layer,
      kellyFraction: op.kellyFraction,
      marketProbability: op.marketProbability,
      calibratedProbability: op.calibratedProbability,
      timeToDouble: op.timeToDouble
    });
  }
  return out;
}

/**
 * Historical backtest rows: entry from 30d price or last trade; full psychology + layer.
 */
export function scoreResolvedMarketsForBacktest(
  marketRows: Array<Record<string, unknown>>,
  calMap: Map<string, CalibrationLookupRow> = new Map()
): BacktestScoredRow[] {
  const out: BacktestScoredRow[] = [];
  for (const m of marketRows) {
    const question = String(m.question ?? "");
    const cat = String(m.category ?? "other");
    const yes = Number(m.yes_price);
    const no = Number(m.no_price);
    const lt =
      m.last_trade_price != null && Number.isFinite(Number(m.last_trade_price))
        ? Number(m.last_trade_price)
        : yes;
    const hist = m.price_30d_before;
    const entryYes =
      hist != null && Number.isFinite(Number(hist)) ? Number(hist) : lt;
    const res = m.resolution_outcome;
    if (res !== "YES" && res !== "NO") continue;
    if (!Number.isFinite(entryYes) || entryYes <= 0 || entryYes >= 1) continue;
    const entryNo = Math.max(0.0001, Math.min(0.9999, 1 - entryYes));
    const noP = 1 - entryYes;
    let modelDirection: "YES" | "NO";
    if (entryYes > 0.85) modelDirection = "YES";
    else if (noP > 0.85) modelDirection = "NO";
    else modelDirection = entryYes >= 0.5 ? "YES" : "NO";

    const marketAtEntry: Market = {
      id: String(m.id ?? ""),
      question,
      category: cat,
      end_date: String(m.end_date ?? ""),
      yes_price: entryYes,
      no_price: entryNo,
      volume: Number(m.volume ?? 0),
      liquidity: Number(m.liquidity ?? 0),
      resolved: 1,
      resolution_outcome: res,
      last_trade_price: entryYes
    };

    const calP = lookupCalibratedProbability(cat, entryYes, calMap);
    const psych = evaluatePsychology(marketAtEntry, [], calP);
    const daysSc = effectiveDaysForScoring(marketAtEntry);
    const aerForLayer =
      modelDirection === "YES"
        ? calcAnnualisedReturn(entryYes, daysSc)
        : calcAnnualisedReturn(entryNo, daysSc);
    const layer = classifyLayer(
      psych.score,
      aerForLayer,
      daysSc,
      entryYes,
      entryNo,
      psych.signals
    );

    out.push({
      question,
      category: cat,
      layer,
      psychologyScore: psych.score,
      lastTradeYes: entryYes,
      modelDirection,
      resolution_outcome: res
    });
  }
  return out;
}
