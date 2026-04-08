import type { GraphNodeType } from "../types";

export function Toolbar({
  nodeTypes,
  filterType,
  onFilterType,
  onAddNode,
  onSearch,
  searchFilterActive,
  loadingBayCount,
  onLoadingBay,
  tutorLoading,
  onTutorScan,
  onResolve,
  resolveBusy,
  topOffset = 58,
}: {
  nodeTypes: GraphNodeType[];
  filterType: string | "ALL";
  onFilterType: (t: string | "ALL") => void;
  onAddNode: () => void;
  onSearch: () => void;
  /** True when a search filter is locked on the canvas (overlay closed). */
  searchFilterActive: boolean;
  loadingBayCount: number;
  onLoadingBay?: () => void;
  tutorLoading: boolean;
  onTutorScan: () => void;
  onResolve: () => void;
  resolveBusy?: boolean;
  /** px from top — leave room for main nav tabs */
  topOffset?: number;
}) {
  return (
    <>
    <div
      style={{
        position: "fixed",
        top: topOffset,
        left: 14,
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 10,
        maxWidth: "min(96vw, 360px)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <button type="button" className="pinboard-btn pinboard-btn--active" onClick={onAddNode}>
          + Add Node
        </button>
        <button
          type="button"
          className="pinboard-btn"
          onClick={onSearch}
          aria-label={searchFilterActive ? "Clear search filter" : "Search"}
          aria-pressed={searchFilterActive}
          title={searchFilterActive ? "Clear search filter" : "Search nodes on the map"}
          style={
            searchFilterActive
              ? {
                  boxShadow: "0 0 0 2px rgba(212, 168, 83, 0.65), 0 0 14px rgba(212, 168, 83, 0.25)",
                  borderColor: "#e8c86a",
                  background: "rgba(212, 168, 83, 0.22)",
                  color: "#f5e6b8",
                }
              : undefined
          }
        >
          🔍
        </button>
        <button
          type="button"
          className="pinboard-btn"
          onClick={onLoadingBay}
          style={{ position: "relative", paddingRight: loadingBayCount > 0 ? 14 : undefined }}
          title="Loading bay inbox"
        >
          📥 Loading Bay
          {loadingBayCount > 0 ? (
            <span
              style={{
                position: "absolute",
                top: -6,
                right: -6,
                minWidth: 18,
                height: 18,
                padding: "0 5px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#cc2222",
                color: "#fff",
                borderRadius: 999,
                fontSize: 10,
                fontFamily: "Arial, sans-serif",
                fontWeight: 700,
                lineHeight: 1,
                boxShadow: "0 0 0 2px rgba(5,13,6,0.97)",
              }}
            >
              {loadingBayCount > 99 ? "99+" : loadingBayCount}
            </span>
          ) : null}
        </button>
        <button type="button" className="pinboard-btn" onClick={onTutorScan} disabled={tutorLoading}>
          {tutorLoading ? "… Tutor" : "🎓 Tutor Scan"}
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <button
          key="ALL"
          type="button"
          className={`pinboard-btn${filterType === "ALL" ? " pinboard-btn--active" : ""}`}
          onClick={() => onFilterType("ALL")}
          style={{ fontSize: 9, padding: "5px 8px" }}
        >
          ALL
        </button>
        {[...nodeTypes]
          .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
          .map((t) => (
            <button
              key={t.id}
              type="button"
              className={`pinboard-btn${filterType === t.name ? " pinboard-btn--active" : ""}`}
              onClick={() => onFilterType(t.name)}
              style={{
                fontSize: 9,
                padding: "5px 8px",
                borderColor: t.color,
                color: filterType === t.name ? "#f5e6b8" : t.color,
                boxShadow:
                  filterType === t.name ? `0 0 0 1px ${t.color}, inset 0 0 12px rgba(255,255,255,0.06)` : undefined,
              }}
            >
              {t.name}
            </button>
          ))}
      </div>
    </div>

    <div
      style={{
        position: "fixed",
        top: topOffset,
        right: 14,
        zIndex: 60,
      }}
    >
      <button
        type="button"
        className="pinboard-btn"
        onClick={onResolve}
        disabled={resolveBusy}
        title="Reorganise the map by connection strength"
        style={{
          fontFamily: "Georgia, serif",
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "0.06em",
          padding: "10px 18px",
          borderColor: "#d4a853",
          color: "#f0e6c8",
          boxShadow: "0 0 0 1px rgba(212, 168, 83, 0.35), inset 0 0 20px rgba(212, 168, 83, 0.06)",
        }}
      >
        {resolveBusy ? "⬡ Resolving…" : "⬡ RESOLVE"}
      </button>
    </div>
    </>
  );
}
