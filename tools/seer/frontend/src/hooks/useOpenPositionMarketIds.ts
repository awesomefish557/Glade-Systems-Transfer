import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "../api";
import type { PortfolioResponse } from "../types";

/** `any` = OPEN positions in either paper or live (for the live opportunities table). */
export type OpenPositionTradeMode = "paper" | "live" | "any";

/**
 * Market IDs with at least one OPEN position (optionally filtered by paper vs live).
 */
export function useOpenPositionMarketIds(
  tradeMode: OpenPositionTradeMode
): {
  placedMarketIds: Set<string>;
  refetchOpenPositions: () => Promise<void>;
} {
  const [placedMarketIds, setPlacedMarketIds] = useState<Set<string>>(
    () => new Set()
  );

  const load = useCallback(async () => {
    try {
      const r = await fetchJson<PortfolioResponse>("/api/portfolio");
      const open = Array.isArray(r.open) ? r.open : [];
      const wantMode: "PAPER" | "LIVE" | null =
        tradeMode === "any"
          ? null
          : tradeMode === "paper"
            ? "PAPER"
            : "LIVE";
      const next = new Set<string>();
      for (const p of open) {
        if (String(p.status).toUpperCase() !== "OPEN") continue;
        if (
          wantMode !== null &&
          String(p.mode).toUpperCase() !== wantMode
        ) {
          continue;
        }
        next.add(String(p.market_id));
      }
      setPlacedMarketIds(next);
    } catch {
      setPlacedMarketIds(new Set());
    }
  }, [tradeMode]);

  useEffect(() => {
    void load();
  }, [load]);

  return { placedMarketIds, refetchOpenPositions: load };
}
