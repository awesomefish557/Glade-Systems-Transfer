import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { fetchJson } from "../api";
import type { CalibrationBucketRow, CalibrationResponse } from "../types";

type FlatRow = { category: string } & CalibrationBucketRow;

function bucketMidpointFraction(bucket: string): number | null {
  const m = /^(\d+)-(\d+)%$/.exec(bucket.trim());
  if (!m) return null;
  return (Number(m[1]) + Number(m[2])) / 200;
}

function bucketOrderKey(bucket: string): number {
  const m = /^(\d+)-/.exec(bucket.trim());
  return m ? Number(m[1]) : 999;
}

export default function CalibrationPanel() {
  const [data, setData] = useState<CalibrationResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const c = await fetchJson<CalibrationResponse>("/api/calibration");
        if (!cancelled) setData(c);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    if (!data?.categories) return [];
    const out: FlatRow[] = [];
    for (const [category, buckets] of Object.entries(data.categories)) {
      for (const b of buckets) {
        out.push({ category, ...b });
      }
    }
    return out.sort((a, b) => {
      const c = a.category.localeCompare(b.category);
      return c !== 0 ? c : a.priceBucket.localeCompare(b.priceBucket);
    });
  }, [data]);

  const summary = useMemo(() => {
    const categories = new Set(rows.map((r) => r.category));
    let totalSamples = 0;
    const byBucket = new Map<
      string,
      { n: number; yesWeighted: number }
    >();
    for (const r of rows) {
      totalSamples += r.sampleSize;
      const agg = byBucket.get(r.priceBucket) ?? { n: 0, yesWeighted: 0 };
      agg.n += r.sampleSize;
      agg.yesWeighted += r.resolutionRate * r.sampleSize;
      byBucket.set(r.priceBucket, agg);
    }
    const b90100 = byBucket.get("90-100%");
    const rate90100 =
      b90100 && b90100.n > 0 ? b90100.yesWeighted / b90100.n : null;
    const implied90100 = 0.95;
    const edge90100 =
      rate90100 != null ? (rate90100 - implied90100) * 100 : null;
    return {
      totalSamples,
      categoryCount: categories.size,
      rate90100,
      implied90100,
      edge90100
    };
  }, [rows]);

  const chartData = useMemo(() => {
    const byBucket = new Map<
      string,
      { n: number; yesWeighted: number }
    >();
    for (const r of rows) {
      const agg = byBucket.get(r.priceBucket) ?? { n: 0, yesWeighted: 0 };
      agg.n += r.sampleSize;
      agg.yesWeighted += r.resolutionRate * r.sampleSize;
      byBucket.set(r.priceBucket, agg);
    }
    const buckets = [...byBucket.keys()].sort(
      (a, b) => bucketOrderKey(a) - bucketOrderKey(b)
    );
    return buckets.map((bucket) => {
      const agg = byBucket.get(bucket)!;
      const resPct =
        agg.n > 0 ? (agg.yesWeighted / agg.n) * 100 : 0;
      const mid = bucketMidpointFraction(bucket);
      const impliedPct = mid != null ? mid * 100 : 0;
      return {
        bucket,
        resolutionPct: Math.round(resPct * 10) / 10,
        impliedPct: Math.round(impliedPct * 10) / 10
      };
    });
  }, [rows]);

  if (loading) {
    return <div className="loading">Loading calibrationÔÇª</div>;
  }
  if (err) {
    return <div className="error-banner">{err}</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="panel muted" style={{ padding: "1rem" }}>
        No calibration rows yet. Run the worker pipeline or POST{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>
          /admin/rebuild-calibration
        </code>
        .
      </div>
    );
  }

  return (
    <div className="panel calibration-panel">
      <p className="calibration-summary-top">
        Seer has analysed{" "}
        <strong>{summary.totalSamples.toLocaleString()}</strong> resolved
        market bucket samples across{" "}
        <strong>{summary.categoryCount}</strong> categor
        {summary.categoryCount === 1 ? "y" : "ies"}. Markets priced 90ÔÇô100%
        (implied YES) resolved YES{" "}
        <strong>
          {summary.rate90100 != null
            ? `${(summary.rate90100 * 100).toFixed(1)}%`
            : "ÔÇö"}
        </strong>{" "}
        of the time vs market implied{" "}
        <strong>{(summary.implied90100 * 100).toFixed(0)}%</strong>
        {summary.edge90100 != null ? (
          <>
            . Edge:{" "}
            <strong>
              {summary.edge90100 >= 0 ? "+" : ""}
              {summary.edge90100.toFixed(1)} percentage points
            </strong>
            .
          </>
        ) : (
          "."
        )}
      </p>
      <p className="calibration-intro muted">
        Historical resolution rates by category and implied YES price bucket
        (basis for Seer&apos;s calibrated probabilities).
      </p>
      <div className="table-wrap">
        <table className="data-table calibration-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Price range</th>
              <th>Sample size</th>
              <th>Historical resolution rate</th>
              <th>Edge vs mid-bucket</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const mid = bucketMidpointFraction(r.priceBucket);
              const histPct = r.resolutionRate * 100;
              const edge =
                mid != null ? r.resolutionRate - mid : null;
              const edgePct = edge != null ? edge * 100 : null;
              const rowClass =
                edgePct != null && edgePct > 1
                  ? "cal-row-edge-pos"
                  : edgePct != null && edgePct < -1
                    ? "cal-row-edge-neg"
                    : "";
              const lowN = r.sampleSize < 20;
              return (
                <tr key={`${r.category}-${r.priceBucket}`} className={rowClass}>
                  <td>{r.category}</td>
                  <td className="num">
                    {r.priceBucket} (implied YES)
                    {lowN ? (
                      <span
                        className="cal-sample-warn"
                        title="Small sample ÔÇö interpret with care"
                      >
                        {" "}
                        ÔÜá
                      </span>
                    ) : null}
                  </td>
                  <td className="num">{r.sampleSize}</td>
                  <td className="num">{histPct.toFixed(1)}% resolved YES</td>
                  <td className="num">
                    {edgePct != null
                      ? `${edgePct >= 0 ? "+" : ""}${edgePct.toFixed(1)}% vs mid`
                      : "ÔÇö"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="cal-chart-wrap">
        <p className="cal-chart-title">Resolution vs market implied by bucket</p>
        <div className="cal-chart-inner">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={chartData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3d56" />
              <XAxis
                dataKey="bucket"
                tick={{ fill: "#7a8aa3", fontSize: 10 }}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: "#7a8aa3", fontSize: 10 }}
                label={{
                  value: "%",
                  angle: -90,
                  position: "insideLeft",
                  fill: "#7a8aa3",
                  fontSize: 10
                }}
              />
              <Tooltip
                contentStyle={{
                  background: "#111826",
                  border: "1px solid #2a3d56",
                  fontSize: 12
                }}
                formatter={(value: number, name: string) => [
                  `${value}%`,
                  name === "resolutionPct"
                    ? "Resolved YES %"
                    : "Mid-bucket implied %"
                ]}
              />
              <Legend />
              <Bar
                dataKey="resolutionPct"
                name="Historical YES %"
                fill="#3dd6e0"
                radius={[2, 2, 0, 0]}
              />
              <Bar
                dataKey="impliedPct"
                name="Bucket mid (implied)"
                fill="#4d5d75"
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
