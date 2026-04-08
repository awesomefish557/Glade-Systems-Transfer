"""
Week 2 orchestration: populate universe → foundation tests → random-quarter backtest.

Run from the `cosmo/` directory:

  python week2_run.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


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

    print("\nCOSMO WEEK 2: BACKTEST PIPELINE")
    print("=" * 60)

    if not run_command(
        [py, str(root / "data" / "populate_universe.py")],
        "Step 1: Populate UK universe (data/uk_universe.txt)",
        root,
    ):
        print("Universe step failed; continuing with existing file if present.")

    if not run_command(
        [py, "-m", "pytest", str(root / "tests" / "test_foundation.py"), "-v", "-m", "not slow"],
        "Step 2: Foundation tests (pytest, excludes slow screening)",
        root,
    ):
        print("Foundation tests failed — fix before relying on backtest.")
        return False

    if not run_command(
        [py, str(root / "backtest.py")],
        "Step 3: Random-quarter backtest (20 quarters, strict exit if thresholds not met)",
        root,
    ):
        print("Backtest reported NOT READY (exit code 1) or crashed.")
        return False

    print("\n" + "=" * 60)
    print("WEEK 2 PIPELINE COMPLETE")
    print("=" * 60)
    print("Next: 90-day paper trading if you accept the backtest assumptions; deploy main.py when ready.")
    return True


if __name__ == "__main__":
    raise SystemExit(0 if main() else 1)
