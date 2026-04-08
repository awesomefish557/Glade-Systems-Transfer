"""
Live paper-trading dashboard: append daily metrics, print P&L, BSS trend, milestones vs FTSE.
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import config
from data.fetchers import fetch_vix
from paper_trading_simulator import PaperTradingSimulator


def _metrics_path() -> Path:
    return config.DATA_DIR / str(config.PAPER_TRADING["metrics_filename"])


def _parse_metric_date(s: str) -> Optional[date]:
    try:
        return date.fromisoformat(s[:10])
    except (TypeError, ValueError):
        return None


class LiveDashboard:
    """Append JSON metrics and print a text dashboard."""

    def __init__(self) -> None:
        self.simulator = PaperTradingSimulator()
        self.metrics_file = _metrics_path()

    def log_daily_metrics(self) -> Dict[str, Any]:
        summary = self.simulator.get_summary()
        self.simulator.save_paper_state()

        metrics = {
            "date": date.today().isoformat(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "portfolio_value": summary["portfolio_value"],
            "gain_loss": summary["gain_loss"],
            "pct_return": summary["pct_return"],
            "bss": summary["bss"],
            "holdings_count": summary["holdings_count"],
            "benchmark_pct_return": summary.get("benchmark_pct_return"),
            "excess_vs_ftse_pct": summary.get("excess_vs_ftse_pct"),
            "vix": fetch_vix(),
        }

        all_metrics: List[Dict[str, Any]] = []
        if self.metrics_file.is_file():
            try:
                all_metrics = json.loads(self.metrics_file.read_text(encoding="utf-8"))
                if not isinstance(all_metrics, list):
                    all_metrics = []
            except (json.JSONDecodeError, OSError):
                all_metrics = []

        # Replace same calendar day if re-run
        d0 = metrics["date"]
        all_metrics = [m for m in all_metrics if _parse_metric_date(str(m.get("date", ""))) != date.fromisoformat(d0)]
        all_metrics.append(metrics)
        all_metrics.sort(key=lambda m: str(m.get("date", "")))

        self.metrics_file.parent.mkdir(parents=True, exist_ok=True)
        self.metrics_file.write_text(json.dumps(all_metrics, indent=2), encoding="utf-8")
        return metrics

    def get_trend(self, days: int = 30) -> Optional[Dict[str, Any]]:
        if not self.metrics_file.is_file():
            return None
        try:
            all_metrics: List[Dict[str, Any]] = json.loads(
                self.metrics_file.read_text(encoding="utf-8")
            )
        except (json.JSONDecodeError, OSError):
            return None

        cutoff = date.today() - timedelta(days=days)
        recent: List[Dict[str, Any]] = []
        for m in all_metrics:
            pd = _parse_metric_date(str(m.get("date", "")))
            if pd is not None and pd >= cutoff:
                recent.append(m)
        if not recent:
            return None

        bss_vals = [float(m["bss"]) for m in recent if m.get("bss") is not None]
        if not bss_vals:
            return None

        return {
            "start_value": float(recent[0]["portfolio_value"]),
            "end_value": float(recent[-1]["portfolio_value"]),
            "avg_bss": sum(bss_vals) / len(bss_vals),
            "min_bss": min(bss_vals),
            "max_bss": max(bss_vals),
            "days": len(recent),
        }

    def print_dashboard(self) -> None:
        summary = self.simulator.get_summary()
        trend_30 = self.get_trend(30)
        thr = float(config.BSS_TARGETS["paper_trading_threshold_0_100"])
        m42 = float(config.MILESTONES["level_1"]["target"])
        m70 = float(config.MILESTONES["level_2"]["target"])
        m100 = float(config.MILESTONES["level_3"]["target"])

        print("\n" + "=" * 60)
        print("COSMO LIVE PAPER TRADING DASHBOARD")
        print("=" * 60)

        print("\nPORTFOLIO")
        print(f"  Value:           GBP {summary['portfolio_value']:,.2f}")
        print(f"  Gain/loss:       GBP {summary['gain_loss']:,.2f} ({summary['pct_return']:.2f}%)")
        print(f"  Holdings:        {summary['holdings_count']}")

        print("\nPERFORMANCE")
        print(f"  Paper BSS:       {summary['bss']:.2f}")
        print(f"  Target (live):   {thr:.1f}+ on 0-100 scale after 90d paper")
        if summary.get("benchmark_pct_return") is not None:
            print(f"  FTSE (since start): {summary['benchmark_pct_return']:.2f}%")
        if summary.get("excess_vs_ftse_pct") is not None:
            print(f"  Excess vs FTSE:  {summary['excess_vs_ftse_pct']:.2f}%")

        if trend_30:
            print("\n30-DAY TREND (from metrics file)")
            print(f"  Avg BSS:         {trend_30['avg_bss']:.2f}")
            print(f"  Min BSS:         {trend_30['min_bss']:.2f}")
            print(f"  Max BSS:         {trend_30['max_bss']:.2f}")
            print(f"  Days logged:     {trend_30['days']}")

        print("\nMILESTONES (paper NAV vs targets)")
        pv = max(summary["portfolio_value"], 1.0)
        print(f"  Level 1 (GBP {m42:,.0f}):  {100.0 * pv / m42:.1f}%")
        print(f"  Level 2 (GBP {m70:,.0f}):  {100.0 * pv / m70:.1f}%")
        print(f"  Level 3 (GBP {m100:,.0f}): {100.0 * pv / m100:.1f}%")

        print("\nRISK")
        vix = fetch_vix()
        if vix is not None:
            print(f"  VIX:             {vix:.1f}")
        print(f"  Cash buffer:     GBP {summary['cash_available']:,.2f}")
        print("\n" + "=" * 60)


def main() -> None:
    dash = LiveDashboard()
    dash.log_daily_metrics()
    dash.print_dashboard()


if __name__ == "__main__":
    main()
