import { Fragment, useMemo, useState } from "react";
import type { PortfolioStats, Position } from "../types";
import {
  currentPriceForDirection,
  daysToResolution,
  formatGbp,
  formatPct,
  tagsFromSignals,
  unrealizedPnl
} from "../utils";

type Tab = "open" | "resolved";

function parseStoredSignals(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function priceInOurFavour(
  _direction: string,
  entry: number,
  cur: number | null
): boolean | null {
  if (cur == null || entry <= 0) return null;
  return cur > entry;
}

function expectedProfitIfCorrect(stake: number, entry: number): number {
  if (entry <= 0) return 0;
  return stake * (1 / entry - 1);
}

function inferMarketGroup(label: string): string {
  const s = label.toLowerCase();
  if (/\bmasters\b|\bpga\b|\bgolf\b/i.test(s)) return "Golf";
  if (/\bnba\b/i.test(s)) return "NBA";
  if (/\bnhl\b/i.test(s)) return "NHL";
  if (/\bnfl\b/i.test(s)) return "NFL";
  if (/\btennis\b|\batp\b|\bwta\b/i.test(s)) return "Tennis";
  if (
    /politic|election|trump|biden|senate|congress|democrat|republican/i.test(s)
  ) {
    return "Politics";
  }
  return "Other";
}

function unrealizedForPosition(p: Position): number | null {
  const cur = currentPriceForDirection(
    p.direction,
    p.market_yes_price,
    p.market_no_price
  );
  if (cur == null || p.entry_price <= 0) return null;
  const uPnLAlt = p.stake * (cur / p.entry_price - 1);
  const uPnL = unrealizedPnl(p.stake, p.entry_price, cur);
  return uPnLAlt ?? uPnL;
}

export default function Portfolio({
  open,
  resolved,
  stats
}: {
  open: Position[];
  resolved: Position[];
  stats?: PortfolioStats | null;
}) {
  const [tab, setTab] = useState<Tab>("open");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const resolvedSummary = useMemo(() => {
    let totalStaked = 0;
    let totalReturned = 0;
    let netPnl = 0;
    let wins = 0;
    for (const p of resolved) {
      totalStaked += p.stake;
      const pl = p.profit_loss ?? 0;
      netPnl += pl;
      totalReturned += p.stake + pl;
      if (pl > 0) wins += 1;
    }
    const n = resolved.length;
    const wr = n > 0 ? (wins / n) * 100 : 0;
    return { totalStaked, totalReturned, netPnl, wins, n, wr };
  }, [resolved]);

  const openMetrics = useMemo(() => {
    let atRisk = 0;
    let expWin = 0;
    let unrl = 0;
    for (const p of open) {
      atRisk += p.stake;
      expWin += expectedProfitIfCorrect(p.stake, p.entry_price);
      const u = unrealizedForPosition(p);
      if (u != null) unrl += u;
    }
    const breakEven =
      expWin > 0 && atRisk + expWin > 0 ? atRisk / (atRisk + expWin) : null;
    return { atRisk, expWin, unrl, breakEven };
  }, [open]);

  const groupedOpen = useMemo(() => {
    const m = new Map<string, Position[]>();
    for (const p of open) {
      const g = inferMarketGroup(p.market_question ?? p.market_id);
      const arr = m.get(g) ?? [];
      arr.push(p);
      m.set(g, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [open]);

  const groupUnrealized = useMemo(() => {
    const r = new Map<string, number>();
    for (const [g, rows] of groupedOpen) {
      let s = 0;
      for (const p of rows) {
        const u = unrealizedForPosition(p);
        if (u != null) s += u;
      }
      r.set(g, s);
    }
    return r;
  }, [groupedOpen]);

  function toggleGroup(g: string) {
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });
  }

  const blended = stats?.liveAerBlended;
  const target = stats?.backtestStrategyBTarget ?? 0.474;
  const trend = stats?.liveAerTrend;
  const avgHold = stats?.avgHoldDaysClosed;

  function renderOpenRow(p: Position) {
    const cur = currentPriceForDirection(
      p.direction,
      p.market_yes_price,
      p.market_no_price
    );
    const uPnL =
      cur != null ? unrealizedPnl(p.stake, p.entry_price, cur) : null;
    const uPnLAlt =
      cur != null && p.entry_price > 0
        ? p.stake * (cur / p.entry_price - 1)
        : null;
    const displayPnl = uPnLAlt ?? uPnL;
    const daysRem =
      p.market_end_date != null
        ? daysToResolution(p.market_end_date)
        : null;
    const fav = priceInOurFavour(p.direction, p.entry_price, cur);
    const rowCls =
      fav === true
        ? "portfolio-row--favour"
        : fav === false
          ? "portfolio-row--against"
          : "";

    return (
      <tr key={p.id} className={rowCls}>
        <td className="market-cell">{p.market_question ?? p.market_id}</td>
        <td className="num">{p.mode}</td>
        <td className="num">{p.direction}</td>
        <td className="num">{p.entry_price.toFixed(3)}</td>
        <td className="num">{cur != null ? cur.toFixed(3) : "—"}</td>
        <td
          className={`num ${displayPnl != null && displayPnl > 0 ? "pnl-pos" : displayPnl != null && displayPnl < 0 ? "pnl-neg" : ""}`}
        >
          {displayPnl != null ? formatGbp(displayPnl) : "—"}
        </td>
        <td className="num">{daysRem != null ? `${daysRem}d` : "—"}</td>
        <td className="num">
          {formatGbp(expectedProfitIfCorrect(p.stake, p.entry_price))}
        </td>
      </tr>
    );
  }

  return (
    <div className="panel">
      {stats != null &&
        (blended != null ||
          stats.aerSinceLaunch != null ||
          trend != null) && (
          <div className="portfolio-live-aer-block panel">
            <div className="section-label">Live AER (realised, hold-weighted)</div>
            <p className="portfolio-live-aer-main">
              {blended != null && Number.isFinite(blended) ? (
                <>
                  <strong>{formatPct(blended, 2)}</strong> annualised from closed
                  positions
                  {avgHold != null && avgHold > 0 ? (
                    <span className="muted">
                      {" "}
                      (avg hold {avgHold.toFixed(0)}d, formula:{" "}
                      <code className="muted">(1 + P/L/S)^(365/h) − 1</code>)
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="muted">Not enough closed data yet.</span>
              )}
            </p>
            <p className="muted portfolio-live-aer-sub">
              Per-position mean AER: {formatPct(stats.aerSinceLaunch, 2)} ·
              Backtest Strategy B target: {formatPct(target, 2)}
              {trend ? (
                <>
                  {" "}
                  · Trend:{" "}
                  <strong
                    className={
                      trend === "improving"
                        ? "pnl-pos"
                        : trend === "declining"
                          ? "pnl-neg"
                          : ""
                    }
                  >
                    {trend}
                  </strong>
                </>
              ) : null}
            </p>
          </div>
        )}

      {open.length > 0 && (
        <div className="portfolio-summary-bar">
          <div>
            <span className="portfolio-summary-k">Total at risk</span>
            <span className="portfolio-summary-v">
              {formatGbp(openMetrics.atRisk, 0)}
            </span>
          </div>
          <div>
            <span className="portfolio-summary-k">If all win</span>
            <span className="portfolio-summary-v pnl-pos">
              +{formatGbp(openMetrics.expWin, 0)}
            </span>
          </div>
          <div>
            <span className="portfolio-summary-k">Unrealised P&amp;L</span>
            <span
              className={`portfolio-summary-v ${openMetrics.unrl >= 0 ? "pnl-pos" : "pnl-neg"}`}
            >
              {formatGbp(openMetrics.unrl, 0)}
            </span>
          </div>
          <div>
            <span className="portfolio-summary-k">Break-even win rate (approx.)</span>
            <span className="portfolio-summary-v">
              {openMetrics.breakEven != null
                ? formatPct(openMetrics.breakEven, 1)
                : "—"}
            </span>
          </div>
        </div>
      )}

      <div className="tabs portfolio-tabs-scroll">
        <button
          type="button"
          className={tab === "open" ? "active" : ""}
          onClick={() => setTab("open")}
        >
          Open positions
        </button>
        <button
          type="button"
          className={tab === "resolved" ? "active" : ""}
          onClick={() => setTab("resolved")}
        >
          Resolved
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            {tab === "open" ? (
              <tr>
                <th>Market</th>
                <th>Mode</th>
                <th>Dir</th>
                <th>Entry</th>
                <th>Now</th>
                <th>Unrealised</th>
                <th>Days</th>
                <th>If correct</th>
              </tr>
            ) : (
              <tr>
                <th>Outcome</th>
                <th>Market</th>
                <th>Mode</th>
                <th>Dir</th>
                <th>Stake</th>
                <th>P&amp;L</th>
                <th>Signals &amp; accuracy</th>
              </tr>
            )}
          </thead>
          <tbody>
            {tab === "open" ? (
              open.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty">
                    No open positions. Place your first paper bet!
                  </td>
                </tr>
              ) : (
                groupedOpen.map(([group, rows]) => {
                  const gu = groupUnrealized.get(group) ?? 0;
                  const isCollapsed = collapsed.has(group);
                  return (
                    <Fragment key={group}>
                      <tr className="portfolio-group-row">
                        <td colSpan={8}>
                          <button
                            type="button"
                            className="portfolio-group-toggle"
                            onClick={() => toggleGroup(group)}
                          >
                            {isCollapsed ? "▶" : "▼"} {group} · {rows.length}{" "}
                            pos · Unrl {formatGbp(gu, 0)}
                          </button>
                        </td>
                      </tr>
                      {!isCollapsed ? rows.map((p) => renderOpenRow(p)) : null}
                    </Fragment>
                  );
                })
              )
            ) : resolved.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  No resolved positions yet. Check back after markets close.
                </td>
              </tr>
            ) : (
              <>
                {resolved.map((p) => {
                  const won = (p.profit_loss ?? 0) > 0;
                  const sigs = parseStoredSignals(p.signals_json);
                  const tags = tagsFromSignals(sigs);
                  const rightCall = won;
                  return (
                    <tr key={p.id}>
                      <td className="portfolio-outcome-cell">
                        <span
                          className={won ? "outcome-win" : "outcome-loss"}
                        >
                          {won ? "WIN ✓" : "LOSS ✗"}
                        </span>
                      </td>
                      <td className="market-cell">
                        {p.market_question ?? p.market_id}
                      </td>
                      <td className="num">{p.mode}</td>
                      <td className="num">{p.direction}</td>
                      <td className="num">{formatGbp(p.stake, 0)}</td>
                      <td
                        className={`num ${won ? "pnl-pos" : "pnl-neg"}`}
                      >
                        {p.profit_loss != null
                          ? formatGbp(p.profit_loss)
                          : "—"}
                      </td>
                      <td>
                        <div className="tag-row">
                          {tags.length === 0 ? (
                            <span className="muted">—</span>
                          ) : (
                            tags.map((t) => (
                              <span key={t} className="signal-tag">
                                [{t}]
                              </span>
                            ))
                          )}
                        </div>
                        <div className="muted portfolio-accuracy">
                          Signal accuracy:{" "}
                          <strong
                            className={
                              rightCall ? "accuracy-yes" : "accuracy-no"
                            }
                          >
                            {rightCall
                              ? "Seer was right on this one"
                              : "Seer was wrong on this one"}
                          </strong>
                          {p.market_resolution_outcome ? (
                            <span>
                              {" "}
                              (market: {p.market_resolution_outcome})
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                <tr className="portfolio-summary-row">
                  <td colSpan={4} className="num">
                    <strong>Summary</strong>
                  </td>
                  <td className="num">
                    {formatGbp(resolvedSummary.totalStaked, 0)} staked
                  </td>
                  <td className="num">
                    {formatGbp(resolvedSummary.netPnl)} net ·{" "}
                    {formatGbp(resolvedSummary.totalReturned, 0)} returned
                  </td>
                  <td className="num">
                    Win rate {resolvedSummary.wins}/{resolvedSummary.n} (
                    {resolvedSummary.wr.toFixed(0)}%)
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
