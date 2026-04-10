import { useEffect, useMemo, useState } from "react";
import { apiHeaders, apiUrl, fetchJson } from "../api";
import { useOpenPositionMarketIds } from "../hooks/useOpenPositionMarketIds";
import { useSeerSettings } from "../settingsContext";
import type {
  CalibrationBucketRow,
  CalibrationResponse,
  Opportunity,
  TradeMode
} from "../types";
import type { PreferredPlatform, SeerSettings } from "../settingsContext";
import {
  computeTieredStakeMeta,
  formatGbp,
  formatPct,
  isPoliticsLikeMarket,
  tagsFromSignals,
  tieredStakeClass
} from "../utils";
import { AerHoldDisplay } from "./AerHoldDisplay";

const LAYER_TITLES: Record<string, string> = {
  "1": "Layer 1: Near Certainty",
  "2": "Layer 2: Behavioural Pattern",
  "3": "Layer 3: High Risk / High Reward"
};

const SIGNAL_EXPLANATIONS: Record<string, string> = {
  NEAR_CERT: "Market priced >90% — historically reliable",
  EXTREME: "Market priced >85% with strong AER",
  ANCHOR: "Price near round number ÔÇö possible mispricing",
  RECENCY: "Price moved >15% in 48hrs ÔÇö potential overcorrection",
  COMPOUND: "3+ signals active ÔÇö stronger conviction"
};

const SIGNAL_ORDER = [
  "NEAR_CERT",
  "EXTREME",
  "ANCHOR",
  "RECENCY",
  "COMPOUND"
] as const;

function impliedYesForOpportunity(o: Opportunity): number {
  return o.direction === "YES" ? o.currentPrice : 1 - o.currentPrice;
}

function yesImpliedToBucketLabel(impliedYes: number): string | null {
  if (Number.isNaN(impliedYes)) return null;
  const p = Math.max(0, Math.min(1, impliedYes));
  const idx = Math.min(9, Math.floor(p * 10));
  const low = idx * 10;
  return `${low}-${low + 10}%`;
}

function collectExplanationTags(signals: string[]): string[] {
  const tagSet = new Set<string>();
  for (const t of tagsFromSignals(signals)) {
    if (SIGNAL_EXPLANATIONS[t]) tagSet.add(t);
  }
  const upper = signals.join(" | ").toUpperCase();
  for (const key of Object.keys(SIGNAL_EXPLANATIONS)) {
    if (upper.includes(key)) tagSet.add(key);
  }
  const ranked: string[] = [];
  for (const k of SIGNAL_ORDER) {
    if (tagSet.has(k)) ranked.push(k);
  }
  for (const k of tagSet) {
    if (!ranked.includes(k)) ranked.push(k);
  }
  return ranked;
}

type TableFilter =
  | "all"
  | "l1"
  | "l2"
  | "l3"
  | "highAer"
  | "short14";

type SortKey = "aer" | "days" | "score" | "layer" | "price" | "confidence" | "stake";
type SortDir = "asc" | "desc";

type StakePreset = "kelly" | "equal";

function normalizeBetDirection(d: string): "YES" | "NO" | null {
  const u = String(d).trim().toUpperCase();
  if (u === "YES" || u === "NO") return u;
  return null;
}

function defaultSortDir(key: SortKey): SortDir {
  switch (key) {
    case "days":
      return "asc";
    case "layer":
      return "asc";
    case "confidence":
      return "desc";
    case "stake":
      return "desc";
    default:
      return "desc";
  }
}

function compareOpportunities(
  a: Opportunity,
  b: Opportunity,
  key: SortKey,
  dir: SortDir
): number {
  const mult = dir === "asc" ? 1 : -1;
  switch (key) {
    case "aer":
      return mult * (a.aer - b.aer);
    case "days":
      return mult * (a.daysToResolution - b.daysToResolution);
    case "score":
      return mult * (a.psychologyScore - b.psychologyScore);
    case "layer": {
      const na = Number(a.layer) || 0;
      const nb = Number(b.layer) || 0;
      return mult * (na - nb);
    }
    case "price":
      return mult * (a.currentPrice - b.currentPrice);
    case "confidence":
      return mult * (a.currentPrice - b.currentPrice);
    case "stake": {
      const fa = computeTieredStakeMeta(a).fraction;
      const fb = computeTieredStakeMeta(b).fraction;
      return mult * (fa - fb);
    }
    default:
      return 0;
  }
}

function layerBadge(layer: string) {
  const L = layer === "1" || layer === "2" || layer === "3" ? layer : "?";
  const cls =
    L === "1" ? "badge-l1" : L === "2" ? "badge-l2" : "badge-l3";
  const title = LAYER_TITLES[L] ?? "Layer";
  return (
    <span
      className={`badge-layer badge-layer--prominent ${cls}`}
      title={title}
    >
      L{L}
    </span>
  );
}

function ScoreDots({
  layer,
  psychologyScore
}: {
  layer: string;
  psychologyScore: number;
}) {
  const filled = Math.min(5, Math.max(0, Math.round(psychologyScore / 2)));
  const tier =
    layer === "1" ? "dots--tier1" : layer === "3" ? "dots--tier3" : "dots--tier2";
  return (
    <span
      className={`dots ${tier}`}
      aria-label={`Psychology ${filled} of 5 dots`}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < filled ? "on" : ""}>
          {i < filled ? "ÔùÅ" : "Ôùï"}
        </span>
      ))}
    </span>
  );
}

function rowLayerClass(layer: string): string {
  if (layer === "1") return "row-layer-1";
  if (layer === "3") return "row-layer-3";
  return "row-layer-2";
}

function fmtPrice(p: number): string {
  return p.toFixed(3);
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

function TieredStakeLine({
  bankroll,
  o
}: {
  bankroll: number;
  o: Opportunity;
}) {
  const { fraction, tier } = computeTieredStakeMeta(o);
  const amount = Math.max(0, Math.round(bankroll * fraction));
  return (
    <span className={tieredStakeClass(tier)}>
      {formatGbp(amount, 0)} — Tier {tier}
    </span>
  );
}

function OpenPositionPill({ o }: { o: Opportunity }) {
  if (!o.hasOpenPosition) return null;
  const dir = o.openPositionDirection;
  const want = String(o.direction).toUpperCase() === "NO" ? "NO" : "YES";
  if (dir == null) {
    return <span className="opp-placed-badge">● Placed</span>;
  }
  const match = dir === want;
  return (
    <span
      className={`opp-placed-badge ${match ? "opp-placed--match" : "opp-placed--warn"}`}
      title={match ? "Open on same side" : "Open on opposite side"}
    >
      {match ? "● Placed ✓" : "● Placed (other side) ⚠"}
    </span>
  );
}

function passesAdvancedFilters(
  o: Opportunity,
  opts: {
    maxDaysCap: number;
    minConfBar: number;
    tierBar: "all" | "t1" | "t12";
    layerBar: "all" | "l1" | "l12";
    settings: SeerSettings;
  }
): boolean {
  if (o.aer < opts.settings.minAerPercent / 100) return false;
  if (
    opts.settings.maxDays < 9990 &&
    o.daysToResolution > opts.settings.maxDays
  ) {
    return false;
  }
  if (
    !opts.settings.showPolitics &&
    isPoliticsLikeMarket(o.category, o.question)
  ) {
    return false;
  }
  if (opts.maxDaysCap < 9990 && o.daysToResolution > opts.maxDaysCap) {
    return false;
  }
  if (o.currentPrice < opts.minConfBar) return false;
  const tier = computeTieredStakeMeta(o).tier;
  if (opts.tierBar === "t1" && tier !== 1) return false;
  if (opts.tierBar === "t12" && tier !== 1 && tier !== 2) return false;
  const L = String(o.layer);
  if (opts.layerBar === "l1" && L !== "1") return false;
  if (opts.layerBar === "l12" && L !== "1" && L !== "2") return false;
  return true;
}

const FILTER_CHIPS: { id: TableFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "l1", label: "L1" },
  { id: "l2", label: "L2" },
  { id: "l3", label: "L3" },
  { id: "short14", label: "<14 days" },
  { id: "highAer", label: ">100% AER" }
];

function passesFilter(o: Opportunity, f: TableFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "l1":
      return o.layer === "1";
    case "l2":
      return o.layer === "2";
    case "l3":
      return o.layer === "3";
    case "highAer":
      return o.aer > 1;
    case "short14":
      return o.daysToResolution < 14;
    default:
      return true;
  }
}

function SortTh({
  label,
  sortKey,
  activeKey,
  sortDir,
  onSort
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = activeKey === sortKey;
  const arrow = sortDir === "asc" ? "Ôåæ" : "Ôåô";
  return (
    <th
      className="th-sortable"
      scope="col"
      aria-sort={
        active
          ? sortDir === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button
        type="button"
        className={`th-sort-btn ${active ? "is-active" : ""}`}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        {active && <span className="th-sort-arrow">{arrow}</span>}
      </button>
    </th>
  );
}

export default function OpportunitiesTable({
  opportunities,
  mode,
  onAfterBet,
  onSuccess
}: {
  opportunities: Opportunity[];
  mode: TradeMode;
  onAfterBet: () => void | Promise<void>;
  onSuccess: (msg: string) => void;
}) {
  const { settings, setSettings } = useSeerSettings();
  const bankroll = settings.bankroll;
  const { placedMarketIds, refetchOpenPositions } = useOpenPositionMarketIds(
    mode === "paper" ? "paper" : "live"
  );
  const [modal, setModal] = useState<Opportunity | null>(null);
  const [stakeInput, setStakeInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<TableFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("aer");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [modalCalibBuckets, setModalCalibBuckets] = useState<
    CalibrationBucketRow[] | null
  >(null);
  const [stakePreset, setStakePreset] = useState<StakePreset>("kelly");
  const [maxDaysCap, setMaxDaysCap] = useState<number>(9999);
  const [minConfBar, setMinConfBar] = useState<number>(0.9);
  const [tierBar, setTierBar] = useState<"all" | "t1" | "t12">("all");
  const [layerBar, setLayerBar] = useState<"all" | "l1" | "l12">("all");
  const [manualModal, setManualModal] = useState<Opportunity | null>(null);
  const [manualStake, setManualStake] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [manualBetId, setManualBetId] = useState("");
  const [manualPlatform, setManualPlatform] =
    useState<PreferredPlatform>("betfair");
  const [manualErr, setManualErr] = useState<string | null>(null);
  const [manualSubmitting, setManualSubmitting] = useState(false);

  useEffect(() => {
    if (!modal) {
      setModalCalibBuckets(null);
      return;
    }
    let cancelled = false;
    void fetchJson<CalibrationResponse>("/api/calibration")
      .then((c) => {
        if (!cancelled)
          setModalCalibBuckets(c.categories[modal.category] ?? []);
      })
      .catch(() => {
        if (!cancelled) setModalCalibBuckets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [modal]);

  useEffect(() => {
    if (!modal) return;
    const kellyRounded = Math.round(modal.kellyFraction * bankroll);
    const kellyStake = Math.max(1, kellyRounded);
    const count = Math.max(1, opportunities.length);
    const equalStake = Math.max(1, Math.round(bankroll / count));
    const v =
      stakePreset === "kelly"
        ? Math.max(1, kellyStake, Math.round(settings.defaultStake))
        : equalStake;
    setStakeInput(String(v));
  }, [modal, bankroll, stakePreset, opportunities.length, settings.defaultStake]);

  useEffect(() => {
    if (!manualModal) return;
    setManualPlatform(settings.preferredPlatform);
    setManualPrice(String(manualModal.currentPrice));
    setManualStake(String(Math.max(1, Math.round(settings.defaultStake))));
    setManualBetId("");
    setManualErr(null);
  }, [manualModal, settings.preferredPlatform, settings.defaultStake]);

  useEffect(() => {
    if (!successMsg) return;
    const t = window.setTimeout(() => setSuccessMsg(null), 2800);
    return () => window.clearTimeout(t);
  }, [successMsg]);

  function handleSortClick(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(defaultSortDir(key));
    }
  }

  const sortedFiltered = useMemo(() => {
    return [...opportunities]
      .filter((o) => o.daysToResolution >= 0.5)
      .filter((o) => passesFilter(o, filter))
      .filter((o) =>
        passesAdvancedFilters(o, {
          maxDaysCap,
          minConfBar,
          tierBar,
          layerBar,
          settings
        })
      )
      .sort((a, b) => compareOpportunities(a, b, sortKey, sortDir));
  }, [
    opportunities,
    filter,
    sortKey,
    sortDir,
    maxDaysCap,
    minConfBar,
    tierBar,
    layerBar,
    settings
  ]);

  async function confirmManualBet() {
    if (!manualModal) return;
    setManualErr(null);
    const stake = Number.parseFloat(String(manualStake).replace(/,/g, ""));
    const price = Number.parseFloat(String(manualPrice).replace(/,/g, ""));
    if (!Number.isFinite(stake) || stake < 1) {
      setManualErr("Stake must be at least £1.");
      return;
    }
    if (!Number.isFinite(price) || price <= 0 || price >= 1) {
      setManualErr("Price must be between 0 and 1 (e.g. 0.93).");
      return;
    }
    const direction = normalizeBetDirection(manualModal.direction);
    if (!direction) {
      setManualErr(
        `Invalid direction "${manualModal.direction}" (expected YES or NO).`
      );
      return;
    }
    const layerParsed = parseInt(
      String(manualModal.layer).replace(/^L/i, ""),
      10
    );
    const layer =
      layerParsed === 1 || layerParsed === 2 || layerParsed === 3
        ? layerParsed
        : undefined;
    const body: Record<string, unknown> = {
      marketId: String(manualModal.marketId),
      direction,
      stake,
      mode: "live",
      platform: manualPlatform,
      price,
      signals: manualModal.signals ?? []
    };
    if (layer !== undefined) body.layer = layer;
    if (manualBetId.trim()) body.platformBetId = manualBetId.trim();

    setManualSubmitting(true);
    try {
      const res = await fetch(apiUrl("/api/positions"), {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify(body)
      });
      let data: Record<string, unknown> | null = null;
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        data = null;
      }
      if (!res.ok) {
        let msg =
          (data && typeof data.message === "string" ? data.message : null) ??
          String(res.status);
        const ve = data?.validationErrors as
          | { field: string; reason: string }[]
          | undefined;
        if (Array.isArray(ve) && ve.length > 0) {
          msg = `${msg}: ${ve.map((e) => `${e.field}: ${e.reason}`).join("; ")}`;
        }
        setManualErr(`Failed: ${msg}`);
        return;
      }
      const posResult = data as {
        ok?: boolean;
        positionId?: number;
        error?: string;
      } | null;
      if (posResult?.ok !== true || posResult.positionId == null) {
        const fallback =
          typeof posResult?.error === "string"
            ? posResult.error
            : "Server did not confirm position (ok / positionId missing).";
        setManualErr(`Failed: ${fallback}`);
        return;
      }
      setSuccessMsg("✓ Manual live bet logged");
      onSuccess(
        `Manual bet logged: ${manualModal.question.slice(0, 40)}...`
      );
      await Promise.resolve(onAfterBet());
      await refetchOpenPositions();
      setManualModal(null);
    } catch (e) {
      setManualErr(
        e instanceof Error ? `Failed: ${e.message}` : `Failed: ${String(e)}`
      );
    } finally {
      setManualSubmitting(false);
    }
  }

  async function confirmBet() {
    if (!modal) return;
    setErr(null);
    const stakeValue = Number.parseFloat(String(stakeInput).replace(/,/g, ""));
    const stake = Number(stakeValue);
    if (!Number.isFinite(stake) || stake < 1) {
      setErr("Stake must be at least ┬ú1.");
      return;
    }
    const direction = normalizeBetDirection(modal.direction);
    if (!direction) {
      setErr(`Invalid direction "${modal.direction}" (expected YES or NO).`);
      return;
    }
    const layerParsed = parseInt(String(modal.layer).replace(/^L/i, ""), 10);
    const layer =
      layerParsed === 1 || layerParsed === 2 || layerParsed === 3
        ? layerParsed
        : undefined;
    const modeLiteral: "paper" | "live" = mode === "paper" ? "paper" : "live";
    const body: {
      marketId: string;
      direction: "YES" | "NO";
      stake: number;
      mode: "paper" | "live";
      layer?: number;
      signals: string[];
    } = {
      marketId: String(modal.marketId),
      direction,
      stake,
      mode: modeLiteral,
      signals: modal.signals ?? []
    };
    if (layer !== undefined) body.layer = layer;

    console.log("[seer] POST /api/positions body (stringified):", JSON.stringify(body));

    setSubmitting(true);
    try {
      const res = await fetch(apiUrl("/api/positions"), {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify(body)
      });
      let data: Record<string, unknown> | null = null;
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        data = null;
      }
      console.log("Response status:", res.status, data);
      if (!res.ok) {
        let msg =
          (data && typeof data.message === "string" ? data.message : null) ??
          String(res.status);
        const ve = data?.validationErrors as
          | { field: string; reason: string }[]
          | undefined;
        if (Array.isArray(ve) && ve.length > 0) {
          msg = `${msg}: ${ve.map((e) => `${e.field}: ${e.reason}`).join("; ")}`;
        }
        setErr(`Failed: ${msg}`);
        return;
      }
      const posResult = data as {
        ok?: boolean;
        positionId?: number;
        error?: string;
      } | null;
      if (posResult?.ok !== true || posResult.positionId == null) {
        const fallback =
          typeof posResult?.error === "string"
            ? posResult.error
            : "Server did not confirm position (ok / positionId missing).";
        setErr(`Failed: ${fallback}`);
        return;
      }
      const msg =
        mode === "paper"
          ? "Ô£ô Paper position opened"
          : "Ô£ô Live position opened";
      setSuccessMsg(msg);
      onSuccess(
        `${mode === "paper" ? "Paper" : "Live"} bet placed: ${modal.question.slice(0, 40)}...`
      );
      await Promise.resolve(onAfterBet());
      await refetchOpenPositions();
      setModal(null);
    } catch (e) {
      console.error("[seer] POST /api/positions failed:", e);
      setErr(
        e instanceof Error ? `Failed: ${e.message}` : `Failed: ${String(e)}`
      );
    } finally {
      setSubmitting(false);
    }
  }

  const whyModal = modal;
  const yesImplied = whyModal ? impliedYesForOpportunity(whyModal) : 0;
  const bucketLabel = whyModal ? yesImpliedToBucketLabel(yesImplied) : null;
  const calRow =
    whyModal && modalCalibBuckets && bucketLabel
      ? modalCalibBuckets.find((b) => b.priceBucket === bucketLabel) ?? null
      : null;
  const modelSideProb = whyModal
    ? whyModal.direction === "YES"
      ? whyModal.calibratedProbability
      : 1 - whyModal.calibratedProbability
    : 0;
  const edgeAbs = whyModal ? modelSideProb - whyModal.marketProbability : 0;
  const histForSide =
    calRow != null
      ? whyModal!.direction === "YES"
        ? calRow.resolutionRate
        : 1 - calRow.resolutionRate
      : null;
  const oppCount = Math.max(1, opportunities.length);
  const kellyRounded =
    whyModal != null ? Math.round(whyModal.kellyFraction * bankroll) : 0;
  const equalStakeDisplay = Math.max(1, Math.round(bankroll / oppCount));

  return (
    <>
      <div className="panel">
        {successMsg && <div className="success-banner">{successMsg}</div>}
        {err && !modal && <div className="error-banner">{err}</div>}
        <div className="opp-filter-bar" role="toolbar" aria-label="Filter opportunities">
          {FILTER_CHIPS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`opp-filter-chip ${filter === id ? "is-active" : ""}`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          className="opp-filter-advanced"
          role="toolbar"
          aria-label="Refine and sort opportunities"
        >
          <label>
            Max days{" "}
            <select
              value={maxDaysCap}
              onChange={(e) => setMaxDaysCap(Number(e.target.value))}
            >
              <option value={7}>7</option>
              <option value={14}>14</option>
              <option value={30}>30</option>
              <option value={60}>60</option>
              <option value={90}>90</option>
              <option value={9999}>Any</option>
            </select>
          </label>
          <label>
            Min confidence{" "}
            <select
              value={minConfBar}
              onChange={(e) => setMinConfBar(Number(e.target.value))}
            >
              <option value={0.9}>90%</option>
              <option value={0.93}>93%</option>
              <option value={0.95}>95%</option>
              <option value={0.97}>97%</option>
            </select>
          </label>
          <label className="toggle-wrap">
            <input
              type="checkbox"
              checked={!settings.showPolitics}
              onChange={(e) =>
                setSettings({ showPolitics: !e.target.checked })
              }
            />
            Hide politics
          </label>
          <label>
            Tier{" "}
            <select
              value={tierBar}
              onChange={(e) =>
                setTierBar(e.target.value as "all" | "t1" | "t12")
              }
            >
              <option value="all">All</option>
              <option value="t1">Tier 1 only</option>
              <option value="t12">Tier 1+2</option>
            </select>
          </label>
          <label>
            Layer{" "}
            <select
              value={layerBar}
              onChange={(e) =>
                setLayerBar(e.target.value as "all" | "l1" | "l12")
              }
            >
              <option value="l1">L1 only</option>
              <option value="l12">L1+2</option>
              <option value="all">All</option>
            </select>
          </label>
          <label>
            Sort by{" "}
            <select
              value={sortKey}
              onChange={(e) => {
                const k = e.target.value as SortKey;
                setSortKey(k);
                setSortDir(defaultSortDir(k));
              }}
            >
              <option value="aer">AER</option>
              <option value="days">Days to resolution</option>
              <option value="confidence">Confidence</option>
              <option value="stake">Suggested stake</option>
              <option value="score">Psychology score</option>
              <option value="layer">Layer</option>
              <option value="price">Price</option>
            </select>
          </label>
        </div>
        <div className="table-wrap opp-desktop-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Market</th>
                <SortTh
                  label="Layer"
                  sortKey="layer"
                  activeKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSortClick}
                />
                <th>Dir</th>
                <SortTh
                  label="Price"
                  sortKey="price"
                  activeKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSortClick}
                />
                <SortTh
                  label="Days"
                  sortKey="days"
                  activeKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSortClick}
                />
                <SortTh
                  label="AER"
                  sortKey="aer"
                  activeKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSortClick}
                />
                <th>2├ù</th>
                <SortTh
                  label="Score"
                  sortKey="score"
                  activeKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSortClick}
                />
                <SortTh
                  label="Tier stake"
                  sortKey="stake"
                  activeKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSortClick}
                />
                <th>Signals</th>
                <th>Bet</th>
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="empty">
                    {opportunities.length === 0
                      ? "No opportunities found above threshold. Next analysis runs at 6:00 AM."
                      : "No rows match this filter."}
                  </td>
                </tr>
              ) : (
                sortedFiltered.map((o) => (
                  <tr
                    key={`${o.marketId}-${o.direction}-${o.computedAt}`}
                    className={rowLayerClass(o.layer)}
                  >
                    <td className="market-cell">
                      <div className="market-cell-row">
                        <span>{o.question}</span>
                        {o.hasOpenPosition ? (
                          <OpenPositionPill o={o} />
                        ) : placedMarketIds.has(String(o.marketId)) ? (
                          <PlacedBadge />
                        ) : null}
                      </div>
                    </td>
                    <td className="layer-cell">{layerBadge(o.layer)}</td>
                    <td className="num">{o.direction}</td>
                    <td className="num">{fmtPrice(o.currentPrice)}</td>
                    <td className="num">{fmtDays(o.daysToResolution)}</td>
                    <td className="num aer-cell">
                      <AerHoldDisplay
                        aer={o.aer}
                        daysToResolution={o.daysToResolution}
                        aerHoldWarning={o.aerHoldWarning}
                        aerWarning={o.aerWarning}
                      />
                    </td>
                    <td className="num">
                      {Number.isFinite(o.timeToDouble) && o.timeToDouble > 0
                        ? `${o.timeToDouble.toFixed(0)}d`
                        : "ÔÇö"}
                    </td>
                    <td>
                      <ScoreDots
                        layer={o.layer}
                        psychologyScore={o.psychologyScore}
                      />
                    </td>
                    <td className="tier-stake-cell">
                      <TieredStakeLine bankroll={bankroll} o={o} />
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
                    <td className="opp-bet-cell">
                      <button
                        type="button"
                        className={`btn-bet ${mode}`}
                        onClick={() => {
                          setErr(null);
                          setStakePreset("kelly");
                          setModal(o);
                        }}
                      >
                        Bet
                      </button>
                      {mode === "live" ? (
                        <button
                          type="button"
                          className="btn-manual-bet"
                          onClick={() => {
                            setManualModal(o);
                          }}
                        >
                          Log manual
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="opp-cards" aria-label="Opportunities (mobile)">
          {sortedFiltered.length === 0 ? (
            <div className="opp-card opp-card--empty muted">
              {opportunities.length === 0
                ? "No opportunities found above threshold. Next analysis runs at 6:00 AM."
                : "No rows match this filter."}
            </div>
          ) : (
            sortedFiltered.map((o) => {
              const betStake = Math.max(
                1,
                Math.round(o.kellyFraction * bankroll)
              );
              return (
                <div
                  key={`card-${o.marketId}-${o.direction}-${o.computedAt}`}
                  className={`opp-card ${rowLayerClass(o.layer)}`}
                >
                  <div className="opp-card-q market-cell-row">
                    <span>{o.question}</span>
                    {o.hasOpenPosition ? (
                      <OpenPositionPill o={o} />
                    ) : placedMarketIds.has(String(o.marketId)) ? (
                      <PlacedBadge />
                    ) : null}
                  </div>
                  <div className="opp-card-meta">
                    {o.direction} ┬À {(o.currentPrice * 100).toFixed(1)}% ┬À{" "}
                    {fmtDays(o.daysToResolution)}{" "}
                    {o.daysToResolution === 1 ? "day" : "days"}
                  </div>
                  <div className="opp-card-row2">
                    <div className="opp-card-aer">
                      <span className="opp-card-aer-prefix">AER: </span>
                      <AerHoldDisplay
                        aer={o.aer}
                        daysToResolution={o.daysToResolution}
                        aerHoldWarning={o.aerHoldWarning}
                        aerWarning={o.aerWarning}
                      />
                    </div>
                    <span className="opp-card-layer">
                      L{o.layer}
                      <ScoreDots
                        layer={o.layer}
                        psychologyScore={o.psychologyScore}
                      />
                    </span>
                  </div>
                  <div className="opp-card-tier-stake">
                    <TieredStakeLine bankroll={bankroll} o={o} />
                  </div>
                  <div className="tag-row opp-card-tags">
                    {tagsFromSignals(o.signals).map((t) => (
                      <span key={t} className="signal-tag">
                        [{t}]
                      </span>
                    ))}
                  </div>
                  <div className="opp-card-actions opp-bet-cell">
                    <button
                      type="button"
                      className={`btn-bet ${mode}`}
                      onClick={() => {
                        setErr(null);
                        setStakePreset("kelly");
                        setModal(o);
                      }}
                    >
                      BET {formatGbp(betStake, 0)}
                    </button>
                    {mode === "live" ? (
                      <button
                        type="button"
                        className="btn-manual-bet"
                        onClick={() => setManualModal(o)}
                      >
                        Log manual
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {modal && (
        <div
          className="modal-backdrop modal-backdrop--bet"
          role="presentation"
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            setModal(null);
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
              onClick={() => setModal(null)}
              aria-label="Close"
            >
              Ô£ò
            </button>
            <h3 className="modal-bet-title">{modal.question}</h3>
            {err && (
              <div className="modal-error" role="alert">
                {err}
              </div>
            )}
            <dl>
              <div>
                <dt>Direction</dt>
                <dd>{modal.direction}</dd>
              </div>
              <div>
                <dt>Stake suggestion</dt>
                <dd>
                  <div className="stake-suggest-summary muted">
                    Kelly: {formatGbp(kellyRounded)} | Equal split (
                    {formatGbp(bankroll, 0)} / {oppCount}{" "}
                    {oppCount === 1 ? "bet" : "bets"}):{" "}
                    {formatGbp(equalStakeDisplay)}
                  </div>
                  <div
                    className="stake-preset-toggles"
                    role="radiogroup"
                    aria-label="Stake preset"
                  >
                    <label className="stake-preset-label">
                      <input
                        type="radio"
                        name="stake-preset"
                        checked={stakePreset === "kelly"}
                        onChange={() => setStakePreset("kelly")}
                        disabled={submitting}
                      />
                      Use Kelly (min {formatGbp(1)})
                    </label>
                    <label className="stake-preset-label">
                      <input
                        type="radio"
                        name="stake-preset"
                        checked={stakePreset === "equal"}
                        onChange={() => setStakePreset("equal")}
                        disabled={submitting}
                      />
                      Use equal split
                    </label>
                  </div>
                  <span className="muted" style={{ fontSize: "0.75em" }}>
                    Kelly fraction {formatPct(modal.kellyFraction, 2)}, bankroll{" "}
                    {formatGbp(bankroll, 0)}
                  </span>
                  <div
                    className="tier-stake-modal-line"
                    style={{ marginTop: "0.35rem" }}
                  >
                    Tiered: <TieredStakeLine bankroll={bankroll} o={modal} />
                  </div>
                </dd>
              </div>
              <div>
                <dt>AER</dt>
                <dd>
                  <AerHoldDisplay
                    aer={modal.aer}
                    daysToResolution={modal.daysToResolution}
                    aerHoldWarning={modal.aerHoldWarning}
                    aerWarning={modal.aerWarning}
                    decimals={2}
                  />
                </dd>
              </div>
              <div>
                <dt>Time to double</dt>
                <dd>
                  {Number.isFinite(modal.timeToDouble) && modal.timeToDouble > 0
                    ? `${modal.timeToDouble.toFixed(1)} days`
                    : "ÔÇö"}
                </dd>
              </div>
              <div>
                <dt>Layer</dt>
                <dd>{layerBadge(modal.layer)}</dd>
              </div>
            </dl>

            <div className="why-seer-panel">
              <p className="why-seer-title">Why Seer flagged this</p>
              <div className="why-seer-block">
                <p className="why-seer-sub">Calibration data</p>
                {calRow ? (
                  <ul className="why-seer-list">
                    <li>
                      In {calRow.sampleSize} resolved markets priced{" "}
                      {calRow.priceBucket} (implied YES),{" "}
                      {(calRow.resolutionRate * 100).toFixed(1)}% resolved YES.
                    </li>
                    <li>
                      This market: {(modal.marketProbability * 100).toFixed(1)}% ÔåÆ
                      historically true{" "}
                      {histForSide != null
                        ? `${(histForSide * 100).toFixed(1)}%`
                        : "ÔÇö"}{" "}
                      of the time ({modal.direction}, bucket {bucketLabel ?? "ÔÇö"}).
                    </li>
                    <li>
                      Edge: {edgeAbs >= 0 ? "+" : ""}
                      {(edgeAbs * 100).toFixed(1)}% above market price (model{" "}
                      {formatPct(modelSideProb, 1)}).
                    </li>
                  </ul>
                ) : (
                  <ul className="why-seer-list">
                    <li className="muted">
                      No matching calibration row for category &quot;{modal.category}
                      &quot; bucket {bucketLabel ?? "ÔÇö"}.
                    </li>
                    <li>
                      Model vs market (your side): {formatPct(modelSideProb, 1)} vs{" "}
                      {formatPct(modal.marketProbability, 1)} ÔÇö edge{" "}
                      {edgeAbs >= 0 ? "+" : ""}
                      {(edgeAbs * 100).toFixed(1)}%.
                    </li>
                  </ul>
                )}
              </div>
              <div className="why-seer-block">
                <p className="why-seer-sub">Active signals</p>
                {collectExplanationTags(modal.signals).length === 0 ? (
                  <p className="muted why-seer-muted">No mapped explanations.</p>
                ) : (
                  <ul className="why-seer-list">
                    {collectExplanationTags(modal.signals).map((tag) => (
                      <li key={tag}>
                        <strong>{tag}:</strong> {SIGNAL_EXPLANATIONS[tag]}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <p className="stat-k" style={{ marginTop: "0.75rem" }}>
              Raw signals
            </p>
            <ul className="signal-list">
              {modal.signals.length === 0 ? (
                <li className="muted">None</li>
              ) : (
                modal.signals.map((s, i) => <li key={i}>{s}</li>)
              )}
            </ul>
            <div className="modal-stake-field">
              <label htmlFor="modal-stake-input">Stake (┬ú)</label>
              <input
                id="modal-stake-input"
                type="text"
                inputMode="decimal"
                value={stakeInput}
                onChange={(e) => setStakeInput(e.target.value)}
                disabled={submitting}
                autoComplete="off"
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setModal(null)}
                disabled={submitting}
              >
                Skip
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void confirmBet()}
                disabled={submitting}
              >
                {submitting ? "ÔÇª" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {manualModal && (
        <div
          className="modal-backdrop modal-backdrop--bet"
          role="presentation"
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            setManualModal(null);
          }}
        >
          <div
            className="modal modal--bet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-bet-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="modal-bet-close"
              onClick={() => setManualModal(null)}
              aria-label="Close"
            >
              Ô£ò
            </button>
            <h3 id="manual-bet-title" className="modal-bet-title">
              Log manual bet
            </h3>
            <p
              className="muted"
              style={{ fontSize: "0.72rem", marginTop: "-0.35rem" }}
            >
              {manualModal.question}
            </p>
            {manualErr && (
              <div className="modal-error" role="alert">
                {manualErr}
              </div>
            )}
            <div className="modal-stake-field">
              <label htmlFor="manual-platform">Platform</label>
              <select
                id="manual-platform"
                value={manualPlatform}
                onChange={(e) =>
                  setManualPlatform(e.target.value as PreferredPlatform)
                }
                disabled={manualSubmitting}
              >
                <option value="betfair">Betfair</option>
                <option value="matchbook">Matchbook</option>
                <option value="smarkets">Smarkets</option>
              </select>
            </div>
            <div className="modal-stake-field">
              <label htmlFor="manual-stake">Stake (£)</label>
              <input
                id="manual-stake"
                type="text"
                inputMode="decimal"
                value={manualStake}
                onChange={(e) => setManualStake(e.target.value)}
                disabled={manualSubmitting}
                autoComplete="off"
              />
            </div>
            <div className="modal-stake-field">
              <label htmlFor="manual-price">Price (0–1)</label>
              <input
                id="manual-price"
                type="text"
                inputMode="decimal"
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
                disabled={manualSubmitting}
                autoComplete="off"
              />
            </div>
            <div className="modal-stake-field">
              <label htmlFor="manual-bet-id">Bet ID (optional)</label>
              <input
                id="manual-bet-id"
                type="text"
                value={manualBetId}
                onChange={(e) => setManualBetId(e.target.value)}
                disabled={manualSubmitting}
                autoComplete="off"
              />
            </div>
            <p className="muted" style={{ fontSize: "0.68rem" }}>
              Direction {manualModal.direction}; logs a live position (manual
              entry).
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setManualModal(null)}
                disabled={manualSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void confirmManualBet()}
                disabled={manualSubmitting}
              >
                {manualSubmitting ? "ÔÇª" : "Log bet"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
