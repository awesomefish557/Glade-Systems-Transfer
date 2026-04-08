export type TradeMode = "paper" | "live";

export interface Opportunity {
  marketId: string;
  question: string;
  category: string;
  direction: string;
  currentPrice: number;
  daysToResolution: number;
  aer: number;
  timeToDouble: number;
  psychologyScore: number;
  layer: string;
  kellyFraction: number;
  suggestedStake: number;
  calibratedProbability: number;
  marketProbability: number;
  signals: string[];
  computedAt: string;
}

export interface Position {
  id: number;
  market_id: string;
  direction: string;
  stake: number;
  entry_price: number;
  exit_price: number | null;
  profit_loss: number | null;
  status: string;
  mode: string;
  layer: string | null;
  signals_json?: string | null;
  created_at: string;
  resolved_at: string | null;
  market_question: string | null;
  market_yes_price: number | null;
  market_no_price: number | null;
  market_end_date: string | null;
  market_resolved?: number | null;
  market_resolution_outcome?: string | null;
}

export interface PortfolioStats {
  totalProfitLoss: number;
  aerSinceLaunch: number;
  winRateByLayer: Record<
    string,
    { wins: number; total: number; winRate: number }
  >;
  hmrcAnnualProfit: number;
  runningAnnualProfit: number;
  threshold1000Warning: boolean;
  liveAerSimple?: number | null;
  /** Closed positions only: wins / total (0–1). */
  winRateClosed: number;
  winRateClosedBreakdown: { wins: number; total: number; pct: number };
  openCount: number;
  openPositionsCount?: number;
  totalAtRisk: number;
  resolvedClosedCount?: number;
  ukTaxYear: { start: string; end: string };
}

export interface DigestResponse {
  newOpportunities: Array<{
    marketId: string;
    question: string;
    direction: string;
    aer: number;
    days: number;
    layer: string;
  }>;
  resolvingSoon: Array<{
    id: number;
    market_id: string;
    direction: string;
    stake: number;
    market_question: string | null;
    end_date: string;
  }>;
  recentlyResolved: Array<{
    id: number;
    market_id: string;
    direction: string;
    stake: number;
    profit_loss: number | null;
    resolved_at: string;
    market_question: string | null;
    resolution_outcome: string | null;
  }>;
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
}

export interface AerCalculator {
  aerSinceLaunch: number;
  timeToDoubleDays: number | null;
  totalProfitLoss: number;
}

export interface OpportunitiesResponse {
  opportunities: Opportunity[];
  count: number;
  aerSinceLaunch: number;
  timeToDoubleDays: number | null;
  totalProfitLoss: number;
  aerCalculator: AerCalculator;
}

export interface PortfolioResponse {
  open: Position[];
  resolved: Position[];
  cancelled: Position[];
  totalPnl: number;
  positions: Position[];
  _debug?: {
    total: { c: number } | null;
    joined: { c: number } | null;
  };
}

export interface CalibrationBucketRow {
  priceBucket: string;
  sampleSize: number;
  resolutionRate: number;
  lastUpdated: string;
}

export interface CalibrationResponse {
  categories: Record<string, CalibrationBucketRow[]>;
}

export type LivePlatform = "betfair" | "matchbook" | "smarkets";

export type ComparisonPlatformKey =
  | "polymarket"
  | "betfair"
  | "matchbook"
  | "smarkets";

export type LivePlatformPriceColumn = {
  price: number | null;
  netProfitIfWinPerUnit: number | null;
  commission: number;
  matchedQuestion?: string;
  expectedNetProfitIfWin?: number | null;
};

export type LivePlatformComparison = {
  direction: "YES" | "NO";
  polymarket: LivePlatformPriceColumn | null;
  betfair: LivePlatformPriceColumn | null;
  matchbook: LivePlatformPriceColumn | null;
  smarkets: LivePlatformPriceColumn | null;
  bestPlatform: ComparisonPlatformKey | null;
  suggestedStake?: number;
};

export type PriceFeedStatus = {
  ok: boolean;
  count: number;
  error?: string;
};

export type LiveOpportunityRow = {
  marketId: string;
  question: string;
  direction: "YES" | "NO";
  currentPrice: number;
  daysToResolution: number;
  aer: number;
  aerGross: number;
  timeToDouble: number;
  platform: LivePlatform;
  commission: number;
  externalUrl?: string;
  psychologyScore: number;
  signals: string[];
  suggestedStake: number;
  platformComparison?: LivePlatformComparison | null;
};

export type LiveArbitrageRow = {
  question: string;
  betfairPrice: number;
  matchbookPrice: number;
  difference: number;
  action: string;
  expectedProfit: string;
};

export type LiveOpportunitiesResponse = {
  opportunities: LiveOpportunityRow[];
  arbitrage: LiveArbitrageRow[];
  count: number;
  fetchedMarkets: number;
  combinedExchangeVolume: number;
  combinedExchangeVolumeByPlatform: {
    betfair: number;
    matchbook: number;
    smarkets: number;
  };
  priceFeeds: {
    betfair: PriceFeedStatus;
    matchbook: PriceFeedStatus;
    smarkets: PriceFeedStatus;
  };
};

export type PaperPlatformChoice =
  | "polymarket"
  | "paper-betfair"
  | "paper-matchbook"
  | "paper-smarkets";

/** TRADING tab row shape (subset + optional cross-venue block from worker). */
export type TradingOpportunityRow = {
  marketId: string;
  question: string;
  direction: "YES" | "NO";
  currentPrice: number;
  daysToResolution: number;
  aer: number;
  timeToDouble: number;
  psychologyScore: number;
  signals: string[];
  layer: string | number;
  kellyFraction: number;
  marketProbability: number;
  calibratedProbability: number;
  category: string;
  computedAt: string;
  suggestedStake: number;
  platformComparison?: LivePlatformComparison | null;
};

export type BacktestStrategyResult = {
  name: string;
  totalBets: number;
  winRate: number;
  totalProfit: number;
  roi: number;
  aer: number;
  byCategory: Record<
    string,
    { bets: number; wins: number; profit?: number; roi: number }
  >;
  bestCategory?: string;
  worstCategory?: string;
  bestBet?: { question: string; profit: number };
  worstBet?: { question: string; loss: number };
  note?: string;
};

/** Closed positions backtest: venue bucket + net figures after commission. */
export type BacktestPlatformRow = {
  key: string;
  label: string;
  bets: number;
  wins: number;
  winRate: number;
  totalNetProfit: number;
  totalStaked: number;
  roi: number;
  netAer: number;
  avgDaysHeld: number;
  commissionRate: number;
};

export type BacktestCalibrationBucketRow = {
  priceBucket: string;
  sampleSize: number;
  hitRate: number;
};

export type BacktestResponse = {
  marketsAnalysed: number;
  marketsQualified: number;
  strategies: BacktestStrategyResult[];
  bestStrategyIndex: number;
  projection: {
    strategyName: string;
    startingBankroll: number;
    endingBankroll: number;
  };
  positionsClosedAnalysed?: number;
  positionsByPlatform?: BacktestPlatformRow[];
  calibrationByPlatform?: Record<string, BacktestCalibrationBucketRow[]>;
  commissionLegend?: Record<string, string>;
};
