import { useMemo, useState } from "react";
import type { Position } from "../types";
import {
  currentPriceForDirection,
  daysToResolution,
  formatGbp,
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

export default function Portfolio({
  open,
  resolved
}: {
  open: Position[];
  resolved: Position[];
}) {
  const [tab, setTab] = useState<Tab>("open");

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

  return (
    <div className="panel">
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
                open.map((p) => {
                  const cur = currentPriceForDirection(
                    p.direction,
                    p.market_yes_price,
                    p.market_no_price
                  );
                  const uPnL =
                    cur != null
                      ? unrealizedPnl(p.stake, p.entry_price, cur)
                      : null;
                  const uPnLAlt =
                    cur != null && p.entry_price > 0
                      ? p.stake * (cur / p.entry_price - 1)
                      : null;
                  const displayPnl = uPnLAlt ?? uPnL;
                  const daysRem =
                    p.market_end_date != null
                      ? daysToResolution(p.market_end_date)
                      : null;
                  const fav = priceInOurFavour(
                    p.direction,
                    p.entry_price,
                    cur
                  );
                  const rowCls =
                    fav === true
                      ? "portfolio-row--favour"
                      : fav === false
                        ? "portfolio-row--against"
                        : "";

                  return (
                    <tr key={p.id} className={rowCls}>
                      <td className="market-cell">
                        {p.market_question ?? p.market_id}
                      </td>
                      <td className="num">{p.mode}</td>
                      <td className="num">{p.direction}</td>
                      <td className="num">{p.entry_price.toFixed(3)}</td>
                      <td className="num">
                        {cur != null ? cur.toFixed(3) : "ÔÇö"}
                      </td>
                      <td
                        className={`num ${displayPnl != null && displayPnl > 0 ? "pnl-pos" : displayPnl != null && displayPnl < 0 ? "pnl-neg" : ""}`}
                      >
                        {displayPnl != null ? formatGbp(displayPnl) : "ÔÇö"}
                      </td>
                      <td className="num">
                        {daysRem != null ? `${daysRem}d` : "ÔÇö"}
                      </td>
                      <td className="num">
                        {formatGbp(expectedProfitIfCorrect(p.stake, p.entry_price))}
                      </td>
                    </tr>
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
                          className={
                            won ? "outcome-win" : "outcome-loss"
                          }
                        >
                          {won ? "WIN Ô£ô" : "LOSS Ô£ù"}
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
                          : "ÔÇö"}
                      </td>
                      <td>
                        <div className="tag-row">
                          {tags.length === 0 ? (
                            <span className="muted">ÔÇö</span>
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
                    {formatGbp(resolvedSummary.netPnl)} net ┬À{" "}
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
