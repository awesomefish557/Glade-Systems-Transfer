import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "../api";
import { useSeerSettings } from "../settingsContext";
import type { OpportunitiesResponse, Opportunity, TradeMode } from "../types";
import OpportunitiesTable from "./OpportunitiesTable";

export default function HomeOpportunitiesSection({
  active
}: {
  active: boolean;
}) {
  const { settings } = useSeerSettings();
  const [rows, setRows] = useState<Opportunity[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      const r = await fetchJson<OpportunitiesResponse>("/api/opportunities");
      setRows(r.opportunities ?? []);
    } catch (e) {
      setRows([]);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  const mode: TradeMode = settings.defaultBetMode;

  return (
    <section className="section">
      <div className="section-label section-label--row">
        <span>Daily opportunities</span>
        <button type="button" className="btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {err != null ? (
        <div className="error-banner" role="alert">
          {err}
        </div>
      ) : null}
      <OpportunitiesTable
        opportunities={rows}
        mode={mode}
        onAfterBet={load}
        onSuccess={() => {}}
      />
    </section>
  );
}
