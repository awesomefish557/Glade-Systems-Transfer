"""
Flask read-only dashboard for Cosmo paper state + systemd status (Linux).

Bind with env:
  COSMO_REMOTE_DASHBOARD_BIND (default 127.0.0.1 — use 0.0.0.0 behind firewall)
  COSMO_REMOTE_DASHBOARD_PORT (default 5000)

Optional admin (requires remote sudoers / Glade):
  COSMO_ADMIN_TOKEN — send header X-Cosmo-Token on POST /api/restart and POST /api/withdraw
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from flask import Flask, jsonify, request, render_template_string

import config

app = Flask(__name__)

_COSMO_ROOT = Path(config.BASE_DIR)
_STATE_FILE = _COSMO_ROOT / "data" / str(config.PAPER_TRADING.get("state_filename", "paper_trades.json"))
_METRICS_FILE = _COSMO_ROOT / "data" / str(config.PAPER_TRADING.get("metrics_filename", "monitoring_metrics.json"))
_LOG_FILE = Path(config.LOGS_DIR) / "cosmo.log"


def _load_json(path: Path) -> Any:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _portfolio_from_files() -> Dict[str, Any]:
    """Lightweight snapshot without yfinance (safe for 5s polling)."""
    st = _load_json(_STATE_FILE) or {}
    cash = float(st.get("cash", config.INITIAL_CAPITAL_GBP))
    holdings = st.get("holdings") or {}
    mv = cash
    for _sym, h in holdings.items():
        q = float(h.get("quantity", 0))
        ep = float(h.get("entry_price", 0))
        mv += q * ep
    bss = 0.0
    metrics = _load_json(_METRICS_FILE)
    if isinstance(metrics, list) and metrics:
        last = metrics[-1]
        bss = float(last.get("bss", 0) or 0)
    init = float(config.INITIAL_CAPITAL_GBP)
    gl = mv - init
    pct = (gl / init * 100.0) if init else 0.0
    return {
        "portfolio_value": mv,
        "gain_loss": gl,
        "pct_return": pct,
        "bss": bss,
        "holdings_count": len(holdings),
        "cash": cash,
        "note": "Mark uses entry prices; run live_dashboard locally for fresh marks.",
    }


def _systemd_active(unit: str) -> bool:
    if sys.platform == "win32":
        return False
    try:
        r = subprocess.run(
            ["systemctl", "is-active", unit],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return r.returncode == 0 and r.stdout.strip() == "active"
    except (OSError, subprocess.TimeoutExpired):
        return False


def _save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _append_cosmo_log(message: str) -> None:
    line = f"{datetime.now(timezone.utc).isoformat()} {message}\n"
    try:
        _LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(_LOG_FILE, "a", encoding="utf-8") as fh:
            fh.write(line)
    except OSError:
        pass


def handle_withdrawal(amount: float, reason: str) -> Dict[str, Any]:
    """
    Deduct cash from paper state; if insufficient, sell smallest positions (by entry notional)
    until enough cash exists, then record a WITHDRAW trade.
    """
    if amount <= 0:
        return {"ok": False, "error": "amount must be positive"}

    st = _load_json(_STATE_FILE)
    if not isinstance(st, dict):
        st = {
            "cash": float(config.INITIAL_CAPITAL_GBP),
            "holdings": {},
            "trades": [],
        }

    cash = float(st.get("cash", 0))
    holdings: Dict[str, Any] = dict(st.get("holdings") or {})
    trades: List[Any] = list(st.get("trades") or [])

    target = float(amount)

    def _smallest_holding_symbol() -> Tuple[str, Dict[str, Any]]:
        sym = min(
            holdings.keys(),
            key=lambda s: float(holdings[s].get("quantity", 0))
            * float(holdings[s].get("entry_price", 0)),
        )
        return sym, holdings[sym]

    while cash + 1e-9 < target and holdings:
        sym, h = _smallest_holding_symbol()
        q = float(h.get("quantity", 0))
        ep = float(h.get("entry_price", 0))
        proceeds = q * ep
        trades.append(
            {
                "symbol": sym,
                "action": "SELL",
                "price": ep,
                "quantity": q,
                "notional": proceeds,
                "date": datetime.now(timezone.utc).isoformat(),
                "reason": f"Glade withdraw raise cash: {reason}",
            }
        )
        cash += proceeds
        del holdings[sym]

    if cash + 1e-9 < target:
        return {
            "ok": False,
            "error": f"insufficient portfolio: need £{target:,.2f} liquid, have £{cash:,.2f}",
            "cash": cash,
        }

    cash -= target
    trades.append(
        {
            "symbol": "__WITHDRAW__",
            "action": "WITHDRAW",
            "price": 1.0,
            "quantity": target,
            "notional": target,
            "date": datetime.now(timezone.utc).isoformat(),
            "reason": reason,
        }
    )

    st["cash"] = cash
    st["holdings"] = holdings
    st["trades"] = trades
    st["last_updated"] = datetime.now(timezone.utc).isoformat()
    _save_json(_STATE_FILE, st)
    _append_cosmo_log(f"withdraw £{target:.2f} — {reason}")

    return {
        "ok": True,
        "withdrawn": target,
        "cash_after": cash,
        "holdings_count": len(holdings),
        "reason": reason,
    }


def _tail_log(path: Path, n: int = 30) -> List[str]:
    if not path.is_file():
        return ["(no log file yet)"]
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        return [ln for ln in lines[-n:] if ln.strip()]
    except OSError:
        return ["(log read error)"]


_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Cosmo</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e5e5e5; margin: 0; padding: 20px; }
    .wrap { max-width: 960px; margin: 0 auto; }
    h1 { font-weight: 600; }
    .card { background: #1a1a1a; border-radius: 8px; padding: 16px; margin: 12px 0; }
    .ok { color: #4ade80; }
    .bad { color: #f87171; }
    .val { font-size: 1.5rem; font-weight: 700; margin: 8px 0; }
    .logs { font-family: ui-monospace, monospace; font-size: 12px; background: #0a0a0a;
            padding: 12px; border-radius: 6px; max-height: 280px; overflow-y: auto; white-space: pre-wrap; }
    button { background: #2563eb; color: #fff; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .muted { color: #888; font-size: 0.85rem; }
  </style>
  <script>
    async function loadAll() {
      try {
        const s = await fetch('/api/status').then(r => r.json());
        document.getElementById('status').innerHTML =
          '<div class="card"><h3>Services</h3>' +
          '<p>cosmo: <span class="' + (s.cosmo ? 'ok' : 'bad') + '">' + (s.cosmo ? 'active' : 'inactive') + '</span></p>' +
          '<p>dashboard: <span class="' + (s.dashboard ? 'ok' : 'bad') + '">' + (s.dashboard ? 'active' : 'inactive') + '</span></p>' +
          '<p class="muted">' + s.last_check + '</p></div>';
      } catch (e) { document.getElementById('status').textContent = 'status error'; }

      try {
        const p = await fetch('/api/portfolio').then(r => r.json());
        document.getElementById('portfolio').innerHTML =
          '<div class="card"><h3>Paper portfolio (file snapshot)</h3>' +
          '<div class="val">GBP ' + p.portfolio_value.toFixed(2) + '</div>' +
          '<p>P/L: GBP ' + p.gain_loss.toFixed(2) + ' (' + p.pct_return.toFixed(2) + '%)</p>' +
          '<p>BSS (last log): ' + p.bss.toFixed(2) + '</p>' +
          '<p>Holdings: ' + p.holdings_count + '</p>' +
          '<p class="muted">' + (p.note || '') + '</p></div>';
      } catch (e) { document.getElementById('portfolio').textContent = 'portfolio error'; }

      try {
        const l = await fetch('/api/logs?lines=25').then(r => r.json());
        document.getElementById('logs').innerHTML =
          '<div class="card"><h3>Recent cosmo.log</h3><div class="logs">' +
          l.logs.map(x => escapeHtml(x)).join('\\n') + '</div></div>';
      } catch (e) { document.getElementById('logs').textContent = 'logs error'; }
    }
    function escapeHtml(t) {
      const d = document.createElement('div');
      d.textContent = t;
      return d.innerHTML;
    }
    async function restart() {
      const tok = prompt('Admin token (COSMO_ADMIN_TOKEN):');
      if (!tok) return;
      const r = await fetch('/api/restart', { method: 'POST', headers: { 'X-Cosmo-Token': tok }});
      alert(await r.text());
    }
    setInterval(loadAll, 8000);
    window.onload = loadAll;
  </script>
</head>
<body>
  <div class="wrap">
    <h1>Cosmo remote</h1>
    <p class="muted">Paper trading + scheduler status</p>
    <div id="status"></div>
    <div id="portfolio"></div>
    <div id="logs"></div>
    <div class="card">
      <button type="button" onclick="restart()">Restart cosmo service</button>
      <p class="muted">Requires sudo NOPASSWD for systemctl; set COSMO_ADMIN_TOKEN on server.</p>
    </div>
  </div>
</body>
</html>
"""


@app.route("/")
def index() -> str:
    return render_template_string(_HTML)


@app.route("/api/status")
def api_status() -> Any:
    cosmo = _systemd_active("cosmo")
    dash = _systemd_active("cosmo-dashboard")
    return jsonify(
        {
            "cosmo": cosmo,
            "dashboard": dash,
            "last_check": datetime.now(timezone.utc).isoformat(),
            "running": cosmo,
        }
    )


@app.route("/api/portfolio")
def api_portfolio() -> Any:
    p = _portfolio_from_files()
    return jsonify(p)


@app.route("/api/holdings")
def api_holdings() -> Any:
    st = _load_json(_STATE_FILE) or {}
    holdings = st.get("holdings") if isinstance(st, dict) else {}
    return jsonify({"holdings": holdings or {}})


@app.route("/api/withdraw", methods=["POST"])
def api_withdraw() -> Any:
    """
    Receive withdrawal request from Governor / Glade.
    Updates paper state: raise cash if needed, then deduct withdrawal.
    """
    tok = os.environ.get("COSMO_ADMIN_TOKEN", "")
    if tok and request.headers.get("X-Cosmo-Token") != tok:
        return jsonify({"ok": False, "error": "unauthorized"}), 403

    payload = request.get_json(silent=True) or {}
    try:
        amount = float(payload.get("amount", 0))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "invalid amount"}), 400
    category = payload.get("category") or "general"
    description = payload.get("description") or ""
    reason = f"{category}: {description}".strip()

    result = handle_withdrawal(amount, reason or "withdrawal")
    status = 200 if result.get("ok") else 400
    return jsonify(result), status


@app.route("/api/logs")
def api_logs() -> Any:
    n = int(request.args.get("lines", 30))
    n = max(5, min(n, 200))
    return jsonify({"logs": _tail_log(_LOG_FILE, n)})


@app.route("/api/restart", methods=["POST"])
def api_restart() -> Any:
    tok = os.environ.get("COSMO_ADMIN_TOKEN", "")
    if not tok or request.headers.get("X-Cosmo-Token") != tok:
        return jsonify({"error": "unauthorized"}), 403
    if sys.platform == "win32":
        return jsonify({"error": "not supported on windows"}), 400
    try:
        subprocess.run(
            ["sudo", "-n", "systemctl", "restart", "cosmo"],
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
        return jsonify({"ok": True, "message": "cosmo restarted"})
    except subprocess.CalledProcessError as exc:
        return jsonify({"ok": False, "error": exc.stderr or str(exc)}), 500


def main() -> None:
    bind = os.environ.get("COSMO_REMOTE_DASHBOARD_BIND", "127.0.0.1")
    port = int(os.environ.get("COSMO_REMOTE_DASHBOARD_PORT", "5000"))
    app.run(host=bind, port=port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
