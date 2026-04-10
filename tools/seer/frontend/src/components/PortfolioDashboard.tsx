import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { fetchJson } from "../api";
import type { PortfolioStats, PortfolioResponse, Position } from "../types";
import { formatGbp } from "../utils";
import {
  formatLabour,
  formatSwPerYear
} from "../utils/supermarketWeeks";
import Portfolio from "./Portfolio";
import TaxTracker from "./TaxTracker";

const LABOUR_REM = "0.75rem";
const GOLD = "#d4a853";

const dashCardsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: "1rem"
};

function labourColour(gbp: number): string {
  return gbp > 0 ? GOLD : "var(--text-muted)";
}

export default function PortfolioDashboard() {
  const [stats, setStats] = useState<PortfolioStats | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [s, p] = await Promise.all([
        fetchJson<PortfolioStats>("/api/portfolio/stats"),
        fetchJson<PortfolioResponse>("/api/portfolio")
      ]);
      setStats(s);
      setPortfolio(p);
    } catch (e) {
      setStats(null);
      setPortfolio(null);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pnl = stats?.totalProfitLoss ?? 0;
  const liveRate = stats?.liveAerSimple;
  const atRisk = stats?.totalAtRisk ?? 0;
  const projectedYr =
    liveRate != null &&
    Number.isFinite(liveRate) &&
    atRisk > 0 &&
    Number.isFinite(atRisk)
      ? liveRate * atRisk
      : null;

  const resolved: Position[] = portfolio?.resolved ?? [];

  return (
    <div className="portfolio-dashboard">
      {err != null && (
        <div className="error-banner" role="alert">
          Portfolio dashboard: {err}
        </div>
      )}

      <div className="panel portfolio-dash-cards" style={dashCardsStyle}>
        <div className="portfolio-pnl-card">
          <div className="section-label">Portfolio P&amp;L</div>
          {stats == null && err == null ? (
            <div className="muted">Loading…</div>
          ) : stats != null ? (
            <>
              <div className="portfolio-pnl-main stat-v">
                {formatGbp(stats.totalProfitLoss)}
              </div>
              <div
                style={{
                  fontSize: LABOUR_REM,
                  color: labourColour(pnl),
                  marginTop: "0.25rem"
                }}
              >
                {formatLabour(pnl)}
              </div>
            </>
          ) : null}
        </div>

        {stats != null &&
          projectedYr != null &&
          Number.isFinite(projectedYr) && (
            <div className="portfolio-live-aer-card">
              <div className="section-label">Live AER (projected)</div>
              <div
                className="stat-v"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  gap: "0.35rem"
                }}
              >
                <span>{formatGbp(projectedYr, 0)}/yr</span>
                <span
                  style={{
                    fontSize: LABOUR_REM,
                    color: labourColour(projectedYr)
                  }}
                >
                  · {formatSwPerYear(projectedYr)}
                </span>
              </div>
            </div>
          )}
      </div>

      {portfolio != null && (
        <>
          <TaxTracker
            resolved={resolved}
            hmrcAnnualProfit={stats?.hmrcAnnualProfit ?? 0}
            thresholdWarning={stats?.threshold1000Warning ?? false}
          />
          <Portfolio open={portfolio.open} resolved={resolved} stats={stats} />
        </>
      )}
    </div>
  );
}
