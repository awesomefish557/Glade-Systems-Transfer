/**
 * Fixed labour-equivalent constants for converting £ amounts to supermarket weeks (SW),
 * working years (WY), and checkout hours. Used across Glade tools for human-scale display.
 */
const HOURLY_RATE = 11.71; // £/hour
const HOURS_PER_WEEK = 36.7;
const HOLIDAY_WEEKS = 5.6; // UK statutory minimum
const WORKING_WEEKS_PY = 46.4; // 52 - 5.6
/** 1 Supermarket Week in £ (36.7 × 11.71) */
const SW = 429.76;
/** 1 Working Year in £ (46.4 × SW) */
const WY = 19940.86;

function roundDp(value: number, decimalPlaces: number): number {
  const factor = 10 ** decimalPlaces;
  return Math.round(value * factor) / factor;
}

/**
 * Converts a monetary amount (£) to supermarket weeks (SW), rounded to two decimal places.
 */
export function toSW(amount: number): number {
  return roundDp(amount / SW, 2);
}

/**
 * Converts a monetary amount (£) to working-year equivalents (WY), rounded to two decimal places.
 */
export function toWY(amount: number): number {
  return roundDp(amount / WY, 2);
}

/**
 * Formats a monetary amount (£) as supermarket weeks, e.g. `"0.63 SW"` or `"2.68 SW"`.
 */
export function formatSW(amount: number): string {
  return `${toSW(amount).toFixed(2)} SW`;
}

/**
 * Formats a monetary amount (£) as working years, e.g. `"2.31 WY"`.
 */
export function formatWY(amount: number): string {
  return `${toWY(amount).toFixed(2)} WY`;
}

/**
 * Picks the most readable labour string: WY if ≥ 1, else SW if ≥ 1, else checkout hours (1dp).
 */
export function formatLabour(amount: number): string {
  if (toWY(amount) >= 1) return formatWY(amount);
  if (toSW(amount) >= 1) return formatSW(amount);
  const hours = roundDp(amount / HOURLY_RATE, 1);
  return `${hours.toFixed(1)}h of checkout`;
}

/** Lifetime totals: supermarket weeks, working-year equivalents, and a combined display string. */
export type AnnualToLifetimeResult = {
  sw: number;
  wy: number;
  formatted: string;
};

/**
 * Scales an annual £ amount over a working lifetime and returns SW/WY equivalents plus a combined label.
 *
 * @param annualAmount — recurring amount per year (£)
 * @param workingYears — career span in years (default 40)
 */
export function annualToLifetime(
  annualAmount: number,
  workingYears: number = 40
): AnnualToLifetimeResult {
  const total = annualAmount * workingYears;
  const sw = toSW(total);
  const wy = toWY(total);
  const formatted = `${sw.toFixed(2)} SW · ${wy.toFixed(2)} working years of wages`;
  return { sw, wy, formatted };
}
