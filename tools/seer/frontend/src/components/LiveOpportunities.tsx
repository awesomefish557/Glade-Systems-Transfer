import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { fetchJson, postJson } from "../api";
import { useOpenPositionMarketIds } from "../hooks/useOpenPositionMarketIds";
import type {
  ComparisonPlatformKey,
  LiveArbitrageRow,
  LiveOpportunitiesResponse,
  LiveOpportunityRow,
  LivePlatform,
  LivePlatformComparison,
  PriceFeedStatus
} from "../types";
import { formatCompactVolume, formatGbp, formatPct, tagsFromSignals } from "../utils";

type PlatformFilter = "all" | LivePlatform;

const COMPARE_KEYS = [
  "polymarket",
  "betfair",
  "matchbook",
  "smarkets"
] as const;
type CompareKey = (typeof COMPARE_KEYS)[number];

function ScoreDots({ psychologyScore }: { psychologyScore: number }) {
  const filled = Math.min(5, Math.max(0, Math.round(psychologyScore / 2)));
  return (
    <span className="dots dots--tier2" aria-label={`Score ${filled} of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < filled ? "on" : ""}>
          {i < filled ? "●" : "○"}
        </span>
      ))}
    </span>
  );
}

function PlatformBadge({ platform }: { platform: LivePlatform }) {
  const map = {
    betfair: { cls: "live-badge--bf", label: "BF" },
    matchbook: { cls: "live-badge--mb", label: "MB" },
    smarkets: { cls: "live-badge--sm", label: "SM" }
  } as const;
  const m = map[platform];
  return (
    <span className={`live-badge ${m.cls}`} title={platform}>
      {m.label}
    </span>
  );
}

const FILTER_PILLS: { id: PlatformFilter; label: string }[] = [
  { id: "all", label: "All exchanges" },
  { id: "betfair", label: "Betfair 5%" },
  { id: "matchbook", label: "Matchbook 1%" },
  { id: "smarkets", label: "Smarkets 2%" }
];

const COMPARE_LABELS: Record<CompareKey, [string, string]> = {
  polymarket: ["PM", "0%"],
  betfair: ["BF", "5%"],
  matchbook: ["MB", "1%"],
  smarkets: ["SM", "2%"]
};

function defaultFeeds(): LiveOpportunitiesResponse["priceFeeds"] {
  const z: PriceFeedStatus = { ok: false, count: 0, error: "unknown" };
  return { betfair: z, matchbook: z, smarkets: z };
}

function fmtDays(d: number): string {
  return d >= 100 ? `${Math.round(d)}` : d.toFixed(1);
}

function fmtPx(
  c: LivePlatformComparison | null | undefined,
  k: CompareKey
): string {
  if (!c) return "—";
  const col = c[k];
  if (!col || typeof col !== "object" || col == null || !("price" in col)) {
    return "—";
  }
  const p = col.price;
  return p != null && Number.isFinite(p) ? p.toFixed(3) : "—";
}

function fmtNet(
  c: LivePlatformComparison | null | undefined,
  k: CompareKey
): string {
  if (!c) return "—";
  const col = c[k];
  if (
    !col ||
    typeof col !== "object" ||
    col == null ||
    !("netProfitIfWinPerUnit" in col)
  ) {
    return "—";
  }
  const n = col.netProfitIfWinPerUnit;
  return n != null && Number.isFinite(n) ? n.toFixed(3) : "—";
}

function fmtStakeNet(
  c: LivePlatformComparison | null | undefined,
  k: CompareKey
): string {
  if (!c) return "—";
  const col = c[k];
  if (!col || typeof col !== "object") return "—";
  const n = col.expectedNetProfitIfWin;
  return n != null && Number.isFinite(n) ? formatGbp(n, 2) : "—";
}

function feedStatusLine(label: string, f: PriceFeedStatus): string {
  if (f.ok) return `${label}: live (${f.count} markets)`;
  return `${label}: error${f.error ? ` — ${f.error.slice(0, 80)}` : ""}`;
}

function PlacedBadge() {
  return (
    <span
      className="opp-placed-badge"
      title="You have an open position on this market"
    >
      <span className="opp-placed-dot" aria-hidden>
        ●
      </span>{" "}
      Placed
    </span>
  );
}

export default function LiveOpportunities() {
  const [data, setData] = useState<{
    opportunities: LiveOpportunityRow[];
    arbitrage: LiveArbitrageRow[];
    fetchedMarkets: number;
    combinedExchangeVolume: number;
    combinedExchangeVolumeByPlatform: LiveOpportunitiesResponse["combinedExchangeVolumeByPlatform"];
    priceFeeds: LiveOpportunitiesResponse["priceFeeds"];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<PlatformFilter>("all");
  const [panelOpen, setPanelOpen] = useState(false);
  const [betBusy, setBetBusy] = useState<string | null>(null);
  const { placedMarketIds, refetchOpenPositions } =
    useOpenPositionMarketIds("any");

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetchJson<LiveOpportunitiesResponse>("/api/live-opportunities");
      setData({
        opportunities: r.opportunities,
        arbitrage: r.arbitrage,
        fetchedMarkets: r.fetchedMarkets,
        combinedExchangeVolume: r.combinedExchangeVolume,
        combinedExchangeVolumeByPlatform: r.combinedExchangeVolumeByPlatform,
        priceFeeds: r.priceFeeds ?? defaultFeeds()
      });
      await refetchOpenPositions();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [refetchOpenPositions]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 90_000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    const op = data?.opportunities ?? [];
    if (filter === "all") return op;
    return op.filter((o) => o.platform === filter);
  }, [data, filter]);

  const placeBet = useCallback(
    async (
      o: LiveOpportunityRow,
      venue: "betfair" | "matchbook"
    ): Promise<void> => {
      const key = `${venue}-${o.marketId}`;
      setBetBusy(key);
      try {
        const stake = Math.max(1, Math.round(o.suggestedStake * 100) / 100);
        const r = await postJson<{
          ok: boolean;
          betId?: string;
          positionId?: number;
          error?: string;
        }>("/api/platform-bet", {
          marketId: o.marketId,
          platform: venue,
          direction: o.direction,
          stake
        });
        if (r.ok && r.betId != null) {
          window.alert(
            `Order accepted at live exchange price. Bet id: ${r.betId} · Seer position #${r.positionId} · stake £${stake}. Winnings settle net of that venue’s commission.`
          );
          await refetchOpenPositions();
        } else {
          window.alert(`Bet failed: ${(r as { error?: string }).error ?? "unknown"}`);
        }
      } catch (e) {
        window.alert(e instanceof Error ? e.message : String(e));
      } finally {
        setBetBusy(null);
      }
    },
    [refetchOpenPositions]
  );

  return (
    <div className="live-opportunities">
      <p className="muted live-intro">
        Live opportunities use <strong>Betfair</strong>, <strong>Matchbook</strong>, and{" "}
        <strong>Smarkets</strong> price feeds only (matched volume and best back prices). AER is{" "}
        <strong>after</strong> each venue&apos;s commission on winnings. Polymarket is not used for
        pricing or execution here; it may still feed research and discovery elsewhere in the
        pipeline.
        {data != null && (
          <>
            {" "}
            Fetched <span className="num">{data.fetchedMarkets}</span> raw markets this pass.
          </>
        )}
      </p>

      {data != null && (
        <div className="panel live-feed-status" aria-label="Price feed health">
          <p className="live-widget-title">Live price feeds</p>
          <p className="muted live-widget-body">
            {feedStatusLine("Betfair", data.priceFeeds.betfair)}
            <br />
            {feedStatusLine("Matchbook", data.priceFeeds.matchbook)}
            <br />
            {feedStatusLine("Smarkets", data.priceFeeds.smarkets)}
          </p>
          <p className="muted live-widget-body" style={{ marginTop: "0.5rem" }}>
            Smarkets <strong>OAuth</strong> (for real orders later): set{" "}
            <code style={{ fontFamily: "ui-monospace, monospace" }}>SMARKETS_CLIENT_ID</code>,{" "}
            <code style={{ fontFamily: "ui-monospace, monospace" }}>SMARKETS_CLIENT_SECRET</code>,{" "}
            <code style={{ fontFamily: "ui-monospace, monospace" }}>SMARKETS_REDIRECT_URI</code> on
            the worker and wire{" "}
            <code style={{ fontFamily: "ui-monospace, monospace" }}>buildSmarketsAuthorizeUrl</code>{" "}
            /{" "}
            <code style={{ fontFamily: "ui-monospace, monospace" }}>exchangeSmarketsOAuthCode</code>{" "}
            from{" "}
            <code style={{ fontFamily: "ui-monospace, monospace" }}>platforms/smarketsOAuth.ts</code>.
            Public read prices above do not require auth.
          </p>
        </div>
      )}

      {data != null && (
        <div className="live-liquidity-strip panel" aria-label="Combined exchange volume">
          <span className="live-liquidity-total">
            Combined matched volume (BF + MB + SM):{" "}
            <strong className="num">{formatCompactVolume(data.combinedExchangeVolume)}</strong>
          </span>
          <span className="muted live-liquidity-split">
            BF {formatCompactVolume(data.combinedExchangeVolumeByPlatform.betfair)} · MB{" "}
            {formatCompactVolume(data.combinedExchangeVolumeByPlatform.matchbook)} · SM{" "}
            {formatCompactVolume(data.combinedExchangeVolumeByPlatform.smarkets)}
          </span>
        </div>
      )}

      <div className="live-commission-widget panel">
        <p className="live-widget-title">Same bet, three UK exchanges</p>
        <p className="live-widget-body muted">
          Betfair: £10 bet → ~£0.19 net on a small win (5% commission on winnings)
          <br />
          Matchbook: £10 bet → ~£0.20 net (1% commission)
          <br />
          Smarkets: £10 bet → ~£0.20 net (2% commission)
          <br />
          Illustrative; always use live prices shown in the table.
        </p>
      </div>

      <button
        type="button"
        className="live-panel-toggle"
        onClick={() => setPanelOpen((o) => !o)}
        aria-expanded={panelOpen}
      >
        Platform status {panelOpen ? "▼" : "▶"}
      </button>
      {panelOpen && (
        <div className="table-wrap live-status-table-wrap">
          <table className="data-table live-status-table">
            <thead>
              <tr>
                <th>Platform</th>
                <th>Status</th>
                <th>Commission</th>
                <th>Best for</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Betfair</td>
                <td>
                  {data?.priceFeeds.betfair.ok
                    ? `✅ Live (${data.priceFeeds.betfair.count})`
                    : "⚠ Check worker"}
                </td>
                <td>5% (→2% with discount)</td>
                <td>Sports liquidity</td>
              </tr>
              <tr>
                <td>Matchbook</td>
                <td>
                  {data?.priceFeeds.matchbook.ok
                    ? `✅ Live (${data.priceFeeds.matchbook.count})`
                    : "⚠ Check worker"}
                </td>
                <td>1%</td>
                <td>Tight margins</td>
              </tr>
              <tr>
                <td>Smarkets</td>
                <td>
                  {data?.priceFeeds.smarkets.ok
                    ? `✅ Live (${data.priceFeeds.smarkets.count})`
                    : "⚠ Check worker"}
                </td>
                <td>2%</td>
                <td>Politics &amp; current affairs</td>
              </tr>
              <tr>
                <td>Kalshi</td>
                <td>⏳ Coming soon</td>
                <td>~1%</td>
                <td>TBD</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {loading && !data && <div className="loading">Loading live markets…</div>}
      {err && <div className="error-banner">{err}</div>}

      {data && data.arbitrage.length > 0 && (
        <section className="live-arb-section" aria-label="Arbitrage hints">
          <h3 className="live-section-h">Arbitrage (Betfair vs Matchbook)</h3>
          <p className="muted live-arb-note">
            Heuristic matches across the two APIs — always verify same outcome and liquidity before
            trading.
          </p>
          <ul className="live-arb-list">
            {data.arbitrage.map((a, i) => (
              <li key={i} className="live-arb-card panel">
                <div className="live-arb-q">{a.question}</div>
                <div className="muted live-arb-meta">
                  BF {a.betfairPrice.toFixed(3)} vs MB {a.matchbookPrice.toFixed(3)} · Δ{" "}
                  {a.difference.toFixed(3)}
                </div>
                <div className="live-arb-action">{a.action}</div>
                <div className="live-arb-profit">{a.expectedProfit}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="live-filter-bar" role="toolbar" aria-label="Platform filter">
        {FILTER_PILLS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`opp-filter-chip ${filter === p.id ? "is-active" : ""}`}
            onClick={() => setFilter(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <table className="data-table live-opp-table">
          <thead>
            <tr>
              <th>Plat</th>
              <th>Market</th>
              <th>Dir</th>
              <th>Price</th>
              <th>Days</th>
              <th>AER</th>
              <th>Score</th>
              <th>Signals</th>
              <th className="live-bet-col">Bet</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty">
                  {loading ? "…" : "No rows match this filter (or below Seer thresholds)."}
                </td>
              </tr>
            ) : (
              filtered.map((o, idx) => {
                const c = o.platformComparison;
                const best: ComparisonPlatformKey | null = c?.bestPlatform ?? null;
                return (
                  <Fragment key={`${o.platform}-${o.marketId}-${idx}`}>
                    <tr>
                      <td>
                        <PlatformBadge platform={o.platform} />
                      </td>
                      <td className="market-cell">
                        <div className="market-cell-row">
                          <span>{o.question}</span>
                          {placedMarketIds.has(String(o.marketId)) ? (
                            <PlacedBadge />
                          ) : null}
                        </div>
                      </td>
                      <td className="num">{o.direction}</td>
                      <td className="num">{o.currentPrice.toFixed(3)}</td>
                      <td className="num">{fmtDays(o.daysToResolution)}</td>
                      <td className="num">
                        {formatPct(o.aer, 1)}{" "}
                        <span className="muted live-aer-sub">
                          (after {(o.commission * 100).toFixed(0)}% fee; gross{" "}
                          {formatPct(o.aerGross, 1)})
                        </span>
                      </td>
                      <td>
                        <ScoreDots psychologyScore={o.psychologyScore} />
                      </td>
                      <td>
                        <div className="tag-row">
                          {tagsFromSignals(o.signals).map((t) => (
                            <span key={t} className="signal-tag">
                              [{t}]
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="live-bet-col">
                        <div className="live-bet-btns">
                          {o.platform === "smarkets" ? (
                            <button
                              type="button"
                              className="btn-bet live-bet--sm"
                              disabled={!o.externalUrl}
                              title="Open this market on Smarkets (live prices; 2% commission on winnings)"
                              onClick={() => {
                                if (o.externalUrl)
                                  window.open(o.externalUrl, "_blank", "noopener,noreferrer");
                              }}
                            >
                              Smarkets
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="btn-bet live-bet--bf"
                                disabled={betBusy !== null}
                                title="Place BACK on Betfair at live price (5% on winnings)"
                                onClick={() => void placeBet(o, "betfair")}
                              >
                                {betBusy === `betfair-${o.marketId}` ? "…" : "Betfair"}
                              </button>
                              <button
                                type="button"
                                className="btn-bet live-bet--mb"
                                disabled={betBusy !== null}
                                title="Place BACK on Matchbook at live price (1% on winnings)"
                                onClick={() => void placeBet(o, "matchbook")}
                              >
                                {betBusy === `matchbook-${o.marketId}` ? "…" : "Matchbook"}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    <tr className="live-compare-row">
                      <td colSpan={9}>
                        <div className="live-compare-widget">
                          <span className="live-compare-title">
                            PM vs UK exchanges (fuzzy match) · per £1 staked if {o.direction} wins
                            (after fee) · at suggested stake £
                            {o.suggestedStake.toFixed(0)} net win → second line
                          </span>
                          <div
                            className="live-compare-grid live-compare-grid--4"
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                              gap: "0.5rem"
                            }}
                          >
                            {COMPARE_KEYS.map((k) => {
                              const [label, fee] = COMPARE_LABELS[k];
                              return (
                                <div
                                  key={k}
                                  className={`live-compare-cell ${
                                    best === k ? "is-best" : ""
                                  }`}
                                >
                                  <div className="live-compare-plat">
                                    {label}{" "}
                                    <span className="muted">({fee})</span>
                                  </div>
                                  <div className="live-compare-p">p={fmtPx(c, k)}</div>
                                  <div className="live-compare-net">+{fmtNet(c, k)} / £1</div>
                                  <div className="live-compare-net live-compare-net--stake muted">
                                    → {fmtStakeNet(c, k)} at sug.
                                  </div>
                                  {best === k ? (
                                    <div className="live-compare-best">Best</div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="muted live-refresh-hint">
        Auto-refresh every 90s ·{" "}
        <button
          type="button"
          className="btn-ghost live-refresh-btn"
          onClick={() => void load()}
        >
          Refresh now
        </button>
      </p>
    </div>
  );
}
