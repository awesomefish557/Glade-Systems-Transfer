import type { CSSProperties, ReactNode } from "react";

export function WobblyPanel({
  children,
  padding = "12px 14px",
  minHeight = 48,
  style,
  panelFill = "rgba(15,30,18,0.92)",
}: {
  children: ReactNode;
  padding?: string;
  minHeight?: number;
  style?: CSSProperties;
  /** SVG rect fill behind displacement filter */
  panelFill?: string;
}) {
  return (
    <div
      className="wobbly-panel-shell"
      style={{
        position: "relative",
        border: "none",
        borderRadius: 0,
        boxShadow: "none",
        minHeight,
        ...style,
      }}
    >
      <svg
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        viewBox="0 0 200 100"
        preserveAspectRatio="none"
        filter="url(#rough)"
        aria-hidden
      >
        <rect
          x="1"
          y="1"
          width="198"
          height="98"
          rx="1"
          ry="1"
          fill={panelFill}
          stroke="#2d4a35"
          strokeWidth="0.8"
          vectorEffect="nonScalingStroke"
        />
      </svg>
      <div className="pinboard-panel-inner" style={{ position: "relative", padding, zIndex: 1 }}>
        {children}
      </div>
    </div>
  );
}
