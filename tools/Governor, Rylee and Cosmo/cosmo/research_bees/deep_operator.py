"""
Deep Operator: eight-test leadership / governance heuristic using yfinance (+ optional SEC).

Scores are 0–10 per test; aggregate feeds the operator gate. Missing data → neutral mid-scores.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional

import requests
import yfinance as yf

logger = logging.getLogger(__name__)

_SEC_HEADERS = {"User-Agent": "CosmoResearch/1.0 (contact: local)"}


class DeepOperator:
    """Assess management quality with an 8-test rubric."""

    def run_8_tests(self, symbol: str) -> Dict[str, Dict[str, Any]]:
        """Return each test name mapped to {score, reason}."""
        try:
            t = yf.Ticker(symbol)
            info = t.info or {}
        except Exception as exc:  # noqa: BLE001
            logger.warning("DeepOperator: no yfinance data for %s: %s", symbol, exc)
            info = {}

        summary = (info.get("longBusinessSummary") or "").lower()
        tests: Dict[str, Dict[str, Any]] = {}

        # 1 Tenure
        tenure_years = info.get("companyOfficers")
        years = 0.0
        if isinstance(tenure_years, list) and tenure_years:
            first = tenure_years[0] or {}
            y = first.get("yearBorn")
            if y:
                years = max(0.0, min(20.0, 2025 - int(y) - 40))  # weak proxy
        score_tenure = 7.0 if years >= 5 else 5.0 if years >= 2 else 4.0
        tests["tenure"] = {"score": score_tenure, "reason": f"proxy tenure signal ~{years:.1f}y"}

        # 2 Compensation alignment (ROE vs pay unavailable → neutral)
        roe = info.get("returnOnEquity")
        roe_s = float(roe) if roe is not None else None
        if roe_s is not None and roe_s > 0.12:
            tests["compensation"] = {"score": 6.5, "reason": "Strong ROE suggests pay-for-performance plausibility"}
        else:
            tests["compensation"] = {"score": 5.0, "reason": "Insufficient compensation detail; neutral"}

        # 3 Insider / institutional skin in the game
        inst = info.get("heldPercentInstitutions")
        ins = info.get("heldPercentInsiders")
        inst_f = float(inst) if inst is not None else 0.0
        ins_f = float(ins) if ins is not None else 0.0
        if ins_f >= 0.05:
            tests["insider_ownership"] = {"score": 8.0, "reason": f"Insiders ~{ins_f:.1%}"}
        elif inst_f >= 0.5:
            tests["insider_ownership"] = {"score": 6.0, "reason": f"Institutional {inst_f:.1%}, insider thin"}
        else:
            tests["insider_ownership"] = {"score": 4.5, "reason": "Low insider/institutional visibility"}

        # 4 Turnover (no clean API) — neutral with caveat
        tests["turnover"] = {"score": 5.0, "reason": "CFO/audit churn not available via yfinance; manual review"}

        # 5 M&A track record (keyword scan)
        if any(k in summary for k in ("acquisition", "merger", "takeover", "integrated")):
            tests["acquisitions"] = {"score": 6.5, "reason": "Filings mention M&A/integration narrative"}
        else:
            tests["acquisitions"] = {"score": 5.0, "reason": "No strong M&A signal in summary"}

        # 6 Capital allocation
        payout = info.get("payoutRatio")
        pm = info.get("profitMargins")
        payout_f = float(payout) if payout is not None else None
        pm_f = float(pm) if pm is not None else None
        alloc_score = 5.0
        alloc_reason = "Neutral; limited buyback visibility"
        if payout_f is not None and pm_f is not None:
            if 0.2 <= payout_f <= 0.65 and pm_f > 0.08:
                alloc_score = 7.0
                alloc_reason = "Balanced payout with healthy margins"
            elif payout_f > 0.85 and pm_f < 0.05:
                alloc_score = 4.0
                alloc_reason = "High payout vs thin margins — watch sustainability"
        tests["capital_allocation"] = {"score": alloc_score, "reason": alloc_reason}

        # 7 Communication transparency (website IR depth not available)
        tests["communication"] = {"score": 5.5, "reason": "Default transparency; verify earnings call tone manually"}

        # 8 Reputation — optional SEC recent item scan
        sec_bonus = self._sec_enforcement_flag(symbol)
        tests["reputation"] = {
            "score": 4.0 if sec_bonus else 6.0,
            "reason": "SEC recent enforcement hint" if sec_bonus else "No SEC red flag from quick search",
        }

        return tests

    def assess_operator(self, symbol: str) -> float:
        """Aggregate 0–10 operator score from eight tests."""
        tests = self.run_8_tests(symbol)
        scores = [float(v["score"]) for v in tests.values()]
        return round(sum(scores) / len(scores), 2) if scores else 5.0

    def _sec_enforcement_flag(self, symbol: str) -> bool:
        """Lightweight check: company name in SEC press (best-effort, may false negative)."""
        try:
            t = yf.Ticker(symbol)
            name = (t.info or {}).get("shortName") or (t.info or {}).get("longName")
            if not name:
                return False
            q = re.sub(r"[^\w\s]", "", name.split()[0])
            url = "https://www.sec.gov/cgi-bin/browse-edgar"
            params = {"action": "getcompany", "company": q, "owner": "exclude", "count": "5"}
            r = requests.get(url, params=params, headers=_SEC_HEADERS, timeout=8)
            if r.status_code != 200:
                return False
            return "enforcement" in r.text.lower()
        except Exception as exc:  # noqa: BLE001
            logger.debug("SEC browse check skipped: %s", exc)
            return False
