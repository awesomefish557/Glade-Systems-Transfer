import { useState } from "react";
import { WobblyPanel } from "./WobblyPanel";

export function ConnectionPopover({
  clientX,
  clientY,
  onSubmit,
  onCancel,
}: {
  clientX: number;
  clientY: number;
  onSubmit: (label: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");

  return (
    <>
      <div
        role="presentation"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 400,
          background: "rgba(0,0,0,0.35)",
        }}
        onClick={onCancel}
      />
      <div style={{ position: "fixed", left: clientX, top: clientY, zIndex: 410, transform: "translate(-50%, 8px)" }}>
        <WobblyPanel padding="12px 14px" minHeight={0} style={{ minWidth: 220 }}>
          <p className="pinboard-ui-label" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#4a7c59", marginBottom: 8 }}>
            Connection label
          </p>
          <input
            className="pinboard-input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Optional"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancel();
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit(label.trim());
              }
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <button type="button" className="pinboard-btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="pinboard-btn pinboard-btn--active" onClick={() => onSubmit(label.trim())}>
              Create
            </button>
          </div>
        </WobblyPanel>
      </div>
    </>
  );
}
