"""
Trading 212 manual workflow: you execute trades; Cosmo logs them in SQLite.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

import config
import database as db
from bees.value_bee import ValueBee
from data import fetchers

logger = logging.getLogger(__name__)


class Trading212Logger:
    """Append-only trade log and sizing hints for manual execution."""

    def __init__(self) -> None:
        db.get_db()
        self._bee = ValueBee()

    def log_trade(self, symbol: str, action: str, price: float, quantity: float, reason: str) -> bool:
        """Insert a trade row. Returns False on failure."""
        try:
            conn = db.get_db()
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO trades (symbol, action, price, quantity, date, reason)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    symbol.upper(),
                    action.upper(),
                    float(price),
                    float(quantity),
                    datetime.now(timezone.utc).date().isoformat(),
                    reason,
                ),
            )
            conn.commit()
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error("log_trade failed: %s", exc)
            return False

    def get_trade_history(self, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        """Return recent trades, optionally filtered by symbol."""
        conn = db.get_db()
        cur = conn.cursor()
        if symbol:
            cur.execute(
                "SELECT id, symbol, action, price, quantity, date, reason FROM trades WHERE symbol = ? ORDER BY id DESC",
                (symbol.upper(),),
            )
        else:
            cur.execute(
                "SELECT id, symbol, action, price, quantity, date, reason FROM trades ORDER BY id DESC LIMIT 500"
            )
        rows = cur.fetchall()
        return [dict(r) for r in rows]

    def calculate_position_size(self, symbol: str, capital: float) -> float:
        """GBP notional cap per config (same rule as Value Bee)."""
        return self._bee.calculate_position_size(capital, symbol)

    def get_recommendation_for_execution(self, symbol: str) -> Dict[str, Any]:
        """Bundle live quote + Value Bee stance for manual order entry."""
        action = self._bee.get_recommendation(symbol)
        px = fetchers.fetch_stock_price(symbol, date.today())
        reason_bits = self._bee.assess_candidate(symbol)
        reason = ",".join(reason_bits.get("gate_reasons") or []) or "gates_ok"
        return {
            "symbol": symbol.upper(),
            "action": action,
            "price": px,
            "reason": reason,
            "assessment": reason_bits,
        }
