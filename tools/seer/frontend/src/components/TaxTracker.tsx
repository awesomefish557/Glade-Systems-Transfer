import { useMemo } from "react";
import type { Position } from "../types";
import { apiHeaders, apiUrl } from "../api";
import { formatGbp, parseDbDate, ukTaxYearBoundsUTC } from "../utils";
import { formatSwFractionLabel } from "../utils/supermarketWeeks";

export default function TaxTracker({
  resolved,
  hmrcAnnualProfit,
  thresholdWarning
}: {
  resolved: Position[];
  hmrcAnnualProfit: number;
  thresholdWarning: boolean;
}) {
  const { start, end } = ukTaxYearBoundsUTC(new Date());
  const startMs = start.getTime();
  const endMs = end.getTime();

  const rows = useMemo(() => {
    return resolved.filter((p) => {
      const rt = parseDbDate(p.resolved_at);
      if (rt == null) return false;
      return rt >= startMs && rt <= endMs;
    });
  }, [resolved, startMs, endMs]);

  const total = rows.reduce((s, p) => s + (p.profit_loss ?? 0), 0);

  const showHmrcAmber = hmrcAnnualProfit >= 500 && hmrcAnnualProfit < 800;
  const showHmrcRed = hmrcAnnualProfit >= 800;
  const showRollingWarn = thresholdWarning;

  async function downloadCsv() {
    const res = await fetch(apiUrl("/api/tax/export"), {
      headers: apiHeaders(false)
    });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "seer-tax-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="panel">
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          padding: "0.65rem 0.75rem",
          borderBottom: "1px solid var(--border)"
        }}
      >
        <div>
          <span className="section-label" style={{ marginBottom: 0 }}>
            Tax year (UK)
          </span>
          <div
            className="muted"
            style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}
          >
            {start.toISOString().slice(0, 10)} ÔåÆ {end.toISOString().slice(0, 10)}
          </div>
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => void downloadCsv()}
        >
          Download CSV
        </button>
      </div>

      {(showHmrcRed || showHmrcAmber || showRollingWarn) && (
        <div className={showHmrcRed || showRollingWarn ? "tax-warn critical" : "tax-warn"}>
          {showHmrcRed
            ? "HMRC tracker ÔÇö red: tax-year profit is ┬ú800+ (approaching the ┬ú1,000 trading allowance)."
            : showHmrcAmber
              ? "HMRC tracker ÔÇö amber: tax-year profit is ┬ú500ÔÇô┬ú800; keep allowance headroom in view."
              : "Rolling 365-day P&L has hit the ┬ú1,000 warning threshold from your worker stats."}
        </div>
      )}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Resolved</th>
              <th>Market</th>
              <th>Dir</th>
              <th>Stake</th>
              <th>Profit</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  No resolved positions in this tax year.
                </td>
              </tr>
            ) : (
              rows.map((p) => (
                <tr key={p.id}>
                  <td className="num">
                    {(p.resolved_at ?? "").replace("T", " ").slice(0, 16)}
                  </td>
                  <td className="market-cell">
                    {p.market_question ?? p.market_id}
                  </td>
                  <td className="num">{p.direction}</td>
                  <td className="num">{formatGbp(p.stake, 0)}</td>
                  <td className="num">
                    {p.profit_loss != null ? formatGbp(p.profit_loss) : "ÔÇö"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.78rem",
            padding: "0.65rem 0.75rem",
            borderTop: "1px solid var(--border-strong)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: "0.35rem"
          }}
        >
          <span className="stat-k">Running total (tax year)</span>
          <span className="stat-v" style={{ textAlign: "right" }}>
            {formatGbp(total)}
            <span className="muted" style={{ fontSize: "0.75rem" }}>
              {" "}
              ·{" "}
            </span>
            <span
              style={{
                fontSize: "0.75rem",
                color: total > 0 ? "#d4a853" : "var(--text-muted)"
              }}
            >
              {formatSwFractionLabel(total)} SW
            </span>
            <span className="muted" style={{ fontSize: "0.75rem" }}>
              {" "}
              toward £1,000 allowance
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
