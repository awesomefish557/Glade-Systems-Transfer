export type UniversalPlatform = "polymarket" | "betfair" | "matchbook" | "smarkets";

export type UniversalCategory = "sports" | "politics" | "crypto" | "other";

/** IDs and odds for worker-side order placement (optional on mock rows). */
export type UniversalPlatformPlacement = {
  betfair?: {
    marketId: string;
    yesSelectionId: number;
    noSelectionId?: number;
    yesDecimalOdds: number;
    noDecimalOdds?: number;
  };
  matchbook?: {
    marketId: string;
    yesRunnerId: number;
    noRunnerId?: number;
    yesDecimalOdds: number;
    noDecimalOdds?: number;
  };
};

export interface UniversalMarket {
  id: string;
  platform: UniversalPlatform;
  question: string;
  category: UniversalCategory;
  yesPrice: number;
  noPrice: number;
  volume: number;
  endDate: string;
  resolved: boolean;
  resolutionOutcome?: "YES" | "NO";
  externalUrl?: string;
  /** Platform commission on winnings, e.g. 0.05 = 5%. */
  commission: number;
  placement?: UniversalPlatformPlacement;
}
