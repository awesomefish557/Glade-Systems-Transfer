import { useMemo } from "react";

/** Botanical grass strip — same generative approach as `fitness-ui` GrassFooter. */
export function GrassFooter() {
  const blades = useMemo(() => {
    const out: { d: string; thick: number; col: string }[] = [];
    for (let x = 0; x < 1400; x += 2 + Math.random() * 4) {
      const h = 8 + Math.random() * 22;
      const bend = (Math.random() - 0.5) * 14;
      const thick = 0.6 + Math.random() * 2.4;
      const col = Math.random() > 0.4 ? "#0a1a0d" : "#081508";
      const d = `M${x} 55 C${x + bend * 0.3} ${55 - h * 0.4} ${x + bend * 0.7} ${55 - h * 0.7} ${x + bend} ${55 - h}`;
      out.push({ d, thick, col });
    }
    return out;
  }, []);

  return (
    <svg
      className="pinboard-grass"
      viewBox="0 0 1400 55"
      preserveAspectRatio="xMidYMax meet"
      style={{ height: "min(64px, 12vh)" }}
      aria-hidden
    >
      <g strokeLinecap="round" fill="none">
        {blades.map((b, i) => (
          <path key={i} d={b.d} stroke={b.col} strokeWidth={b.thick} />
        ))}
      </g>
    </svg>
  );
}
