"""
Gate Keeper: regime-adaptive three-gate filter (operator, moat, FQS).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List

import config

logger = logging.getLogger(__name__)


class GateKeeper:
    """Apply configurable thresholds; log why a symbol fails."""

    def __init__(self, log_rejections: bool = True) -> None:
        self.log_rejections = log_rejections
        self._last_failures: List[str] = []

    @property
    def last_rejection_reasons(self) -> List[str]:
        return list(self._last_failures)

    def apply_gates(
        self,
        symbol: str,
        operator_score: float,
        moat_score: float,
        fqs_score: float,
        regime: str,
    ) -> bool:
        """
        Return True only if operator, moat, and FQS all meet regime minima.

        FQS is expected on 0–100 scale; operator and moat on 0–10.
        """
        self._last_failures = []
        th = config.get_gate_thresholds_for_regime(regime)

        ok_op = operator_score > th["operator"]
        ok_moat = moat_score > th["moat"]
        ok_fqs = fqs_score > th["fqs"]

        if not ok_op:
            msg = f"{symbol}: operator {operator_score} <= {th['operator']}"
            self._last_failures.append(msg)
        if not ok_moat:
            msg = f"{symbol}: moat {moat_score} <= {th['moat']}"
            self._last_failures.append(msg)
        if not ok_fqs:
            msg = f"{symbol}: FQS {fqs_score} <= {th['fqs']}"
            self._last_failures.append(msg)

        passed = ok_op and ok_moat and ok_fqs
        if not passed and self.log_rejections:
            for line in self._last_failures:
                logger.info("Gate rejection %s [%s]", line, datetime.now(timezone.utc).isoformat())
        return passed
