import { useMemo, useState } from "react";
import { fuzzyScore, nodeSearchBlob } from "../lib/fuzzySearch";
import type { GraphConnection, GraphNode, GraphNodeType } from "../types";
import { WobblyPanel } from "./WobblyPanel";

type SortMode = "newest" | "oldest" | "alpha" | "type";

function connectionCount(id: string, connections: GraphConnection[]): number {
  let n = 0;
  for (const c of connections) {
    if (c.source_id === id || c.target_id === id) n++;
  }
  return n;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

export function ListView({
  nodeTypes,
  nodes,
  connections,
  onOpenNode,
  onViewOnMap,
}: {
  nodeTypes: GraphNodeType[];
  nodes: GraphNode[];
  connections: GraphConnection[];
  onOpenNode: (id: string) => void;
  onViewOnMap: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [typeSet, setTypeSet] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortMode>("newest");
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const typeOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of nodeTypes) m.set(t.name, t.sort_order);
    return m;
  }, [nodeTypes]);

  const colorFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of nodeTypes) m.set(t.name, t.color);
    return (name: string) => m.get(name) ?? "#888888";
  }, [nodeTypes]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const n of nodes) {
      for (const t of n.tags) {
        if (t.trim()) s.add(t.trim());
      }
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [nodes]);

  const stats = useMemo(() => {
    const byType = new Map<string, number>();
    for (const t of nodeTypes) byType.set(t.name, 0);
    for (const n of nodes) {
      byType.set(n.type, (byType.get(n.type) ?? 0) + 1);
    }
    return { total: nodes.length, byType };
  }, [nodes, nodeTypes]);

  const filtered = useMemo(() => {
    let list = [...nodes];
    const q = search.trim();
    if (q) {
      list = list
        .map((n) => ({
          n,
          sc: fuzzyScore(q, nodeSearchBlob(n)),
        }))
        .filter((x) => x.sc > 0)
        .sort((a, b) => b.sc - a.sc)
        .map((x) => x.n);
    }
    if (typeSet.size > 0) {
      list = list.filter((n) => typeSet.has(n.type));
    }
    if (tagFilter) {
      list = list.filter((n) => n.tags.some((t) => t === tagFilter));
    }
    const ts = (n: GraphNode) => n.updated_at ?? n.created_at ?? 0;
    list.sort((a, b) => {
      switch (sort) {
        case "newest":
          return ts(b) - ts(a);
        case "oldest":
          return ts(a) - ts(b);
        case "alpha":
          return a.title.localeCompare(b.title);
        case "type": {
          const oa = typeOrder.get(a.type) ?? 999;
          const ob = typeOrder.get(b.type) ?? 999;
          return oa - ob || a.title.localeCompare(b.title);
        }
        default:
          return 0;
      }
    });
    return list;
  }, [nodes, search, typeSet, tagFilter, sort, typeOrder]);

  const toggleType = (t: string) => {
    setTypeSet((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const sortedTypes = useMemo(
    () => [...nodeTypes].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [nodeTypes],
  );

  return (
    <div className="pinboard-list-root">
      <div className="pinboard-list-stats">
        <span className="pinboard-list-stat-total pinboard-ui-label">{stats.total} nodes</span>
        {sortedTypes.map((t) => {
          const c = stats.byType.get(t.name) ?? 0;
          if (c === 0) return null;
          const col = t.color;
          return (
            <span
              key={t.id}
              className="pinboard-list-stat-pill pinboard-ui-label"
              style={{ borderColor: col, color: col }}
            >
              <span className="pinboard-list-dot" style={{ background: col }} />
              {c} {t.name}
            </span>
          );
        })}
      </div>

      <div className="pinboard-list-layout">
        <aside className="pinboard-list-sidebar">
          <label className="pinboard-ui-label pinboard-list-label">Search</label>
          <input
            className="pinboard-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Title, body, tags…"
          />

          <p className="pinboard-ui-label pinboard-list-label" style={{ marginTop: 16 }}>
            Types
          </p>
          <div className="pinboard-list-type-boxes">
            {sortedTypes.map((t) => (
              <label key={t.id} className="pinboard-list-type-row">
                <input type="checkbox" checked={typeSet.has(t.name)} onChange={() => toggleType(t.name)} />
                <span className="pinboard-list-dot" style={{ background: t.color }} />
                <span className="pinboard-ui-label" style={{ fontSize: 11 }}>
                  {t.name}
                </span>
              </label>
            ))}
          </div>

          <p className="pinboard-ui-label pinboard-list-label" style={{ marginTop: 16 }}>
            Sort
          </p>
          <select className="pinboard-select" value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="alpha">Alphabetical</option>
            <option value="type">Type</option>
          </select>

          <p className="pinboard-ui-label pinboard-list-label" style={{ marginTop: 16 }}>
            Tags
          </p>
          <div className="pinboard-list-tag-pills">
            {allTags.map((tg) => (
              <button
                key={tg}
                type="button"
                className={`pinboard-list-tag-pill${tagFilter === tg ? " pinboard-list-tag-pill--on" : ""}`}
                onClick={() => setTagFilter((c) => (c === tg ? null : tg))}
              >
                {tg}
              </button>
            ))}
            {allTags.length === 0 ? <span style={{ color: "#a8c8a0", fontSize: 12 }}>No tags yet</span> : null}
          </div>
        </aside>

        <div className="pinboard-list-results">
          {filtered.length === 0 ? (
            <div className="pinboard-list-empty">
              <WobblyPanel padding="28px 24px" minHeight={200} panelFill="rgba(12,22,14,0.75)">
                <div className="pinboard-list-empty-art" aria-hidden>
                  <svg viewBox="0 0 120 80" width={120} height={80}>
                    <ellipse cx="60" cy="72" rx="48" ry="6" fill="#0a1a0d" opacity="0.6" />
                    <path
                      d="M20 58 Q35 40 50 52 Q65 35 80 48 Q95 32 100 50"
                      fill="none"
                      stroke="#2d4a35"
                      strokeWidth="1.2"
                    />
                    <circle cx="38" cy="38" r="3" fill="#4a7c59" opacity="0.5" />
                    <circle cx="72" cy="42" r="2.5" fill="#d4a853" opacity="0.35" />
                    <text x="60" y="28" textAnchor="middle" fill="#6a8a6a" fontSize="11" fontFamily="Georgia,serif">
                      ∅
                    </text>
                  </svg>
                </div>
                <h3 style={{ fontFamily: "Georgia, serif", fontSize: 20, color: "#e8f0e4", marginTop: 8, textAlign: "center" }}>
                  No nodes match
                </h3>
                <p style={{ fontSize: 13, color: "#a8c8a0", textAlign: "center", marginTop: 10, lineHeight: 1.45 }}>
                  Try clearing filters, or plant your first ideas on the <strong style={{ color: "#d4a853" }}>map</strong>.
                </p>
              </WobblyPanel>
            </div>
          ) : (
            <ul className="pinboard-list-cards">
              {filtered.map((n) => {
                const cc = connectionCount(n.id, connections);
                const col = colorFor(n.type);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      className="pinboard-list-card-btn"
                      onClick={() => onOpenNode(n.id)}
                    >
                      <WobblyPanel padding="14px 16px" minHeight={0} panelFill="rgba(15,30,18,0.88)">
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 }}>
                          <span
                            className="pinboard-list-card-type"
                            style={{
                              fontSize: 9,
                              letterSpacing: "0.08em",
                              color: col,
                              borderColor: col,
                            }}
                          >
                            {n.type}
                          </span>
                          <span className="pinboard-ui-label" style={{ fontSize: 10, color: "#a8c8a0" }}>
                            {cc} link{cc === 1 ? "" : "s"}
                          </span>
                        </div>
                        <h3 className="pinboard-list-card-title">{truncate(n.title, 120)}</h3>
                        {n.body ? (
                          <p className="pinboard-list-card-body">{truncate(n.body.replace(/\s+/g, " "), 200)}</p>
                        ) : null}
                        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                          <button
                            type="button"
                            className="pinboard-btn pinboard-btn--active"
                            style={{ fontSize: 11, padding: "6px 12px" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onViewOnMap(n.id);
                            }}
                          >
                            View on map
                          </button>
                        </div>
                      </WobblyPanel>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
