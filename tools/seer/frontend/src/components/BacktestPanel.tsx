import { useState } from "react";
import { fetchJson } from "../api";
import type {
  BacktestCalibrationBucketRow,
  BacktestPlatformRow,
  BacktestResponse,
  BacktestStrategyResult
} from "../types";
import { formatGbp, formatPct } from "../utils";

export default function BacktestPanel() {
  const [data, setData] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setErr(null);
    setLoading(true);
    setData(null);
    try {
      const r = await fetchJson<BacktestResponse>("/api/backtest");
      setData(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel backtest-panel">
      <div className="backtest-toolbar">
        <button
          type="button"
          className="btn-primary"
          onClick={() => void run()}
          disabled={loading}
        >
          {loading ? "Running…" : "Run Backtest"}
        </button>
        {loading && (
          <span className="backtest-spinner" aria-hidden>
            <span className="backtest-spinner-dot" />
            <span className="backtest-spinner-dot" />
            <span className="backtest-spinner-dot" />
          </span>
        )}
      </div>
      {err && <div className="error-banner">{err}</div>}
      {data && (
        <>
          <p className="muted backtest-meta">
            Markets loaded: {data.marketsAnalysed} · Qualified (signal + AER):{" "}
            {data.marketsQualified}
            {data.positionsClosedAnalysed != null ? (
              <>
                <br />
                Closed positions (venue backtest): {data.positionsClosedAnalysed} rows with valid
                entry/stake used for net P&amp;L.
              </>
            ) : null}
          </p>
          {data.commissionLegend && (
            <p className="muted backtest-meta" style={{ marginTop: "0.35rem" }}>
              Commission on winnings: PM {data.commissionLegend.polymarket ?? "0%"} · BF{" "}
              {data.commissionLegend.betfair ?? "5%"} · MB {data.commissionLegend.matchbook ?? "1%"} ·
              SM {data.commissionLegend.smarkets ?? "2%"}.
            </p>
          )}
          <div className="table-wrap">
            <table className="data-table backtest-table">
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Bets</th>
                  <th>Win rate</th>
                  <th>Total profit</th>
                  <th>ROI</th>
                  <th>AER</th>
                </tr>
              </thead>
              <tbody>
                {data.strategies.map((s: BacktestStrategyResult, i: number) => (
                  <tr
                    key={s.name}
                    className={
                      i === data.bestStrategyIndex ? "backtest-row--best" : ""
                    }
                  >
                    <td>{s.name}</td>
                    <td className="num">{s.totalBets}</td>
                    <td className="num">{formatPct(s.winRate, 1)}</td>
                    <td
                      className={`num ${s.totalProfit > 0 ? "pnl-pos" : s.totalProfit < 0 ? "pnl-neg" : ""}`}
                    >
                      {formatGbp(s.totalProfit)}
                    </td>
                    <td className="num">{formatPct(s.roi, 1)}</td>
                    <td className="num">{formatPct(s.aer, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {Array.isArray(data.positionsByPlatform) && data.positionsByPlatform.length > 0 && (
            <div className="backtest-venue-section" style={{ marginTop: "1.25rem" }}>
              <h4 className="backtest-details-title">Historical positions by venue (net of commission)</h4>
              <p className="muted backtest-meta">
                Win rate and P&amp;L recomputed from closed positions; wins apply venue commission on
                gross profit (BF 5%, MB 1%, SM 2%, PM 0%). Net AER uses average hold days per venue.
              </p>
              <div className="table-wrap">
                <table className="data-table backtest-table">
                  <thead>
                    <tr>
                      <th>Venue</th>
                      <th>Bets</th>
                      <th>Win rate</th>
                      <th>Net profit</th>
                      <th>ROI (net)</th>
                      <th>Net AER</th>
                      <th className="num">Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.positionsByPlatform as BacktestPlatformRow[]).map((p) => (
                      <tr key={p.key}>
                        <td>{p.label}</td>
                        <td className="num">{p.bets}</td>
                        <td className="num">{formatPct(p.winRate, 1)}</td>
                        <td
                          className={`num ${p.totalNetProfit > 0 ? "pnl-pos" : p.totalNetProfit < 0 ? "pnl-neg" : ""}`}
                        >
                          {formatGbp(p.totalNetProfit)}
                        </td>
                        <td className="num">{formatPct(p.roi, 1)}</td>
                        <td className="num">{formatPct(p.netAer, 1)}</td>
                        <td className="num muted">{formatPct(p.commissionRate, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.calibrationByPlatform &&
            Object.keys(data.calibrationByPlatform).length > 0 && (
              <div className="backtest-calibration-by-platform" style={{ marginTop: "1.25rem" }}>
                <h4 className="backtest-details-title">Calibration by venue (implied YES bucket)</h4>
                <p className="muted backtest-meta">
                  Bucket uses implied YES probability of the backed side at entry. Hit rate = share of
                  winning bets in each bucket for that venue.
                </p>
                {(data.positionsByPlatform as BacktestPlatformRow[] | undefined)?.map((plat) => {
                  const rows = data.calibrationByPlatform![plat.key] as
                    | BacktestCalibrationBucketRow[]
                    | undefined;
                  if (!rows || rows.length === 0) return null;
                  return (
                    <div key={`cal-${plat.key}`} className="panel" style={{ marginBottom: "0.75rem" }}>
                      <p className="backtest-projection-k" style={{ marginBottom: "0.5rem" }}>
                        {plat.label}
                      </p>
                      <div className="table-wrap">
                        <table className="data-table calibration-table">
                          <thead>
                            <tr>
                              <th>Bucket</th>
                              <th>N</th>
                              <th>Hit rate</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r) => (
                              <tr key={r.priceBucket}>
                                <td>{r.priceBucket}</td>
                                <td className="num">{r.sampleSize}</td>
                                <td className="num">{formatPct(r.hitRate, 1)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          <div className="backtest-details">
            <h4 className="backtest-details-title">Per strategy</h4>
            <ul className="backtest-strategy-list">
              {data.strategies.map((s) => (
                <li key={s.name} className="backtest-strategy-block">
                  <strong>{s.name}</strong>
                  {s.note && (
                    <div className="muted backtest-meta" style={{ marginTop: "0.25rem" }}>
                      {s.note}
                    </div>
                  )}
                  <div className="muted backtest-cat-lines">
                    Best category:{" "}
                    <span className="num">
                      {s.bestCategory ?? "—"}{" "}
                      {s.bestCategory != null
                        ? `(${formatPct(s.byCategory[s.bestCategory]?.roi ?? 0, 1)} ROI)`
                        : ""}
                    </span>
                    <br />
                    Worst category:{" "}
                    <span className="num">
                      {s.worstCategory ?? "—"}{" "}
                      {s.worstCategory != null
                        ? `(${formatPct(s.byCategory[s.worstCategory]?.roi ?? 0, 1)} ROI)`
                        : ""}
                    </span>
                  </div>
                  {s.bestBet && (
                    <div className="muted backtest-bet-line">
                      Best bet: {s.bestBet.question.slice(0, 72)}
                      {s.bestBet.question.length > 72 ? "…" : ""} ·{" "}
                      <span className="pnl-pos">{formatGbp(s.bestBet.profit)}</span>
                    </div>
                  )}
                  {s.worstBet && s.worstBet.loss > 0 && (
                    <div className="muted backtest-bet-line">
                      Worst bet: {s.worstBet.question.slice(0, 72)}
                      {s.worstBet.question.length > 72 ? "…" : ""} · loss{" "}
                      <span className="pnl-neg">{formatGbp(s.worstBet.loss)}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="backtest-projection panel">
            <p className="backtest-projection-k">Hypothetical bankroll</p>
            <p>
              If you had followed <strong>{data.projection.strategyName}</strong> from
              day 1 with {formatGbp(data.projection.startingBankroll, 0)} bankroll
              (same ROI% as backtest, £10 flat stakes scaled to capital): you&apos;d
              have approximately{" "}
              <strong className="pnl-pos">
                {formatGbp(data.projection.endingBankroll, 0)}
              </strong>{" "}
              today.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
