"""
Bee Success Score (BSS): composite 0–100 quality of bee-level outcomes.

Components: return, volatility (inverted), crash resilience, consistency — regime-aware weights.
"""

from __future__ import annotations

import logging
from typing import Dict, Iterable, Mapping, Optional

import numpy as np

logger = logging.getLogger(__name__)

# Sub-score weights within one bee (must sum to 1)
_WEIGHT_RETURN = 0.35
_WEIGHT_VOL_INV = 0.25
_WEIGHT_CRASH = 0.25
_WEIGHT_CONSISTENCY = 0.15


class BSS_Calculator:
    """Compute per-bee BSS and portfolio-level BSS from allocations."""

    def calculate_bee_bss(
        self,
        bee_name: str,
        holdings: Iterable[Mapping[str, float]],
        returns: Iterable[float],
        regime: str,
    ) -> float:
        """
        Map simplified inputs to a 0–100 BSS for one bee.

        `holdings` entries may include keys: weight, drawdown_contrib, daily_return.
        `returns` is a series of periodic returns (e.g. daily) for that bee's book.
        """
        _ = bee_name  # reserved for logging / future regime-specific tuning
        regime_l = (regime or "sideways").lower()
        vol_penalty = 1.0 if regime_l in ("bull", "sideways") else 1.15

        ret_list = [float(x) for x in returns]
        if not ret_list:
            return 50.0

        arr = np.array(ret_list, dtype=float)
        mean_r = float(np.mean(arr))
        vol = float(np.std(arr)) if len(arr) > 1 else 0.0
        downside = arr[arr < 0]
        crash = float(np.mean(downside)) if len(downside) else 0.0
        consistency = 1.0 - (float(np.std(arr)) / (abs(mean_r) + 1e-6))

        # Scale to 0–100-ish subscores (heuristic but stable)
        return_score = max(0.0, min(100.0, 50.0 + mean_r * 5000.0))
        vol_score = max(0.0, min(100.0, 100.0 - vol * 800.0 * vol_penalty))
        crash_score = max(0.0, min(100.0, 50.0 - crash * 4000.0))
        consistency_score = max(0.0, min(100.0, 50.0 + consistency * 25.0))

        bss = (
            _WEIGHT_RETURN * return_score
            + _WEIGHT_VOL_INV * vol_score
            + _WEIGHT_CRASH * crash_score
            + _WEIGHT_CONSISTENCY * consistency_score
        )
        # Optional: blend in holding-level drawdown if provided
        try:
            dd = [float(h.get("drawdown_contrib", 0.0) or 0.0) for h in holdings]
            if dd:
                avg_dd = float(np.mean(np.abs(np.array(dd))))
                bss -= min(20.0, avg_dd * 100.0)
        except Exception as exc:  # noqa: BLE001
            logger.debug("holding drawdown blend skipped: %s", exc)

        return float(max(0.0, min(100.0, bss)))

    def calculate_portfolio_bss(
        self,
        all_bee_scores: Mapping[str, float],
        allocations: Mapping[str, float],
    ) -> float:
        """Weighted average of bee BSS scores using allocation weights."""
        total_w = 0.0
        acc = 0.0
        for bee, score in all_bee_scores.items():
            w = float(allocations.get(bee, 0.0))
            acc += w * float(score)
            total_w += w
        if total_w <= 0:
            return float(np.mean(list(all_bee_scores.values()))) if all_bee_scores else 0.0
        return float(max(0.0, min(100.0, acc / total_w)))

    def get_bss_interpretation(self, bss: float) -> str:
        """Map numeric BSS to a short status label."""
        if bss < 50:
            return "Danger"
        if bss < 65:
            return "Normal"
        if bss <= 80:
            return "Excellent"
        return "Outstanding"
