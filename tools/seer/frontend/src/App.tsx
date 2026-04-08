import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "./api";
import BacktestPanel from "./components/BacktestPanel";
import LiveOpportunities from "./components/LiveOpportunities";
import PortfolioDashboard from "./components/PortfolioDashboard";
import type { LiveOpportunitiesResponse } from "./types";
import { formatCompactVolume } from "./utils";

type Tab = "home" | "trading" | "backtest" | "insights";

type HeaderStats = Pick<
  LiveOpportunitiesResponse,
  "combinedExchangeVolume" | "combinedExchangeVolumeByPlatform" | "fetchedMarkets"
>;

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [stats, setStats] = useState<HeaderStats | null>(null);
  const [statsErr, setStatsErr] = useState<string | null>(null);

  const refreshStats = useCallback(async () => {
    try {
      const r = await fetchJson<LiveOpportunitiesResponse>("/api/live-opportunities");
      setStats({
        combinedExchangeVolume: r.combinedExchangeVolume,
        combinedExchangeVolumeByPlatform: r.combinedExchangeVolumeByPlatform,
        fetchedMarkets: r.fetchedMarkets
      });
      setStatsErr(null);
    } catch (e) {
      setStats(null);
      setStatsErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refreshStats();
    const id = window.setInterval(() => void refreshStats(), 90_000);
    return () => clearInterval(id);
  }, [refreshStats]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-row">
          <h1 className="app-title">Seer</h1>
          <nav className="app-nav" aria-label="Primary">
            {(
              [
                ["home", "Home"],
                ["trading", "Trading"],
                ["insights", "Insights"],
                ["backtest", "Backtest"]
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`nav-tab ${tab === id ? "is-active" : ""}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
        <div
          className="header-stat-bar panel"
          role="status"
          aria-label="Combined exchange matched volume"
        >
          {statsErr != null ? (
            <span className="muted">Live stats unavailable ({statsErr})</span>
          ) : stats == null ? (
            <span className="muted">Loading exchange stats…</span>
          ) : (
            <>
              <span className="header-stat-main">
                BF + MB + SM matched volume:{" "}
                <strong className="num">{formatCompactVolume(stats.combinedExchangeVolume)}</strong>
              </span>
              <span className="muted header-stat-split">
                Betfair {formatCompactVolume(stats.combinedExchangeVolumeByPlatform.betfair)} · Matchbook{" "}
                {formatCompactVolume(stats.combinedExchangeVolumeByPlatform.matchbook)} · Smarkets{" "}
                {formatCompactVolume(stats.combinedExchangeVolumeByPlatform.smarkets)} ·{" "}
                {stats.fetchedMarkets} markets fetched
              </span>
            </>
          )}
        </div>
      </header>

      <main className="app-main">
        {tab === "home" && (
          <>
            <section className="home-intro panel">
              <h2 className="home-h">Prediction markets, UK exchanges</h2>
              <p className="muted">
                Seer ranks opportunities from <strong>Betfair</strong>, <strong>Matchbook</strong>, and{" "}
                <strong>Smarkets</strong> using live exchange prices. Use the Trading tab for scans and the
                stat bar above for pooled matched volume across all three.
              </p>
            </section>
            <PortfolioDashboard />
          </>
        )}
        {tab === "trading" && <LiveOpportunities />}
        {tab === "insights" && (
          <section className="panel">
            <p className="muted">Insights content is served from your corpus and signals pipeline.</p>
          </section>
        )}
        {tab === "backtest" && <BacktestPanel />}
      </main>
    </div>
  );
}
