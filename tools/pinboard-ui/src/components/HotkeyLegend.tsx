import { useState } from "react";
import { WobblyPanel } from "./WobblyPanel";

type Row = { keys: string; desc: string };
type Section = { header: string; rows: Row[] };

const SECTIONS: Section[] = [
  {
    header: "Canvas modes",
    rows: [
      { keys: "F", desc: "focus mode (node + neighbours)" },
      { keys: "O", desc: "orbit mode (selected node)" },
    ],
  },
  {
    header: "Display",
    rows: [
      { keys: "C", desc: "toggle connections" },
      { keys: "T", desc: "hold to show types" },
    ],
  },
  {
    header: "",
    rows: [
      { keys: "Shift+drag", desc: "draw connection" },
      { keys: "Double-click", desc: "open node detail" },
      { keys: "Scroll", desc: "zoom" },
      { keys: "Drag", desc: "pan" },
    ],
  },
];

export function HotkeyLegend() {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        position: "fixed",
        right: 14,
        bottom: 14,
        zIndex: 80,
        maxWidth: "min(280px, 92vw)",
      }}
    >
      {open ? (
        <WobblyPanel padding="12px 14px" minHeight={0} panelFill="rgba(8, 18, 10, 0.94)">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="pinboard-ui-label"
            style={{
              position: "absolute",
              top: 8,
              right: 10,
              background: "none",
              border: "none",
              color: "#d4a853",
              cursor: "pointer",
              fontSize: 14,
              padding: 4,
            }}
            aria-label="Collapse hotkeys"
          >
            ✕
          </button>
          <p className="pinboard-ui-label" style={{ fontSize: 9, letterSpacing: "0.14em", color: "#d4a853", marginBottom: 10 }}>
            Shortcuts
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingRight: 20 }}>
            {SECTIONS.map((section) => (
              <div key={section.header || "general"}>
                {section.header ? (
                  <p
                    className="pinboard-ui-label"
                    style={{ fontSize: 8, letterSpacing: "0.12em", color: "#6a9a6a", marginBottom: 6 }}
                  >
                    {section.header}
                  </p>
                ) : null}
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                  {section.rows.map((row) => (
                    <li key={row.keys} style={{ fontFamily: "Arial, sans-serif", fontSize: 12, color: "#a8c8a0", lineHeight: 1.35 }}>
                      <span style={{ color: "#d4a853", fontWeight: 600 }}>{row.keys}</span>
                      <span style={{ color: "#6a8a6a" }}> — </span>
                      {row.desc}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </WobblyPanel>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pinboard-btn"
          aria-label="Show keyboard shortcuts"
          title="Keyboard shortcuts"
          style={{ padding: "8px 12px", fontSize: 16 }}
        >
          ⌨
        </button>
      )}
    </div>
  );
}
