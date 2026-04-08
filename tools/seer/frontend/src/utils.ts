/** UK tax year containing `reference` (UTC, 6 Apr → 5 Apr). */
export function ukTaxYearBoundsUTC(reference: Date): { start: Date; end: Date } {
  const y = reference.getUTCFullYear();
  const m = reference.getUTCMonth();
  const d = reference.getUTCDate();
  const onOrAfterApril6 = m > 3 || (m === 3 && d >= 6);
  const startYear = onOrAfterApril6 ? y : y - 1;
  const start = new Date(Date.UTC(startYear, 3, 6, 0, 0, 0, 0));
  const end = new Date(Date.UTC(startYear + 1, 3, 5, 23, 59, 59, 999));
  return { start, end };
}

export function parseDbDate(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isNaN(t) ? null : t;
}

export function formatPct(x: number, decimals = 1): string {
  if (!Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(decimals)}%`;
}

export function formatGbp(x: number, decimals = 2): string {
  if (!Number.isFinite(x)) return "—";
  const sign = x < 0 ? "−" : "";
  return `${sign}£${Math.abs(x).toFixed(decimals)}`;
}

export function calcAnnualisedReturn(
  price: number,
  daysToResolution: number
): number {
  if (price <= 0 || daysToResolution <= 0) return 0;
  return ((1 / price - 1) * 365) / daysToResolution;
}

export function calcTimeToDoubleDays(aer: number): number | null {
  if (aer <= 0 || !Number.isFinite(aer)) return null;
  return 72 / (aer * 100);
}

export function daysToResolution(endDate: string): number {
  const end = Date.parse(endDate);
  if (Number.isNaN(end)) return 1;
  const d = (end - Date.now()) / 86_400_000;
  return Math.max(1, Math.round(d));
}

/** Contracts-style MTM for binary at current mid. */
export function unrealizedPnl(
  stake: number,
  entryPrice: number,
  currentPrice: number
): number {
  if (entryPrice <= 0) return 0;
  const contracts = stake / entryPrice;
  return contracts * currentPrice - stake;
}

export function currentPriceForDirection(
  direction: string,
  yes: number | null,
  no: number | null
): number | null {
  if (direction === "YES") return yes;
  if (direction === "NO") return no;
  return null;
}

export function signalToTag(signal: string): string | null {
  const s = signal.toLowerCase();
  if (s.includes("near cert") || s.includes("near_cert")) return "NEAR_CERT";
  if (s.includes("longshot")) return "LONGSHOT";
  if (s.includes("attention decay") || s.includes("decay")) return "DECAY";
  if (s.includes("calibration gap") || s.includes("calibration"))
    return "CALIBRATION";
  if (s.includes("recency")) return "RECENCY";
  if (s.includes("round-number") || s.includes("anchoring")) return "ANCHOR";
  if (s.includes("compound")) return "COMPOUND";
  if (s.includes("extreme lean") || (s.includes("mechanical") && s.includes("85")))
    return "EXTREME";
  if (s.includes("aer > 8%") || (s.includes("mechanical") && s.includes("8%")))
    return "AER>8";
  return null;
}

export function tagsFromSignals(signals: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const sig of signals) {
    const t = signalToTag(sig);
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.slice(0, 6);
}

/** Compact number for matched-volume style stats (USD-equivalent scale from feeds). */
export function formatCompactVolume(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return `${Math.round(n)}`;
}
