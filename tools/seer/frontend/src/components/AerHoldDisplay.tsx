import type { AerHoldWarning } from "../types";
import { formatPct, resolveAerHoldWarning } from "../utils";

export function AerHoldDisplay({
  aer,
  daysToResolution,
  aerHoldWarning,
  aerWarning,
  decimals = 1
}: {
  aer: number;
  daysToResolution: number;
  aerHoldWarning?: AerHoldWarning;
  aerWarning?: "amber" | "red";
  decimals?: number;
}) {
  const w = resolveAerHoldWarning({
    daysToResolution,
    aerHoldWarning,
    aerWarning
  });
  return (
    <div className="aer-cell-wrap">
      <span>{formatPct(aer, decimals)}</span>
      {w ? (
        <span
          className={`aer-hold-caveat aer-hold-caveat--${w.severity}`}
          title={w.message}
        >
          {w.message}
        </span>
      ) : null}
    </div>
  );
}
