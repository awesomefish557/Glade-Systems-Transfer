import { useCallback, useEffect, useMemo, useState } from "react";
import {
  approveLoadingBayItem,
  createLoadingBayItem,
  dismissLoadingBayItem,
  fetchLoadingBay,
  flagLoadingBayItem,
  processLoadingBayItem as triggerLoadingBayProcess,
  unflagLoadingBayItem,
} from "../api";
import { requestGraphRefresh } from "../graphRefresh";
import type { LoadingBayItem } from "../types";

type InputTab = "text" | "url" | "file";

function groupItems(items: LoadingBayItem[], processingIds: Set<string>) {
  const processing: LoadingBayItem[] = [];
  const proposed: LoadingBayItem[] = [];
  const flagged: LoadingBayItem[] = [];
  for (const it of items) {
    const st = it.status;
    if (st === "flagged") {
      flagged.push(it);
      continue;
    }
    if (st === "proposed") {
      proposed.push(it);
      continue;
    }
    if (st === "pending" || st === "processing" || processingIds.has(it.id)) {
      processing.push(it);
    }
  }
  return { processing, proposed, flagged };
}

function isActivelyProcessing(it: LoadingBayItem, processingIds: Set<string>) {
  return processingIds.has(it.id) || it.status === "processing";
}

function Spinner() {
  return <span className="pinboard-lb-spinner" aria-hidden />;
}

export function LoadingBayOverlay({
  mapId,
  onClose,
  onListChanged,
}: {
  mapId: string;
  onClose: () => void;
  onListChanged?: () => void;
}) {
  const [tab, setTab] = useState<InputTab>("text");
  const [textBody, setTextBody] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [items, setItems] = useState<LoadingBayItem[]>([]);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [submitBusy, setSubmitBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3800);
  }, []);

  const reload = useCallback(async () => {
    try {
      const rows = await fetchLoadingBay();
      setItems(rows);
    } catch {
      setItems([]);
    }
    onListChanged?.();
  }, [onListChanged]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const id = window.setInterval(() => void reload(), 12_000);
    return () => window.clearInterval(id);
  }, [reload]);

  const { processing, proposed, flagged } = useMemo(
    () => groupItems(items, processingIds),
    [items, processingIds],
  );

  const runSubmit = async (kind: "text" | "url") => {
    if (submitBusy) return;
    if (kind === "text") {
      const raw = textBody.trim();
      if (!raw) return;
      setSubmitBusy(true);
      try {
        const created = await createLoadingBayItem({ raw_content: raw, raw_type: "text", map_id: mapId });
        setItems((prev) => [created, ...prev.filter((x) => x.id !== created.id)]);
        setProcessingIds((prev) => new Set(prev).add(created.id));
        setTextBody("");
        try {
          const updated = await triggerLoadingBayProcess(created.id);
          setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        } catch (procErr) {
          showToast(procErr instanceof Error ? procErr.message : String(procErr));
        } finally {
          setProcessingIds((prev) => {
            const n = new Set(prev);
            n.delete(created.id);
            return n;
          });
        }
        await reload();
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e));
      } finally {
        setSubmitBusy(false);
      }
      return;
    }
    const url = urlValue.trim();
    if (!url) return;
    setSubmitBusy(true);
    try {
      const created = await createLoadingBayItem({ raw_url: url, raw_type: "url", map_id: mapId });
      setItems((prev) => [created, ...prev.filter((x) => x.id !== created.id)]);
      setProcessingIds((prev) => new Set(prev).add(created.id));
      setUrlValue("");
      try {
        const updated = await triggerLoadingBayProcess(created.id);
        setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      } catch (procErr) {
        showToast(procErr instanceof Error ? procErr.message : String(procErr));
      } finally {
        setProcessingIds((prev) => {
          const n = new Set(prev);
          n.delete(created.id);
          return n;
        });
      }
      await reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitBusy(false);
    }
  };

  const onApprove = async (id: string) => {
    setActionBusyId(id);
    try {
      const r = await approveLoadingBayItem(id, { map_id: mapId });
      showToast(`Added ${r.nodes_created} node${r.nodes_created === 1 ? "" : "s"} to the map.`);
      requestGraphRefresh();
      setItems((prev) => prev.filter((x) => x.id !== id));
      void reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusyId(null);
    }
  };

  const onFlag = async (id: string) => {
    setActionBusyId(id);
    try {
      await flagLoadingBayItem(id);
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, status: "flagged" } : x)));
      void reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusyId(null);
    }
  };

  const onUnflag = async (id: string) => {
    setActionBusyId(id);
    try {
      await unflagLoadingBayItem(id);
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, status: "proposed" } : x)));
      void reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusyId(null);
    }
  };

  const onDismiss = async (id: string) => {
    setActionBusyId(id);
    try {
      await dismissLoadingBayItem(id);
      setItems((prev) => prev.filter((x) => x.id !== id));
      void reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusyId(null);
    }
  };

  const onRetryProcess = async (id: string) => {
    setProcessingIds((prev) => new Set(prev).add(id));
    try {
      const updated = await triggerLoadingBayProcess(id);
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessingIds((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
    await reload();
  };

  const emptyInbox = processing.length === 0 && proposed.length === 0 && flagged.length === 0;

  return (
    <div
      className="pinboard-lb-root"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        background: "rgba(5, 13, 6, 0.97)",
        overflow: "auto",
        padding: "24px 20px 48px",
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pinboard-lb-title"
    >
      <button
        type="button"
        className="pinboard-lb-close"
        onClick={onClose}
        aria-label="Close loading bay"
      >
        ×
      </button>

      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <header style={{ marginBottom: 28, paddingRight: 36 }}>
          <h1
            id="pinboard-lb-title"
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 32,
              fontWeight: 400,
              color: "#e8f4e4",
              marginBottom: 8,
            }}
          >
            Loading Bay
          </h1>
          <p style={{ fontFamily: "Georgia, serif", fontSize: 15, color: "rgba(200, 230, 190, 0.75)" }}>
            Drop anything here. AI will sort it.
          </p>
        </header>

        <section
          style={{
            marginBottom: 32,
            padding: "18px 18px 20px",
            border: "1px solid rgba(74, 106, 74, 0.45)",
            background: "rgba(8, 22, 12, 0.5)",
          }}
        >
          <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "1px solid rgba(74,106,74,0.35)" }}>
            {(
              [
                ["text", "TEXT"],
                ["url", "URL"],
                ["file", "FILE"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`pinboard-lb-tab${tab === key ? " pinboard-lb-tab--on" : ""}`}
                style={{
                  flex: 1,
                  padding: "10px 8px",
                  fontFamily: "Arial, Helvetica, sans-serif",
                  fontSize: 10,
                  letterSpacing: "0.12em",
                  border: "none",
                  background: "transparent",
                  color: tab === key ? "#f5e6b8" : "rgba(200,220,190,0.55)",
                  cursor: "pointer",
                  borderBottom: tab === key ? "2px solid #d4a853" : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "text" ? (
            <div>
              <textarea
                className="pinboard-textarea"
                rows={10}
                placeholder="Paste notes, quotes, descriptions, anything. Raw is fine."
                value={textBody}
                onChange={(e) => setTextBody(e.target.value)}
                disabled={submitBusy}
                style={{ minHeight: 200, marginBottom: 12 }}
              />
              <button
                type="button"
                className="pinboard-btn pinboard-btn--active"
                disabled={submitBusy || !textBody.trim()}
                onClick={() => void runSubmit("text")}
              >
                {submitBusy ? "…" : "Send to AI →"}
              </button>
            </div>
          ) : null}

          {tab === "url" ? (
            <div>
              <input
                className="pinboard-input"
                type="url"
                placeholder="https://..."
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                disabled={submitBusy}
                style={{ marginBottom: 12 }}
              />
              <button
                type="button"
                className="pinboard-btn pinboard-btn--active"
                disabled={submitBusy || !urlValue.trim()}
                onClick={() => void runSubmit("url")}
              >
                {submitBusy ? "…" : "Fetch & Analyse →"}
              </button>
            </div>
          ) : null}

          {tab === "file" ? (
            <div
              style={{
                fontFamily: "Georgia, serif",
                fontSize: 14,
                color: "rgba(200, 220, 190, 0.55)",
                padding: "32px 12px",
                textAlign: "center",
                border: "1px dashed rgba(74, 106, 74, 0.4)",
                background: "rgba(5, 13, 6, 0.35)",
              }}
            >
              File upload — Coming soon
            </div>
          ) : null}
        </section>

        <section>
          <h2
            style={{
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "rgba(212, 168, 83, 0.85)",
              marginBottom: 16,
            }}
          >
            Inbox
          </h2>

          {processing.length > 0 ? (
            <div style={{ marginBottom: 24 }}>
              <div className="pinboard-lb-section-label">🔄 Processing</div>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                {processing.map((it) => (
                  <li key={it.id} className="pinboard-lb-card">
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {isActivelyProcessing(it, processingIds) ? <Spinner /> : (
                        <span style={{ fontSize: 16, opacity: 0.65 }} aria-hidden>⏸</span>
                      )}
                      <span style={{ fontFamily: "Georgia, serif", fontSize: 13, color: "rgba(220, 235, 210, 0.9)" }}>
                        {it.raw_type === "url" && it.raw_url ? it.raw_url.slice(0, 80) : (it.raw_content ?? "").slice(0, 120)}
                        {(it.raw_content ?? "").length > 120 || (it.raw_url && it.raw_url.length > 80) ? "…" : ""}
                      </span>
                    </div>
                    {it.status === "pending" && !isActivelyProcessing(it, processingIds) ? (
                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, color: "#cc8888", fontFamily: "Arial, sans-serif" }}>
                            {it.ai_reasoning?.startsWith("[Processing failed]")
                              ? "Could not analyse — see details below"
                              : "Ready to process — tap Retry if this did not start"}
                          </span>
                          <button type="button" className="pinboard-btn" onClick={() => void onRetryProcess(it.id)}>
                            Retry
                          </button>
                        </div>
                        {it.ai_reasoning?.startsWith("[Processing failed]") ? (
                          <pre
                            style={{
                              margin: 0,
                              maxWidth: "100%",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              fontSize: 11,
                              lineHeight: 1.4,
                              color: "#daa",
                              fontFamily: "ui-monospace, monospace",
                              background: "rgba(0,0,0,0.25)",
                              padding: "8px 10px",
                              borderRadius: 4,
                            }}
                          >
                            {it.ai_reasoning.replace(/^\[Processing failed\]\s*/, "")}
                          </pre>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {proposed.length > 0 ? (
            <div style={{ marginBottom: 24 }}>
              <div className="pinboard-lb-section-label">⏳ Proposed</div>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 14 }}>
                {proposed.map((it) => (
                  <li key={it.id} className="pinboard-lb-card" style={{ position: "relative" }}>
                    <button
                      type="button"
                      className="pinboard-lb-dismiss"
                      aria-label="Dismiss"
                      disabled={actionBusyId === it.id}
                      onClick={() => void onDismiss(it.id)}
                    >
                      ×
                    </button>
                    {it.ai_reasoning ? (
                      <p
                        style={{
                          fontFamily: "Georgia, serif",
                          fontSize: 12,
                          fontStyle: "italic",
                          color: "rgba(200, 220, 195, 0.72)",
                          marginBottom: 12,
                          lineHeight: 1.45,
                          paddingRight: 28,
                        }}
                      >
                        {it.ai_reasoning}
                      </p>
                    ) : null}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                      {(it.proposed_nodes ?? []).map((n, i) => (
                        <span key={i} className="pinboard-lb-chip">
                          <span className="pinboard-lb-chip-type">{n.type ?? "NODE"}</span>
                          {n.title ?? "—"}
                        </span>
                      ))}
                    </div>
                    {(it.proposed_connections ?? []).length > 0 ? (
                      <ul style={{ listStyle: "none", marginBottom: 14, fontSize: 12, fontFamily: "Georgia, serif" }}>
                        {(it.proposed_connections ?? []).map((c, i) => (
                          <li key={i} style={{ color: "rgba(210, 225, 200, 0.88)", marginBottom: 4 }}>
                            {(c.source_title ?? "?")} → <em>{c.label || "—"}</em> → {c.target_title ?? "?"}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <button
                        type="button"
                        className="pinboard-btn pinboard-btn--active"
                        disabled={actionBusyId === it.id}
                        onClick={() => void onApprove(it.id)}
                      >
                        ✓ Add to Map
                      </button>
                      <button
                        type="button"
                        className="pinboard-btn"
                        disabled={actionBusyId === it.id}
                        onClick={() => void onFlag(it.id)}
                      >
                        🚩 Flag
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {flagged.length > 0 ? (
            <div style={{ marginBottom: 24 }}>
              <div className="pinboard-lb-section-label">🚩 Flagged</div>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                {flagged.map((it) => (
                  <li key={it.id} className="pinboard-lb-card">
                    <details>
                      <summary
                        style={{
                          cursor: "pointer",
                          fontFamily: "Georgia, serif",
                          fontSize: 13,
                          color: "rgba(220, 200, 160, 0.95)",
                          listStyle: "none",
                        }}
                      >
                        <span style={{ marginRight: 12 }}>Flagged for review</span>
                        <button
                          type="button"
                          className="pinboard-btn"
                          style={{ fontSize: 9, padding: "4px 8px", verticalAlign: "middle" }}
                          disabled={actionBusyId === it.id}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void onUnflag(it.id);
                          }}
                        >
                          Unflag
                        </button>
                      </summary>
                      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(74,106,74,0.35)" }}>
                        {it.ai_reasoning ? (
                          <p
                            style={{
                              fontFamily: "Georgia, serif",
                              fontSize: 12,
                              fontStyle: "italic",
                              color: "rgba(200, 220, 195, 0.72)",
                              marginBottom: 12,
                              lineHeight: 1.45,
                            }}
                          >
                            {it.ai_reasoning}
                          </p>
                        ) : null}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                          {(it.proposed_nodes ?? []).map((n, i) => (
                            <span key={i} className="pinboard-lb-chip">
                              <span className="pinboard-lb-chip-type">{n.type ?? "NODE"}</span>
                              {n.title ?? "—"}
                            </span>
                          ))}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                          <button
                            type="button"
                            className="pinboard-btn pinboard-btn--active"
                            disabled={actionBusyId === it.id}
                            onClick={() => void onApprove(it.id)}
                          >
                            ✓ Add to Map
                          </button>
                          <button
                            type="button"
                            className="pinboard-lb-dismiss-inline"
                            aria-label="Dismiss"
                            disabled={actionBusyId === it.id}
                            onClick={() => void onDismiss(it.id)}
                          >
                            × Dismiss
                          </button>
                        </div>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {emptyInbox ? (
            <p
              style={{
                fontFamily: "Georgia, serif",
                fontSize: 15,
                color: "rgba(180, 200, 175, 0.55)",
                textAlign: "center",
                padding: "36px 12px",
              }}
            >
              Your loading bay is empty. Drop something in above.
            </p>
          ) : null}
        </section>
      </div>

      {toast ? (
        <div className="pinboard-lb-toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
