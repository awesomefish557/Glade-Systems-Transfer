"""
Random-quarter backtest: UK benchmark daily returns → BSS (0–100) as a regime-aware proxy.

Uses ^FTSE history per calendar quarter (1990–present when Yahoo has data).
Pass criteria: average BSS ≥ config and worst quarter ≥ crash floor (see `BACKTEST`).
"""

from __future__ import annotations

import calendar
import logging
import random
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import yfinance as yf

import config
from scoring.bss import BSS_Calculator

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(message)s")


def _quarter_start_end(year: int, quarter: int) -> Tuple[str, str]:
    """ISO start/end dates for calendar quarter (end inclusive for yfinance span)."""
    start_month = (quarter - 1) * 3 + 1
    end_month = quarter * 3
    last_day = calendar.monthrange(year, end_month)[1]
    start = f"{year}-{start_month:02d}-01"
    end = f"{year}-{end_month:02d}-{last_day:02d}"
    return start, end


def _yf_history_close_returns(symbol: str, start: str, end: str) -> List[float]:
    """
    Daily simple returns from adjusted close between start and end (inclusive-ish).

    yfinance `end` is exclusive for some versions — pad end by one day.
    """
    try:
        end_dt = datetime.strptime(end, "%Y-%m-%d").date() + timedelta(days=1)
        t = yf.Ticker(symbol)
        hist = t.history(start=start, end=end_dt.isoformat(), auto_adjust=True)
        if hist is None or hist.empty or "Close" not in hist.columns:
            return []
        s = hist["Close"].pct_change().dropna()
        return [float(x) for x in s.tolist() if x == x]
    except Exception as exc:  # noqa: BLE001
        logger.debug("history failed %s %s-%s: %s", symbol, start, end, exc)
        return []


def _infer_regime_from_vix(start: str, end: str) -> str:
    """Map quarter-average VIX to bull/sideways/bear/crisis."""
    try:
        end_dt = datetime.strptime(end, "%Y-%m-%d").date() + timedelta(days=1)
        v = yf.Ticker("^VIX").history(start=start, end=end_dt.isoformat(), auto_adjust=True)
        if v is None or v.empty:
            return "sideways"
        m = float(v["Close"].mean())
        if m >= config.REGIME_THRESHOLDS["crisis"]["vix_min"]:
            return "crisis"
        if m >= config.REGIME_THRESHOLDS["bear"]["vix_max"]:
            return "bear"
        if m <= config.REGIME_THRESHOLDS["bull"]["vix_max"]:
            return "bull"
        return "sideways"
    except Exception as exc:  # noqa: BLE001
        logger.debug("VIX regime fallback: %s", exc)
        return "sideways"


class BacktestEngine:
    """
    Sample random historical quarters; score each with BSS on FTSE daily returns.

    This is a *market-proxy* sanity check until full position-level backtest exists.
    """

    def __init__(
        self,
        start_year: Optional[int] = None,
        end_year: Optional[int] = None,
        benchmark: Optional[str] = None,
    ) -> None:
        bt = config.BACKTEST
        self.start_year = int(start_year if start_year is not None else bt["start_year"])
        self.end_year = int(end_year if end_year is not None else bt["end_year"])
        self.benchmark = str(benchmark if benchmark is not None else bt["uk_benchmark_symbol"])
        self.quarters = self._generate_quarters()
        self.results: Dict[str, Any] = {}
        self.bss_calculator = BSS_Calculator()

    def _generate_quarters(self) -> List[Tuple[int, int]]:
        out: List[Tuple[int, int]] = []
        for year in range(self.start_year, self.end_year + 1):
            for q in range(1, 5):
                out.append((year, q))
        return out

    def pick_random_quarters(self, count: int = 20) -> List[Tuple[int, int]]:
        n = min(int(count), len(self.quarters))
        return random.sample(self.quarters, n)

    def run_quarter_backtest(self, year: int, quarter: int) -> Dict[str, Any]:
        start, end = _quarter_start_end(year, quarter)
        regime = _infer_regime_from_vix(start, end)
        rets = _yf_history_close_returns(self.benchmark, start, end)
        if len(rets) < 5:
            # Sparse history (very old dates or bad symbol) — bounded synthetic fallback
            logger.warning("Sparse data for %s Q%d %s; using small synthetic return path", year, quarter, self.benchmark)
            rng = random.Random(year * 10 + quarter)
            rets = [rng.uniform(-0.02, 0.02) for _ in range(40)]

        bss = self.bss_calculator.calculate_bee_bss(
            bee_name="value_bee",
            holdings=[],
            returns=rets,
            regime=regime,
        )
        return {
            "year": year,
            "quarter": quarter,
            "date_range": f"{start} to {end}",
            "regime": regime,
            "bss": bss,
            "num_days": len(rets),
        }

    def run_full_backtest(self, num_quarters: Optional[int] = None) -> Dict[str, Any]:
        bt = config.BACKTEST
        nq = int(num_quarters if num_quarters is not None else bt["random_quarters_count"])
        seed = bt.get("random_seed")
        if seed is not None:
            random.seed(int(seed))

        picks = self.pick_random_quarters(nq)
        print(f"\nCOSMO BACKTEST: {len(picks)} random quarters ({self.start_year}-{self.end_year})")
        print(f"Benchmark: {self.benchmark} | BSS scale: 0-100")
        print("=" * 60)

        per_quarter: List[Dict[str, Any]] = []
        bss_scores: List[float] = []

        for year, quarter in picks:
            row = self.run_quarter_backtest(year, quarter)
            per_quarter.append(row)
            b = float(row["bss"])
            bss_scores.append(b)
            thr = float(config.BSS_TARGETS["backtest_avg_min_0_100"])
            floor = float(config.BSS_TARGETS["backtest_quarter_floor_0_100"])
            status = "OK" if b >= thr else "+" if b >= floor else "LOW"
            print(f"  [{status}] Q{quarter} {year} ({row['regime']}): BSS {b:.2f}  n={row['num_days']}")

        avg_bss = float(sum(bss_scores) / len(bss_scores)) if bss_scores else 0.0
        min_bss = float(min(bss_scores)) if bss_scores else 0.0
        max_bss = float(max(bss_scores)) if bss_scores else 0.0

        avg_ok = avg_bss >= float(config.BSS_TARGETS["backtest_avg_min_0_100"])
        floor_ok = min_bss >= float(config.BSS_TARGETS["backtest_quarter_floor_0_100"])
        ready = avg_ok and floor_ok

        print("\n" + "=" * 60)
        print(f"Average BSS: {avg_bss:.2f}  (backtest pass ≥ {config.BSS_TARGETS['backtest_avg_min_0_100']})")
        print(f"Min BSS:     {min_bss:.2f}  (worst quarter ≥ {config.BSS_TARGETS['backtest_quarter_floor_0_100']})")
        print(f"Max BSS:     {max_bss:.2f}")
        if ready:
            print("\nREADY FOR PAPER TRADING (avg and floor thresholds met).")
        else:
            print("\nNOT READY YET (raise avg BSS or improve worst quarters / gates).")
            if not avg_ok:
                print(f"  - Average {avg_bss:.2f} < {config.BSS_TARGETS['backtest_avg_min_0_100']}")
            if not floor_ok:
                print(f"  - Weakest quarter {min_bss:.2f} < {config.BSS_TARGETS['backtest_quarter_floor_0_100']}")

        self.results = {
            "quarters_tested": len(picks),
            "avg_bss": avg_bss,
            "min_bss": min_bss,
            "max_bss": max_bss,
            "bss_scores": bss_scores,
            "per_quarter": per_quarter,
            "ready_for_paper": ready,
            "avg_threshold_met": avg_ok,
            "floor_threshold_met": floor_ok,
        }
        return self.results


def print_results_dashboard(results: Dict[str, Any]) -> None:
    """Compact post-run panel for logs or week2 orchestration."""
    print("\n--- Backtest dashboard ---")
    for k in ("quarters_tested", "avg_bss", "min_bss", "max_bss", "ready_for_paper"):
        if k in results:
            print(f"  {k}: {results[k]}")


def main() -> Dict[str, Any]:
    engine = BacktestEngine()
    results = engine.run_full_backtest()
    print_results_dashboard(results)
    return results


if __name__ == "__main__":
    out = main()
    raise SystemExit(0 if out.get("ready_for_paper") else 1)
