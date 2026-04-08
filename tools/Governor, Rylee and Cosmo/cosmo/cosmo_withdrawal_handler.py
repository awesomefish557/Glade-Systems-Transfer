"""
Governor-facing withdrawal flow: validate capacity, trim over-allocated bees, maintain cash floor.

Uses SQLite `holdings` (+ optional `bee` column), `portfolio_state.cash_gbp`, and `trades` audit.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import config
from config import calculate_liquid_buffer_target
import database as db
from bees.value_bee import ValueBee
from data.fetchers import fetch_stock_price, fetch_vix

logger = logging.getLogger(__name__)


def _infer_regime() -> str:
    vix = fetch_vix()
    if vix is None:
        return "sideways"
    if vix >= config.REGIME_THRESHOLDS["crisis"]["vix_min"]:
        return "crisis"
    if vix >= config.REGIME_THRESHOLDS["bear"]["vix_max"]:
        return "bear"
    if vix <= config.REGIME_THRESHOLDS["bull"]["vix_max"]:
        return "bull"
    return "sideways"


def _row_bee(row: Any) -> str:
    try:
        v = row["bee"]
        return str(v or "value").lower()
    except (KeyError, IndexError, TypeError):
        return "value"


def _latest_bss_0_100() -> Optional[float]:
    path = config.DATA_DIR / str(config.PAPER_TRADING.get("metrics_filename", "monitoring_metrics.json"))
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list) and data:
            return float(data[-1].get("bss", 0) or 0)
    except (json.JSONDecodeError, OSError, TypeError, ValueError):
        return None
    return None


class CosmoWithdrawalHandler:
    """Validate and execute withdrawals while keeping a minimum cash buffer."""

    def __init__(self) -> None:
        self._conn = db.get_db()
        self.value_bee = ValueBee(regime=_infer_regime())
        self.withdrawals_log = config.DATA_DIR / str(config.WITHDRAWAL_AUDIT.get("log_file", "withdrawals.json"))
        self.history: List[Dict[str, Any]] = []
        self.load_withdrawal_history()

    def load_withdrawal_history(self) -> None:
        if not self.withdrawals_log.is_file():
            self.history = []
            return
        try:
            self.history = json.loads(self.withdrawals_log.read_text(encoding="utf-8"))
            if not isinstance(self.history, list):
                self.history = []
        except (json.JSONDecodeError, OSError):
            self.history = []

    def _save_history(self) -> None:
        self.withdrawals_log.parent.mkdir(parents=True, exist_ok=True)
        self.withdrawals_log.write_text(json.dumps(self.history, indent=2), encoding="utf-8")

    def get_cash(self) -> float:
        cur = self._conn.cursor()
        cur.execute("SELECT cash_gbp FROM portfolio_state WHERE id = 1")
        row = cur.fetchone()
        return float(row["cash_gbp"]) if row else float(config.EMERGENCY_BUFFER_GBP)

    def set_cash(self, cash: float) -> None:
        cur = self._conn.cursor()
        cur.execute("UPDATE portfolio_state SET cash_gbp = ? WHERE id = 1", (float(cash),))
        self._conn.commit()

    def get_total_nav(self) -> float:
        cash = self.get_cash()
        cur = self._conn.cursor()
        cur.execute("SELECT symbol, quantity FROM holdings")
        total = cash
        d = date.today()
        for row in cur.fetchall():
            sym, qty = row["symbol"], float(row["quantity"])
            px = fetch_stock_price(sym, d)
            if px:
                total += qty * px
        return float(total)

    def get_current_allocations(self) -> Dict[str, float]:
        """Bee name -> current weight % of equity (0–100)."""
        cur = self._conn.cursor()
        cur.execute("SELECT id, symbol, quantity, bee FROM holdings")
        rows = cur.fetchall()
        d = date.today()
        bee_val: Dict[str, float] = {}
        nav_equity = 0.0
        for row in rows:
            sym = row["symbol"]
            qty = float(row["quantity"])
            px = fetch_stock_price(sym, d)
            if not px:
                continue
            mv = qty * px
            nav_equity += mv
            b = _row_bee(row)
            bee_val[b] = bee_val.get(b, 0.0) + mv
        if nav_equity <= 0:
            return {k: 0.0 for k in ("value", "growth", "income", "defensive")}
        return {b: (v / nav_equity) * 100.0 for b, v in bee_val.items()}

    def get_target_allocations(self, regime: Optional[str] = None) -> Dict[str, float]:
        r = (regime or _infer_regime()).lower()
        tgt = config.BEE_ALLOCATIONS.get(r, config.BEE_ALLOCATIONS["sideways"])
        return {k: float(v) * 100.0 for k, v in tgt.items()}

    def find_over_allocated_bee(
        self,
        current_alloc: Dict[str, float],
        target_alloc: Dict[str, float],
    ) -> Tuple[Optional[str], float]:
        best_bee: Optional[str] = None
        best_over = 0.0
        for bee, target_pct in target_alloc.items():
            cur_pct = float(current_alloc.get(bee, 0.0))
            over = cur_pct - target_pct
            if over > best_over:
                best_over = over
                best_bee = bee
        if best_bee and best_over > float(config.WITHDRAWAL.get("rebalance_target_delta_pct", 2.0)):
            return best_bee, best_over
        return None, 0.0

    def _priority_bees(self) -> List[str]:
        regime = _infer_regime()
        key = "crisis" if regime == "crisis" else "high_vol" if regime == "bear" else "normal"
        if regime == "bull":
            key = "bull_low_vol"
        return list(config.BEE_REBALANCE_PRIORITY.get(key, config.BEE_REBALANCE_PRIORITY["normal"]))

    def get_holdings_for_bee(self, bee_name: str) -> List[Any]:
        cur = self._conn.cursor()
        cur.execute(
            "SELECT id, symbol, quantity, entry_price, bee FROM holdings WHERE lower(ifnull(bee,'value')) = ? ORDER BY quantity ASC",
            (bee_name.lower(),),
        )
        return cur.fetchall()

    def infer_bee_from_symbol(self, symbol: str) -> str:
        cur = self._conn.cursor()
        cur.execute(
            "SELECT bee FROM holdings WHERE symbol = ? LIMIT 1",
            (symbol.upper(),),
        )
        row = cur.fetchone()
        return _row_bee(row) if row else "value"

    def validate_withdrawal(self, amount: float) -> Dict[str, Any]:
        w = config.WITHDRAWAL
        if not w.get("enabled", True):
            return {"approved": False, "reason": "Withdrawals disabled", "details": {}}

        amount = float(amount)
        if amount <= 0:
            return {"approved": False, "reason": "Amount must be positive", "details": {}}

        nav = self.get_total_nav()
        if nav < float(w["min_portfolio_for_withdrawal"]):
            return {
                "approved": False,
                "reason": f"Portfolio too small (GBP {nav:,.0f} < GBP {w['min_portfolio_for_withdrawal']:,.0f})",
                "details": {"portfolio_value": nav, "minimum_required": w["min_portfolio_for_withdrawal"]},
            }

        bss = _latest_bss_0_100()
        if bss is not None and bss < float(w["min_bss_for_withdrawal"]):
            return {
                "approved": False,
                "reason": f"BSS too low ({bss:.1f} < {w['min_bss_for_withdrawal']})",
                "details": {"bss": bss},
            }

        cash = self.get_cash()
        floor = max(
            float(w["min_cash_post_withdrawal"]),
            float(config.LIQUID_BUFFER["min_floor"]),
        )
        if config.LIQUID_BUFFER.get("auto_scale"):
            floor = max(floor, calculate_liquid_buffer_target(nav - amount))

        max_from_buffer = cash - floor
        if max_from_buffer < amount:
            # Need to raise from sales — rough capacity: equity minus min portfolio... allow if equity supports it
            shortfall = amount - max_from_buffer
            saleable = 0.0
            d = date.today()
            cur = self._conn.cursor()
            cur.execute("SELECT symbol, quantity FROM holdings")
            for row in cur.fetchall():
                px = fetch_stock_price(row["symbol"], d)
                if px:
                    saleable += float(row["quantity"]) * px * float(w.get("raise_shortfall_tolerance", 0.95))
            if saleable < shortfall:
                return {
                    "approved": False,
                    "reason": f"Cannot raise GBP {amount:,.0f} while keeping GBP {floor:,.0f} cash floor",
                    "details": {"cash": cash, "floor": floor, "saleable_estimate": saleable, "shortfall": shortfall},
                }

        return {
            "approved": True,
            "cash": cash,
            "portfolio_value": nav,
            "floor": floor,
        }

    def _apply_sale(self, hid: int, symbol: str, qty_sell: float, price: float, reason: str) -> None:
        cur = self._conn.cursor()
        cur.execute("SELECT quantity FROM holdings WHERE id = ?", (hid,))
        row = cur.fetchone()
        if not row:
            return
        q0 = float(row["quantity"])
        q1 = q0 - qty_sell
        proceeds = qty_sell * price
        cur.execute(
            """INSERT INTO trades (symbol, action, price, quantity, date, reason)
               VALUES (?, 'SELL', ?, ?, ?, ?)""",
            (symbol.upper(), price, qty_sell, date.today().isoformat(), reason),
        )
        if q1 <= 1e-9:
            cur.execute("DELETE FROM holdings WHERE id = ?", (hid,))
        else:
            cur.execute("UPDATE holdings SET quantity = ? WHERE id = ?", (q1, hid))
        new_cash = self.get_cash() + proceeds
        self.set_cash(new_cash)
        self._conn.commit()

    def execute_withdrawal(self, amount: float, category: str, description: str) -> Dict[str, Any]:
        amount = float(amount)
        logger.info("Withdrawal request: GBP %s (%s: %s)", amount, category, description)

        validation = self.validate_withdrawal(amount)
        if not validation.get("approved"):
            logger.warning("Withdrawal rejected: %s", validation.get("reason"))
            return {
                "success": False,
                "reason": validation.get("reason", "Rejected"),
                "details": validation.get("details", {}),
            }

        current_alloc = self.get_current_allocations()
        target_alloc = self.get_target_allocations()
        bee_trim, over_pct = self.find_over_allocated_bee(current_alloc, target_alloc)
        if not bee_trim:
            bee_trim = self._priority_bees()[0] if self._priority_bees() else "value"

        floor = float(validation.get("floor", config.WITHDRAWAL["min_cash_post_withdrawal"]))
        d = date.today()
        holdings_to_sell: List[Dict[str, Any]] = []
        total_raised = 0.0

        def row_sort_key(r: Any) -> Tuple[int, float]:
            b = _row_bee(r)
            if b == bee_trim.lower():
                tier = 0
            else:
                order = self._priority_bees()
                try:
                    tier = 1 + order.index(b)
                except ValueError:
                    tier = 10
            px = fetch_stock_price(r["symbol"], d) or 0.0
            mv = float(r["quantity"]) * px
            return (tier, mv)

        target_cash = amount + floor
        stagnant = 0
        while self.get_cash() < target_cash - 1e-6:
            cur = self._conn.cursor()
            cur.execute("SELECT id, symbol, quantity, bee FROM holdings")
            rows = [r for r in cur.fetchall() if fetch_stock_price(r["symbol"], d)]
            if not rows:
                break
            rows.sort(key=row_sort_key)
            row = rows[0]
            hid = int(row["id"])
            sym = row["symbol"]
            qty0 = float(row["quantity"])
            px = fetch_stock_price(sym, d)
            if not px or qty0 <= 0:
                stagnant += 1
                if stagnant > 3:
                    break
                continue
            need = target_cash - self.get_cash()
            mv = qty0 * px
            take_gbp = min(mv, need)
            qty_sell = min(qty0, take_gbp / px)
            if qty_sell <= 1e-9:
                stagnant += 1
                if stagnant > 3:
                    break
                continue
            stagnant = 0
            self._apply_sale(hid, sym, qty_sell, px, f"Withdrawal raise: {category}")
            got = qty_sell * px
            total_raised += got
            holdings_to_sell.append({"symbol": sym, "quantity": qty_sell, "price": px})

        cash = self.get_cash()
        if cash < target_cash - 1e-4:
            return {
                "success": False,
                "reason": f"Could not raise enough cash (have GBP {cash:,.0f}, need GBP {target_cash:,.0f})",
                "details": {"cash": cash, "needed": target_cash, "raised_from_sales": total_raised},
            }

        self.set_cash(cash - amount)
        self._conn.commit()

        new_alloc = self.get_current_allocations()
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "amount": amount,
            "category": category,
            "description": description,
            "bee_trim_target": bee_trim,
            "overallocation_pct": over_pct,
            "sales": holdings_to_sell,
            "total_raised_from_sales": total_raised,
            "cash_after": self.get_cash(),
            "allocations_before": current_alloc,
            "allocations_after": new_alloc,
            "success": True,
        }
        self.history.append(record)
        self._save_history()

        logger.info("Withdrawal OK. Cash now GBP %.2f", self.get_cash())
        return {
            "success": True,
            "amount": amount,
            "category": category,
            "bee_sold_from": bee_trim,
            "allocations_before": current_alloc,
            "allocations_after": new_alloc,
            "total_raised": total_raised,
            "cash_after": self.get_cash(),
            "message": "Withdrawal executed; portfolio_state and holdings updated.",
        }

    def get_withdrawal_history(self, limit: int = 20) -> List[Dict[str, Any]]:
        return self.history[-limit:]


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    h = CosmoWithdrawalHandler()
    out = h.execute_withdrawal(1500.0, "learning", "Berlin language course (dry run)")
    print(json.dumps(out, indent=2, default=str))


if __name__ == "__main__":
    main()
