/**
 * Supermarket labour units: relate £ amounts to one gross wage week (~£430)
 * and, for smaller magnitudes, checkout hours at NLW scale.
 */
export const SUPERMARKET_WEEK_GBP = 430;

const CHECKOUT_HOUR_GBP = 11.44;

function trimFixedMag(mag: number, decimals: number): string {
  let s = mag.toFixed(decimals);
  if (s.includes(".")) {
    s = s.replace(/0+$/, "").replace(/\.$/, "");
  }
  return s || "0";
}

export function gbpToSupermarketWeeks(gbp: number): number {
  if (!Number.isFinite(gbp)) return 0;
  return gbp / SUPERMARKET_WEEK_GBP;
}

/** Human-readable labour equivalent: "0.11 SW" or "3.2h of checkout". */
export function formatLabour(gbp: number): string {
  if (!Number.isFinite(gbp)) return "—";
  if (gbp === 0) return "0 SW";
  const sign = gbp < 0 ? "-" : "";
  const absGbp = Math.abs(gbp);
  const sw = absGbp / SUPERMARKET_WEEK_GBP;
  if (sw >= 0.01) {
    const decimals = sw >= 1 ? 1 : 2;
    return `${sign}${trimFixedMag(sw, decimals)} SW`;
  }
  const hours = absGbp / CHECKOUT_HOUR_GBP;
  return `${sign}${trimFixedMag(hours, 1)}h of checkout`;
}

/** Annual rate in supermarket weeks, e.g. "2.68 SW/yr". */
export function formatSwPerYear(gbpPerYear: number): string {
  if (!Number.isFinite(gbpPerYear)) return "—";
  if (gbpPerYear === 0) return "0 SW/yr";
  const sign = gbpPerYear < 0 ? "-" : "";
  const sw = Math.abs(gbpPerYear) / SUPERMARKET_WEEK_GBP;
  return `${sign}${sw.toFixed(2)} SW/yr`;
}

/** Fraction of one SW for inline copy (e.g. toward allowance). */
export function formatSwFractionLabel(gbp: number): string {
  if (!Number.isFinite(gbp)) return "—";
  if (gbp === 0) return "0";
  const sign = gbp < 0 ? "-" : "";
  const sw = Math.abs(gbp) / SUPERMARKET_WEEK_GBP;
  return `${sign}${trimFixedMag(sw, 2)}`;
}
