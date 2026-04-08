import { WobblyPanel } from "./WobblyPanel";

export function SearchOverlay({
  value,
  onChange,
  onCommit,
  onAbandonClear,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Lock current text as the canvas filter and close (Tab, 🔍 while open, Escape when non-empty). */
  onCommit: () => void;
  /** Escape with empty field: close and clear any locked search filter. */
  onAbandonClear: () => void;
  /** Backdrop click: close and discard draft; locked filter unchanged. */
  onCancel: () => void;
}) {
  return (
    <>
      <div
        role="presentation"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 380,
          background: "rgba(2, 8, 4, 0.72)",
        }}
        onClick={onCancel}
      />
      <div
        style={{
          position: "fixed",
          top: "18%",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 390,
          width: "min(420px, 92vw)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <WobblyPanel padding="16px 18px" minHeight={0}>
          <p className="pinboard-ui-label" style={{ fontSize: 9, letterSpacing: "0.14em", color: "#4a7c59", marginBottom: 10 }}>
            Search nodes
          </p>
          <input
            className="pinboard-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Title or body…"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Tab") {
                e.preventDefault();
                onCommit();
                return;
              }
              if (e.key === "Escape") {
                if (value.trim()) onCommit();
                else onAbandonClear();
              }
            }}
          />
          <p style={{ fontSize: 12, color: "#6a8a6a", marginTop: 10, fontFamily: "Arial, sans-serif" }}>
            Tab, 🔍, or Escape applies the filter and closes this panel (Escape with nothing typed clears the filter).
            Click outside to cancel edits. With a filter on the map, 🔍 clears it.
          </p>
        </WobblyPanel>
      </div>
    </>
  );
}
