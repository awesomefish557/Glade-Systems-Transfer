"""
HTTP API for Governor: portfolio, allocations, withdrawal capability, execute withdraw.

Bind via config.GOVERNOR_API or env COSMO_GOVERNOR_API_BIND / COSMO_GOVERNOR_API_PORT (default 5050).
"""

from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from flask import Flask, jsonify, request

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import config
from cosmo_withdrawal_handler import CosmoWithdrawalHandler
from paper_trading_simulator import PaperTradingSimulator

app = Flask(__name__)

_api_log = Path(config.LOGS_DIR) / "cosmo_api.log"
_api_log.parent.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler(_api_log, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("cosmo_api")

_simulator: Optional[PaperTradingSimulator] = None
_handler: Optional[CosmoWithdrawalHandler] = None


def get_simulator() -> PaperTradingSimulator:
    global _simulator
    if _simulator is None:
        _simulator = PaperTradingSimulator()
    return _simulator


def get_handler() -> CosmoWithdrawalHandler:
    global _handler
    if _handler is None:
        _handler = CosmoWithdrawalHandler()
    return _handler


@app.route("/api/status")
def api_status() -> Any:
    return jsonify(
        {
            "status": "OK",
            "service": "cosmo-governor-api",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )


@app.route("/api/portfolio")
def api_portfolio() -> Any:
    h = get_handler()
    sim = get_simulator()
    psum = sim.get_summary()
    cur = h._conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM holdings")
    n_hold = int(cur.fetchone()["c"])
    return jsonify(
        {
            "portfolio_value": h.get_total_nav(),
            "cash": h.get_cash(),
            "paper_portfolio_value": psum.get("portfolio_value"),
            "paper_cash": psum.get("cash_available"),
            "gain_loss": psum.get("gain_loss"),
            "pct_return": psum.get("pct_return"),
            "bss": psum.get("bss"),
            "holdings_count": n_hold,
            "allocations": h.get_current_allocations(),
        }
    )


@app.route("/api/allocations")
def api_allocations() -> Any:
    h = get_handler()
    current = h.get_current_allocations()
    target = h.get_target_allocations()
    delta = float(config.WITHDRAWAL.get("rebalance_target_delta_pct", 2.0))
    balanced = all(abs(float(current.get(b, 0)) - float(target.get(b, 0))) < delta for b in target)
    return jsonify({"current": current, "target": target, "balanced": balanced})


@app.route("/api/logs")
def api_logs() -> Any:
    log_file = Path(config.LOGS_DIR) / "cosmo.log"
    lines = 30
    if log_file.is_file():
        content = log_file.read_text(encoding="utf-8", errors="replace").splitlines()
        tail = [ln.strip() for ln in content[-lines:] if ln.strip()]
        return jsonify({"logs": tail})
    return jsonify({"logs": ["(no cosmo.log yet)"]})


@app.route("/api/withdrawal-capability", methods=["POST"])
def api_withdrawal_capability() -> Any:
    data = request.get_json(silent=True) or {}
    amount = float(data.get("amount", 0) or 0)
    h = get_handler()
    v = h.validate_withdrawal(amount)
    logger.info("withdrawal-capability amount=%s approved=%s", amount, v.get("approved"))
    return jsonify(
        {
            "can_withdraw": bool(v.get("approved")),
            "reason": v.get("reason", "OK"),
            "details": {k: v[k] for k in v if k not in ("approved", "reason")},
        }
    )


@app.route("/api/withdraw", methods=["POST"])
def api_withdraw() -> Any:
    data = request.get_json(silent=True) or {}
    amount = data.get("amount")
    if amount is None:
        return jsonify({"success": False, "error": "No amount specified"}), 400
    category = str(data.get("category", "general"))
    description = str(data.get("description", ""))
    h = get_handler()
    result = h.execute_withdrawal(float(amount), category, description)
    logger.info("withdraw result success=%s", result.get("success"))
    status = 200 if result.get("success") else 400
    return jsonify(result), status


@app.route("/api/withdrawal-history")
def api_withdrawal_history() -> Any:
    limit = request.args.get("limit", default=20, type=int)
    limit = max(1, min(limit, 200))
    h = get_handler()
    return jsonify({"withdrawals": h.get_withdrawal_history(limit)})


@app.route("/api/holdings")
def api_holdings() -> Any:
    h = get_handler()
    cur = h._conn.cursor()
    cur.execute("SELECT id, symbol, quantity, entry_price, bee FROM holdings ORDER BY symbol")
    rows = [dict(r) for r in cur.fetchall()]
    return jsonify(
        {
            "holdings": rows,
            "count": len(rows),
            "portfolio_value": h.get_total_nav(),
            "cash": h.get_cash(),
        }
    )


@app.route("/api/run-assessment", methods=["POST"])
def api_run_assessment() -> Any:
    try:
        sim = get_simulator()
        recs = sim.run_daily_assessment()
        logger.info("assessment recommendations=%s", len(recs))
        return jsonify(
            {
                "success": True,
                "recommendations": recs,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("assessment failed")
        return jsonify({"success": False, "error": str(exc)}), 500


def run_api_server() -> None:
    host = str(config.GOVERNOR_API.get("host", "0.0.0.0"))
    port = int(config.GOVERNOR_API.get("port", 5050))
    logger.info("Governor API listening on %s:%s", host, port)
    app.run(host=host, port=port, debug=False, threaded=True, use_reloader=False)


if __name__ == "__main__":
    run_api_server()
