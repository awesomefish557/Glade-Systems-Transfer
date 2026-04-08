"""
Week 3: verify tests, run one paper assessment, show live dashboard (90-day plan in stdout).

Usage (from `cosmo/`):

  python week3_setup.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import config


def run_command(argv: list[str], description: str, cwd: Path) -> bool:
    print(f"\n{'=' * 60}")
    print(description)
    print("=" * 60)
    try:
        r = subprocess.run(argv, cwd=cwd, check=False)
        if r.returncode == 0:
            print(f"OK: {description}")
            return True
        print(f"FAILED (exit {r.returncode}): {description}")
        return False
    except OSError as exc:
        print(f"ERROR: {description}: {exc}")
        return False


def main() -> bool:
    root = Path(__file__).resolve().parent
    py = sys.executable

    print("\nCOSMO WEEK 3: PAPER TRADING SETUP", flush=True)
    print("=" * 60, flush=True)
    print(f"\nDuration target: {config.PAPER_TRADING['duration_days']} days paper", flush=True)
    print("Goal: average paper BSS >= 65 (0-100) over the window; beat FTSE when benchmark is set.", flush=True)
    print("Capital at risk: GBP 0 (simulated)", flush=True)

    if not run_command(
        [py, "-m", "pytest", str(root / "tests" / "test_foundation.py"), "-q", "-m", "not slow"],
        "Step 1: Foundation tests",
        root,
    ):
        print("Fix failing tests before relying on paper mode.")
        return False

    if not run_command(
        [py, str(root / "paper_trading_simulator.py")],
        "Step 2: Paper simulator (daily assessment + save state)",
        root,
    ):
        return False

    if not run_command(
        [py, "-m", "monitoring.live_dashboard"],
        "Step 3: Live dashboard + metrics log",
        root,
    ):
        return False

    print("\n" + "=" * 60)
    print("WEEK 3 SETUP COMPLETE")
    print("=" * 60)
    print(
        """
NEXT STEPS (90-day plan)

1. Daily (~8:30 London): run paper_trading_simulator.py, then monitoring.live_dashboard.
2. Weekly: open data/monitoring_metrics.json for BSS trend and excess vs FTSE.
3. Monthly: review gates and universe; adjust config if needed.
4. Day 90: average BSS from metrics vs target 65; decide live pilot (small size).

Deploy: see DEPLOYMENT_GUIDE.md for Latitude / systemd.

Paper state: data/paper_trades.json | Metrics: data/monitoring_metrics.json
"""
    )
    return True


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
