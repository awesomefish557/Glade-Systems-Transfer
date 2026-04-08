import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteNode, fetchExploreNext } from "../api";
import { QUESTION_TYPE_COLOR } from "../constants";
import { draftFromRecommendation } from "../lib/exploreDraft";
import type { AddNodeDraft, ExploreRecommendation, GraphConnection, GraphNode } from "../types";
import { WobblyPanel } from "./WobblyPanel";

function recIcon(kind: string): string {
  switch (kind) {
    case "book":
      return "📚";
    case "talk":
      return "🎬";
    case "place":
      return "📍";
    case "person":
      return "👤";
    case "website":
      return "🌐";
    case "concept":
    default:
      return "💡";
  }
}

function ExploreSkeleton() {
  return (
    <div className="explore-skel-grid" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="explore-skel-card">
          <div className="explore-skel-line explore-skel-line--short" />
          <div className="explore-skel-line" />
          <div className="explore-skel-line" />
          <div className="explore-skel-line explore-skel-line--btn" />
        </div>
      ))}
    </div>
  );
}

function neighborTitles(
  qid: string,
  connections: GraphConnection[],
  nodeIndex: Map<string, GraphNode>,
): string[] {
  const out: string[] = [];
  for (const c of connections) {
    if (c.source_id === qid) {
      const n = nodeIndex.get(c.target_id);
      if (n) out.push(n.title);
    } else if (c.target_id === qid) {
      const n = nodeIndex.get(c.source_id);
      if (n) out.push(n.title);
    }
  }
  return out;
}

export function ExploreNextView({
  mapId,
  nodeTypeNames,
  nodes,
  connections,
  onAddToMap,
  onGraphRefresh,
}: {
  mapId: string;
  /** Type names for this map (for mapping explore recommendations). */
  nodeTypeNames: string[];
  nodes: GraphNode[];
  connections: GraphConnection[];
  onAddToMap: (draft: AddNodeDraft) => void;
  onGraphRefresh: () => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [recs, setRecs] = useState<ExploreRecommendation[]>([]);
  const [dismissing, setDismissing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchExploreNext(mapId);
      setRecs(data.recommendations.slice(0, 5));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRecs([]);
    } finally {
      setLoading(false);
    }
  }, [mapId]);

  useEffect(() => {
    void load();
  }, [load]);

  const nodeIndex = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const questionNodes = useMemo(() => nodes.filter((n) => n.type === "QUESTION"), [nodes]);

  const onDismissQuestion = async (id: string) => {
    setDismissing(id);
    try {
      await deleteNode(id);
      await onGraphRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setDismissing(null);
    }
  };

  return (
    <div className="pinboard-explore-root">
      <header className="pinboard-explore-header">
        <h1 className="pinboard-explore-title">What to explore next</h1>
        <p className="pinboard-explore-sub">Based on gaps in your knowledge map</p>
        <button type="button" className="pinboard-btn pinboard-explore-refresh" onClick={() => void load()} disabled={loading}>
          {loading ? "…" : "🔄 Regenerate recommendations"}
        </button>
      </header>

      {err ? (
        <p className="pinboard-ui-label" style={{ color: "#cc8888", marginBottom: 16, fontSize: 13 }}>
          {err}
        </p>
      ) : null}

      {loading ? (
        <ExploreSkeleton />
      ) : (
        <div className="explore-rec-grid">
          {recs.map((r, i) => (
            <div key={`${r.title}-${i}`} className="explore-rec-cell">
              <WobblyPanel padding="16px 18px" minHeight={160} panelFill="rgba(15,30,18,0.8)">
                <div style={{ fontSize: 26, marginBottom: 8 }}>{recIcon(String(r.type))}</div>
                <h2 className="pinboard-explore-card-title">{r.title}</h2>
                <p className="pinboard-explore-card-reason">{r.reason}</p>
                {r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pinboard-explore-open"
                  >
                    Open →
                  </a>
                ) : null}
                <button
                  type="button"
                  className="pinboard-btn pinboard-btn--active pinboard-explore-add"
                  style={{ marginTop: 12, width: "100%" }}
                  onClick={() => onAddToMap(draftFromRecommendation(r, nodeTypeNames))}
                >
                  Add to map
                </button>
              </WobblyPanel>
            </div>
          ))}
        </div>
      )}

      <section className="pinboard-explore-tutor">
        <h2 className="pinboard-explore-tutor-title">Questions from your tutor</h2>
        {questionNodes.length === 0 ? (
          <p style={{ color: "#6a8a6a", fontSize: 14 }}>No tutor questions on the map yet. Run Tutor Scan from the map toolbar.</p>
        ) : (
          <ul className="pinboard-explore-q-list">
            {questionNodes.map((q) => {
              const neighbors = neighborTitles(q.id, connections, nodeIndex);
              return (
                <li key={q.id}>
                  <WobblyPanel padding="12px 14px" minHeight={0} panelFill="rgba(12,24,14,0.82)">
                    <h3 style={{ fontFamily: "Georgia, serif", fontSize: 16, color: QUESTION_TYPE_COLOR }}>{q.title}</h3>
                    {q.body ? (
                      <p style={{ fontSize: 13, color: "#a8c8a0", marginTop: 6, lineHeight: 1.4 }}>{q.body}</p>
                    ) : null}
                    {neighbors.length ? (
                      <p className="pinboard-ui-label" style={{ fontSize: 10, color: "#5a8a5a", marginTop: 8 }}>
                        Connected to:{" "}
                        {neighbors.map((t, i) => (
                          <span key={i} className="pinboard-explore-chip">
                            {t}
                          </span>
                        ))}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="pinboard-btn"
                      style={{ marginTop: 10, borderColor: "#884444", color: "#daa" }}
                      disabled={dismissing === q.id}
                      onClick={() => void onDismissQuestion(q.id)}
                    >
                      {dismissing === q.id ? "…" : "Dismiss"}
                    </button>
                  </WobblyPanel>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
