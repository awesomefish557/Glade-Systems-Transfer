"""
Moat Scout: competitive advantage heuristics from public fundamentals.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

import yfinance as yf

logger = logging.getLogger(__name__)

# Sector hints for network-effect-heavy industries
_NETWORK_SECTORS = {
    "financial",
    "communication",
    "technology",
    "consumer cyclical",
}


class MoatScout:
    """Score economic moat 0–10 using margins, scale, and sector context."""

    def assess_moat(self, symbol: str, sector: Optional[str] = None) -> float:
        """Return a single moat score 0–10."""
        breakdown = self.moat_breakdown(symbol, sector)
        scores = [float(v["score"]) for v in breakdown.values()]
        return round(sum(scores) / len(scores), 2) if scores else 5.0

    def moat_breakdown(self, symbol: str, sector: Optional[str] = None) -> Dict[str, Dict[str, Any]]:
        """Per-moat-type subscores with reasons."""
        try:
            t = yf.Ticker(symbol)
            info = t.info or {}
        except Exception as exc:  # noqa: BLE001
            logger.warning("MoatScout: no data for %s: %s", symbol, exc)
            info = {}

        sec = (sector or info.get("sector") or "").lower()
        gross = info.get("grossMargins")
        opm = info.get("operatingMargins")
        pm = info.get("profitMargins")
        gross_f = float(gross) if gross is not None else None
        opm_f = float(opm) if opm is not None else None
        pm_f = float(pm) if pm is not None else None

        brand = 5.0
        if gross_f is not None and gross_f > 0.45:
            brand = 7.5
        elif gross_f is not None and gross_f > 0.30:
            brand = 6.5

        network = 5.0
        if any(ns in sec for ns in _NETWORK_SECTORS):
            network = 7.0 if (opm_f or 0) > 0.15 else 6.0

        cost = 5.0
        if opm_f is not None and opm_f > 0.18 and (gross_f or 0) > 0.25:
            cost = 7.5

        switching = 5.0
        beta = info.get("beta")
        if beta is not None and float(beta) < 0.9 and (pm_f or 0) > 0.10:
            switching = 6.5

        ip = 5.0
        summary = (info.get("longBusinessSummary") or "").lower()
        if any(k in summary for k in ("patent", "intellectual property", "proprietary", "license")):
            ip = 7.0

        return {
            "brand_strength": {"score": brand, "reason": "Gross margin / consumer pricing power proxy"},
            "network_effects": {"score": network, "reason": f"Sector '{sec or 'unknown'}' network lens"},
            "cost_advantage": {"score": cost, "reason": "Operating leverage vs gross margin"},
            "switching_costs": {"score": switching, "reason": "Stability (beta) + profitability proxy"},
            "patents_ip": {"score": ip, "reason": "Keyword + filing summary scan"},
        }
