import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";
import { fetchJson } from "../api";
import { useOpenPositionMarketIds } from "../hooks/useOpenPositionMarketIds";
import type {
  ComparisonPlatformKey,
  LivePlatformComparison,
  LivePlatformPriceColumn,
  PaperPlatformChoice,
  TradingOpportunityRow
} from "../types";
import { formatGbp, formatPct, tagsFromSignals } from "../utils";

const COMPARE_KEYS = [
  "polymarket",
  "betfair",
  "matchbook",
  "smarkets"
] as const;
type CompareKey = (typeof COMPARE_KEYS)[number];

const COMPARE_LABELS: Record<CompareKey, [string, string]> = {
  polymarket: ["PM", "0%"],
  betfair: ["BF", "5%"],
  matchbook: ["MB", "1%"],
  smarkets: ["SM", "2%"]
};

const PAPER_CHOICES: { id: PaperPlatformChoice; label: string }[] = [
  { id: "polymarket", label: "Paper (PM)" },
  { id: "paper-betfair", label: "Paper (BF)" },
  { id: "paper-matchbook", label: "Paper (MB)" },
  { id: "paper-smarkets", label: "Paper (SM)" }
];

function readBankroll(): number {
  try {
    const raw = localStorage.getItem("seer-settings-v1");
    if (!raw) return 200;
    const j = JSON.parse(raw) as { bankroll?: number };
    return typeof j.bankroll === "number" && j.bankroll > 0 ? j.bankroll : 200;
  } catch {
    return 200;
  }
}

function fmtDays(d: number): string {
  return d >= 100 ? `${Math.round(d)}` : d.toFixed(1);
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

function fmtPx(c: LivePlatformComparison | null | undefined, k: CompareKey): string {
  if (!c) return "—";
  const col = c[k];
  const p = col?.price;
  return p != null && Number.isFinite(p) ? p.toFixed(3) : "—";
}

function fmtNetPerPound(
  c: LivePlatformComparison | null | undefined,
  k: CompareKey
): string {
  if (!c) return "—";
  const n = c[k]?.netProfitIfWinPerUnit;
  return n != null && Number.isFinite(n) ? n.toFixed(3) : "—";
}

function stakeNet(
  col: LivePlatformPriceColumn | null | undefined,
  stake: number
): string {
  const per = col?.netProfitIfWinPerUnit;
  if (per == null || !Number.isFinite(per) || !Number.isFinite(stake) || stake <= 0) {
    return "—";
  }
  return formatGbp(per * stake, 2);
}

function bestKey(
  c: LivePlatformComparison | null | undefined
): ComparisonPlatformKey | null {
  return c?.bestPlatform ?? null;
}

function positionsEndpoint(origin?: string): string {
  const base = (origin ?? import.meta.env.VITE_SEER_API_BASE ?? "")
    .toString()
    .trim()
    .replace(/\/$/, "");
  return base ? `${base}/api/positions` : "/api/positions";
}

type CalRow = {
  sampleSize: number;
  priceBucket: string;
  resolutionRate: number;
};

export type TradingOpportunitiesPanelProps = {
  opportunities: TradingOpportunityRow[];
  mode: "paper" | "live";
  onAfterBet: () => void | Promise<void>;
  onSuccess: (msg: string) => void;
  /** Worker origin for POST /api/positions when the UI is not same-origin. */
  positionsApiOrigin?: string;
};

export default function TradingOpportunitiesPanel({
  opportunities,
  mode,
  onAfterBet,
  onSuccess,
  positionsApiOrigin
}: TradingOpportunitiesPanelProps) {
  const bankroll = readBankroll();
  const { placedMarketIds, refetchOpenPositions } =
    useOpenPositionMarketIds(mode);
  const [selected, setSelected] = useState<TradingOpportunityRow | null>(null);
  const [stakeInput, setStakeInput] = useState("");
  const [layerFilter, setLayerFilter] = useState<"all" | "1">("1");
  const [stakePreset, setStakePreset] = useState<"kelly" | "equal">("kelly");
  const [paperChoice, setPaperChoice] = useState<PaperPlatformChoice>("polymarket");
  const [calRows, setCalRows] = useState<CalRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selected) {
      setCalRows(null);
      return;
    }
    let cancelled = false;
    void fetchJson<{ categories?: Record<string, CalRow[]> }>("/api/calibration")
      .then((r) => {
        if (!cancelled) setCalRows(r.categories?.[selected.category] ?? []);
      })
      .catch(() => {
        if (!cancelled) setCalRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const nOpp = Math.max(1, opportunities.length);
  const equalStake = Math.max(1, Math.round(bankroll / nOpp));

  useEffect(() => {
    if (!selected) return;
    const kelly = Math.max(1, Math.round(selected.kellyFraction * bankroll));
    const v =
      stakePreset === "kelly" ? kelly : equalStake;
    setStakeInput(String(v));
  }, [selected, bankroll, stakePreset, equalStake]);

  const filtered = useMemo(() => {
    const rows = opportunities.filter((o) => o.daysToResolution >= 0.5);
    if (layerFilter === "all") return rows;
    return rows.filter((o) => String(o.layer) === "1");
  }, [opportunities, layerFilter]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => b.aer - a.aer),
    [filtered]
  );

  const stakeNum = useMemo(() => {
    const n = Number(String(stakeInput).replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 10;
  }, [stakeInput]);

  const confirmBet = useCallback(async () => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const direction = selected.direction === "NO" ? "NO" : "YES";
      const layerNum =
        parseInt(String(selected.layer).replace(/\D/g, ""), 10) || 2;
      const body = {
        marketId: String(selected.marketId),
        direction,
        stake: stakeNum,
        mode: mode.toLowerCase(),
        layer: layerNum,
        signals: selected.signals ?? [],
        paperPlatform:
          mode.toLowerCase() === "paper" ? paperChoice : undefined
      };
      const res = await fetch(positionsEndpoint(positionsApiOrigin), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      let payload: { ok?: boolean; message?: string; error?: string } = {};
      try {
        payload = (await res.json()) as typeof payload;
      } catch {
        payload = {};
      }
      if (payload.ok === true) {
        const q =
          selected.question.length > 90
            ? `${selected.question.slice(0, 90)}…`
            : selected.question;
        onSuccess(`Bet placed: ${q}`);
        void onAfterBet();
        await refetchOpenPositions();
        setSelected(null);
      } else {
        const msg =
          typeof payload.message === "string"
            ? payload.message
            : typeof payload.error === "string"
              ? payload.error
              : JSON.stringify(payload);
        window.alert(`Bet failed: ${msg}`);
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [
    selected,
    busy,
    stakeNum,
    mode,
    paperChoice,
    positionsApiOrigin,
    onAfterBet,
    onSuccess,
    refetchOpenPositions
  ]);

  const c = selected?.platformComparison;
  const best = bestKey(c);

  return (
    <Fragment>
      <div className="panel">
        <div className="opp-filter-bar" role="toolbar" aria-label="Layer filter">
          <button
            type="button"
            className={`opp-filter-chip ${layerFilter === "1" ? "is-active" : ""}`}
            onClick={() => setLayerFilter("1")}
          >
            Layer 1
          </button>
          <button
            type="button"
            className={`opp-filter-chip ${layerFilter === "all" ? "is-active" : ""}`}
            onClick={() => setLayerFilter("all")}
          >
            All layers
          </button>
        </div>

        <div className="table-wrap opp-desktop-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Market</th>
                <th>Layer</th>
                <th>Dir</th>
                <th>Price</th>
                <th>Days</th>
                <th>AER</th>
                <th>Signals</th>
                <th>Bet</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty">
                    No opportunities match this filter.
                  </td>
                </tr>
              ) : (
                sorted.map((o) => (
                  <tr key={`${o.marketId}-${o.direction}-${o.computedAt}`}>
                    <td className="market-cell">
                      <div className="market-cell-row">
                        <span>{o.question}</span>
                        {placedMarketIds.has(String(o.marketId)) ? (
                          <PlacedBadge />
                        ) : null}
                      </div>
                    </td>
                    <td className="layer-cell">L{o.layer}</td>
                    <td className="num">{o.direction}</td>
                    <td className="num">{(o.currentPrice * 100).toFixed(1)}%</td>
                    <td className="num">{fmtDays(o.daysToResolution)}</td>
                    <td className="num">{formatPct(o.aer, 1)}</td>
                    <td>
                      <div className="tag-row">
                        {tagsFromSignals(o.signals).map((t) => (
                          <span key={t} className="signal-tag">
                            [{t}]
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`btn-bet ${mode}`}
                        onClick={() => {
                          setStakePreset("kelly");
                          setPaperChoice("polymarket");
                          setSelected(o);
                        }}
                      >
                        Bet
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div
          className="modal-backdrop modal-backdrop--bet"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <div
            className="modal modal--bet"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="modal-bet-close"
              onClick={() => setSelected(null)}
              aria-label="Close"
            >
              ✕
            </button>
            <h3 className="modal-bet-title">{selected.question}</h3>

            {mode === "paper" && (
              <div className="paper-venue-bar panel" style={{ marginBottom: "0.75rem" }}>
                <p className="why-seer-sub">Paper venue (entry price)</p>
                <div className="opp-filter-bar" role="radiogroup" aria-label="Paper venue">
                  {PAPER_CHOICES.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`opp-filter-chip ${paperChoice === p.id ? "is-active" : ""}`}
                      onClick={() => setPaperChoice(p.id)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.35rem" }}>
                  Paper (PM) uses Polymarket corpus prices (research). Paper (BF/MB/SM) snapshots the
                  live matched exchange price for the fuzzy-matched market; P&amp;L uses that entry
                  and the venue commission on winnings.
                </p>
              </div>
            )}

            <div className="panel" style={{ marginBottom: "0.75rem" }}>
              <p className="why-seer-sub">Expected profit if you win (after commission)</p>
              <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "0.5rem" }}>
                Using stake £{stakeNum.toFixed(2)} — compare venues side by side.
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: "0.35rem"
                }}
              >
                {COMPARE_KEYS.map((k) => {
                  const [label, fee] = COMPARE_LABELS[k];
                  const col = c?.[k];
                  return (
                    <div
                      key={k}
                      className={`live-compare-cell ${best === k ? "is-best" : ""}`}
                      style={{ padding: "0.35rem" }}
                    >
                      <div className="live-compare-plat">
                        {label} <span className="muted">({fee})</span>
                      </div>
                      <div className="live-compare-p">p={fmtPx(c, k)}</div>
                      <div className="live-compare-net">+{fmtNetPerPound(c, k)} / £1</div>
                      <div className="muted" style={{ fontSize: "0.75rem" }}>
                        → {stakeNet(col, stakeNum)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <dl>
              <div>
                <dt>Direction</dt>
                <dd>{selected.direction}</dd>
              </div>
              <div>
                <dt>Stake (£)</dt>
                <dd>
                  <div className="stake-preset-toggles" role="radiogroup">
                    <label className="stake-preset-label">
                      <input
                        type="radio"
                        name="stake-preset-tr"
                        checked={stakePreset === "kelly"}
                        onChange={() => setStakePreset("kelly")}
                      />
                      Kelly
                    </label>
                    <label className="stake-preset-label">
                      <input
                        type="radio"
                        name="stake-preset-tr"
                        checked={stakePreset === "equal"}
                        onChange={() => setStakePreset("equal")}
                      />
                      Equal split
                    </label>
                  </div>
                  <input
                    id="tr-stake"
                    type="text"
                    inputMode="decimal"
                    value={stakeInput}
                    onChange={(e) => setStakeInput(e.target.value)}
                    style={{ marginTop: "0.35rem", width: "100%" }}
                  />
                </dd>
              </div>
            </dl>

            {calRows && calRows.length > 0 && (
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                Calibration rows loaded for category &quot;{selected.category}&quot; ({calRows.length}{" "}
                buckets).
              </p>
            )}

            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setSelected(null)}>
                Skip
              </button>
              <button type="button" disabled={busy} onClick={() => void confirmBet()}>
                {busy ? "…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Fragment>
  );
}
