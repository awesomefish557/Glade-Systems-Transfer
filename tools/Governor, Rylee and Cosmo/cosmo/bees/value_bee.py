"""
Value Bee: gate-first UK value sleeve; sizing and recommendations tied to config + DB state.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

import yfinance as yf

import config
import database as db
from data import fetchers
from research_bees.deep_operator import DeepOperator
from research_bees.gate_keeper import GateKeeper
from research_bees.moat_scout import MoatScout

logger = logging.getLogger(__name__)


class ValueBee:
    """Assess candidates, enforce gates, and size positions for the value sleeve."""

    def __init__(self, regime: str = "bull") -> None:
        self.regime = regime
        self._operator = DeepOperator()
        self._moat = MoatScout()
        self._gates = GateKeeper()

    def set_regime(self, regime: str) -> None:
        """Allow main/dashboard to update adaptive thresholds."""
        self.regime = regime

    def _compute_fqs(self, symbol: str) -> float:
        """
        Fundamental Quality Score 0–100 from available fundamentals.

        Higher is better: cheap vs earnings, sustainable margins, balance sheet.
        """
        try:
            t = yf.Ticker(symbol)
            info = t.info or {}
        except Exception as exc:  # noqa: BLE001
            logger.debug("FQS info fail %s: %s", symbol, exc)
            info = {}

        pe = fetchers.fetch_pe_ratio(symbol)
        dy = fetchers.fetch_dividend_yield(symbol) or 0.0
        roe = info.get("returnOnEquity")
        debt_eq = info.get("debtToEquity")
        pm = info.get("profitMargins")

        score = 50.0
        if pe is not None and pe > 0:
            score += max(-25.0, min(25.0, (15.0 - pe) * 1.5))
        score += min(15.0, dy * 300.0)
        if roe is not None:
            rf = float(roe)
            score += max(-10.0, min(15.0, (rf - 0.10) * 80.0))
        if debt_eq is not None:
            de = float(debt_eq)
            score -= min(15.0, max(0.0, (de - 80.0) / 20.0))
        if pm is not None:
            score += max(-5.0, min(10.0, float(pm) * 40.0))

        return float(max(0.0, min(100.0, score)))

    def assess_candidate(self, symbol: str) -> Dict[str, Any]:
        """Run operator, moat, FQS and report gate outcome."""
        op = self._operator.assess_operator(symbol)
        sector = (yf.Ticker(symbol).info or {}).get("sector")
        moat = self._moat.assess_moat(symbol, sector=str(sector) if sector else None)
        fqs = self._compute_fqs(symbol)
        passes = self._gates.apply_gates(symbol, op, moat, fqs, self.regime)
        return {
            "operator": op,
            "moat": moat,
            "fqs": fqs,
            "passes_gates": passes,
            "gate_reasons": self._gates.last_rejection_reasons,
        }

    def get_recommendation(self, symbol: str) -> str:
        """BUY / HOLD / SELL / REJECT from gates and portfolio membership."""
        held = self._holding_row(symbol)
        assessment = self.assess_candidate(symbol)
        if not assessment["passes_gates"]:
            return "REJECT"
        if held is None:
            return "BUY"
        # Simple exit: fail any two of three vs relaxed baseline (re-check gates already strict)
        if assessment["fqs"] < config.GATE_FQS_MIN * 0.9:
            return "SELL"
        return "HOLD"

    def get_portfolio(self) -> List[Dict[str, Any]]:
        """Current holdings rows from SQLite."""
        conn = db.get_db()
        cur = conn.cursor()
        cur.execute(
            "SELECT id, symbol, entry_price, entry_date, quantity, sector FROM holdings ORDER BY symbol"
        )
        rows = cur.fetchall()
        out: List[Dict[str, Any]] = []
        for r in rows:
            out.append(
                {
                    "id": r["id"],
                    "symbol": r["symbol"],
                    "entry_price": r["entry_price"],
                    "entry_date": r["entry_date"],
                    "quantity": r["quantity"],
                    "sector": r["sector"],
                }
            )
        return out

    def calculate_position_size(self, capital: float, symbol: str) -> float:
        """GBP notional capped at MAX_SINGLE_POSITION_PCT of capital."""
        price = fetchers.fetch_stock_price(symbol, date.today())
        if price is None or price <= 0:
            return 0.0
        return float(capital) * config.MAX_SINGLE_POSITION_PCT

    def _holding_row(self, symbol: str) -> Optional[Any]:
        conn = db.get_db()
        cur = conn.cursor()
        cur.execute(
            "SELECT id, symbol, entry_price, entry_date, quantity, sector FROM holdings WHERE symbol = ?",
            (symbol.upper(),),
        )
        return cur.fetchone()

    def log_assessment(self, symbol: str, payload: Dict[str, Any]) -> None:
        """Persist latest assessment for auditing (optional side effect)."""
        conn = db.get_db()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO assessments (symbol, operator_score, moat_score, fqs_score, date)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                symbol.upper(),
                float(payload["operator"]),
                float(payload["moat"]),
                float(payload["fqs"]),
                datetime.now(timezone.utc).date().isoformat(),
            ),
        )
        conn.commit()
