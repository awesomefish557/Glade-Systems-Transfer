"""
GLADE SYSTEMS DASHBOARD
Central hub: Cosmo + Rylee + Governor + Seer + Igor
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, render_template_string, request

from cosmo_api_client import CosmoAPIClient
from glade_config import BOOKIES, COSMO, GLADE_DASHBOARD, GLADE_DATA_DIR, GOVERNOR_RULES, RYLEE, SEER
from governor_logic import Governor

app = Flask(__name__)
app.secret_key = os.environ.get("GLADE_SECRET_KEY", "glade-systems-secret")

governor = Governor()
cosmo_client = CosmoAPIClient(COSMO["api_url"], timeout=int(COSMO.get("timeout", 10)))


def _load_json(path: Path, default):
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def _governor_stats() -> dict:
    hist = _load_json(GLADE_DATA_DIR / "governor_decisions.json", [])
    if not isinstance(hist, list):
        hist = []
    total_approved = 0.0
    this_month = 0.0
    month_start = datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    for d in reversed(hist):
        if not isinstance(d, dict):
            continue
        req = d.get("request") or {}
        amt = float(req.get("amount", 0) or 0)
        if d.get("user_approved") and d.get("executed"):
            total_approved += amt
            try:
                raw = d["date"]
                if raw.endswith("Z"):
                    raw = raw.replace("Z", "+00:00")
                dd = datetime.fromisoformat(raw)
                if dd.tzinfo:
                    dd = dd.replace(tzinfo=None)
                if dd >= month_start:
                    this_month += amt
            except (KeyError, ValueError, TypeError):
                pass
    return {
        "pending_decision": False,
        "total_approved": total_approved,
        "this_month": this_month,
    }


def _rylee_widget() -> dict:
    req_file = RYLEE["funding_requests_file"]
    reqs = _load_json(req_file, [])
    pending = len(reqs) if isinstance(reqs, list) else 0
    return {
        "income_target": int(RYLEE.get("income_target_year_1", 500)),
        "active_projects": len(RYLEE.get("projects", []) or []),
        "pending_requests": pending,
    }


_HTML = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>GLADE SYSTEMS</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif;
                background: linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%);
                color: #fff;
                padding: 20px;
            }
            .container { max-width: 1400px; margin: 0 auto; }
            .header {
                text-align: center;
                margin-bottom: 40px;
                border-bottom: 2px solid #333;
                padding-bottom: 20px;
            }
            .header h1 { font-size: 36px; margin-bottom: 10px; }
            .header p { color: #aaa; font-size: 14px; }
            .personas {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 20px;
                margin-bottom: 30px;
            }
            .persona {
                background: linear-gradient(135deg, #1a1a1a 0%, #222 100%);
                border: 1px solid #333;
                border-radius: 8px;
                padding: 20px;
                transition: all 0.3s ease;
            }
            .persona:hover {
                border-color: #555;
                transform: translateY(-2px);
            }
            .persona-clickable {
                cursor: pointer;
            }
            .persona h2 {
                margin-bottom: 15px;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .metric {
                display: flex;
                justify-content: space-between;
                margin: 10px 0;
                padding: 8px 0;
                border-bottom: 1px solid #333;
            }
            .metric-label { color: #aaa; }
            .metric-value { color: #4ade80; font-weight: bold; }
            .status-good { color: #4ade80; }
            .status-warn { color: #facc15; }
            .status-bad { color: #f87171; }
            .decision-panel {
                background: linear-gradient(135deg, #1a2a1a 0%, #222a1a 100%);
                border: 2px solid #4ade80;
                border-radius: 8px;
                padding: 20px;
                margin-top: 30px;
            }
            .decision-title {
                font-size: 18px;
                font-weight: bold;
                margin-bottom: 15px;
            }
            .decision-content {
                background: #0f0f0f;
                padding: 15px;
                border-radius: 4px;
                margin: 15px 0;
                font-family: monospace;
                font-size: 13px;
                max-height: 300px;
                overflow-y: auto;
                white-space: pre-wrap;
            }
            .controls { display: flex; gap: 10px; margin-top: 15px; flex-wrap: wrap; }
            button, .btn-link {
                flex: 1;
                min-width: 120px;
                padding: 10px 20px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
                transition: all 0.2s;
            }
            .btn-approve { background: #4ade80; color: #000; }
            .btn-approve:hover { background: #22c55e; transform: scale(1.02); }
            .btn-deny { background: #f87171; color: #fff; }
            .btn-deny:hover { background: #ef4444; transform: scale(1.02); }
            .btn-submit { background: #3b82f6; color: #fff; flex: 0 0 auto; }
            .request-form {
                background: #151515;
                border: 1px solid #333;
                border-radius: 8px;
                padding: 16px;
                margin-bottom: 24px;
            }
            .request-form label { display: block; color: #aaa; margin-top: 10px; font-size: 13px; }
            .request-form input, .request-form select, .request-form textarea {
                width: 100%;
                margin-top: 4px;
                padding: 8px;
                border-radius: 4px;
                border: 1px solid #444;
                background: #0a0a0a;
                color: #e5e5e5;
            }
            .request-form textarea { min-height: 72px; resize: vertical; }
        </style>
        <script>
            let pendingEval = null;
            let pendingReq = null;

            function loadDashboard() {
                fetch('/api/dashboard').then(r => r.json()).then(data => {
                    document.getElementById('cosmo').innerHTML = formatCosmo(data.cosmo);
                    document.getElementById('rylee').innerHTML = formatRylee(data.rylee);
                    document.getElementById('governor').innerHTML = formatGovernor(data.governor);
                    document.getElementById('seer').innerHTML = formatSeer(data.seer);
                    document.getElementById('igor').innerHTML = formatIgor(data.igor);
                    document.getElementById('bookies').innerHTML = formatBookies(data.bookies);
                }).catch(() => {});
            }

            function formatCosmo(data) {
                const pv = Number(data.portfolio_value || 0);
                const lc = Number(data.liquid_cash || 0);
                const bss = Number(data.bss || 0);
                return `
                    <h2>💰 COSMO</h2>
                    <div class="metric">
                        <span class="metric-label">Portfolio</span>
                        <span class="metric-value">£${pv.toLocaleString(undefined, {maximumFractionDigits: 0})}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Liquid buffer</span>
                        <span class="metric-value">£${lc.toLocaleString(undefined, {maximumFractionDigits: 0})}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">BSS</span>
                        <span class="metric-value">${bss.toFixed(1)}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Holdings</span>
                        <span class="metric-value">${data.holdings_count}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Status</span>
                        <span class="status-${data.running ? 'good' : 'bad'}">${data.running ? '✅ RUNNING' : '❌ OFFLINE'}</span>
                    </div>
                `;
            }

            function formatRylee(data) {
                return `
                    <h2>🎨 RYLEE</h2>
                    <div class="metric">
                        <span class="metric-label">Income target (Y1)</span>
                        <span class="metric-value">£${Number(data.income_target).toLocaleString()}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Active projects</span>
                        <span class="metric-value">${data.active_projects}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Capital requests (file)</span>
                        <span class="metric-value">${data.pending_requests}</span>
                    </div>
                `;
            }

            function formatGovernor(data) {
                return `
                    <h2>⚖️ GOVERNOR</h2>
                    <div class="metric">
                        <span class="metric-label">Pending decision</span>
                        <span class="metric-value">${data.pending_decision ? '⏳ YES' : '✅ NO'}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Total approved</span>
                        <span class="metric-value">£${Number(data.total_approved).toLocaleString(undefined, {maximumFractionDigits: 0})}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">This month</span>
                        <span class="metric-value">£${Number(data.this_month).toLocaleString(undefined, {maximumFractionDigits: 0})}</span>
                    </div>
                `;
            }

            function formatSeer(data) {
                return `
                    <h2>🔮 SEER</h2>
                    <div class="metric">
                        <span class="metric-label">Cosmo edge</span>
                        <span class="metric-value">${data.edge}%</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Trend</span>
                        <span class="metric-value">${data.trend}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Insight</span>
                        <span class="metric-value" style="font-size:12px;font-weight:normal;">${data.latest_insight}</span>
                    </div>
                `;
            }

            function formatIgor(data) {
                return `
                    <h2>🔧 IGOR</h2>
                    <div class="metric">
                        <span class="metric-label">Services</span>
                        <span class="status-${data.all_healthy ? 'good' : 'warn'}">${data.all_healthy ? '✅ HEALTHY' : '⚠️ CHECK'}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Last deploy</span>
                        <span class="metric-value">${data.last_deploy}</span>
                    </div>
                `;
            }

            function formatBookies(data) {
                const enabled = !!data.enabled;
                const target = data.page_url || '#';
                const label = data.label || 'Open';
                return `
                    <h2>✨ BOOKIES CONSTELLATION</h2>
                    <div class="metric">
                        <span class="metric-label">Status</span>
                        <span class="status-${enabled ? 'good' : 'warn'}">${enabled ? '✅ READY' : '⚠️ DISABLED'}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Target</span>
                        <span class="metric-value" style="font-size:12px;">${target}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Action</span>
                        <span class="metric-value">${label}</span>
                    </div>
                `;
            }

            function submitWithdrawal(ev) {
                ev.preventDefault();
                const amount = parseFloat(document.getElementById('w-amount').value);
                const category = document.getElementById('w-cat').value;
                const description = document.getElementById('w-desc').value;
                fetch('/api/withdrawal-request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amount, category, description })
                }).then(r => r.json()).then(res => {
                    const panel = document.getElementById('decision');
                    if (res.auto_executed) {
                        panel.innerHTML = '<div class="decision-title">✅ Auto-executed (&lt; £' + res.threshold + ')</div>' +
                            '<div class="decision-content">' + (res.message || '') + '</div>';
                        pendingEval = null;
                        pendingReq = null;
                        loadDashboard();
                        return;
                    }
                    pendingEval = res;
                    pendingReq = { amount, category, description };
                    panel.innerHTML = '<div class="decision-title">' + (res.approved ? '⏳ Awaiting your confirmation' : '❌ No approval') + '</div>' +
                        '<div class="decision-content">' + (res.summary || '') + '</div>' +
                        (res.approved ? '<div class="controls"><button type="button" class="btn-approve" onclick="confirmW(true)">APPROVE</button>' +
                        '<button type="button" class="btn-deny" onclick="confirmW(false)">DENY</button></div>' : '');
                }).catch(e => {
                    document.getElementById('decision').innerHTML = '<div class="decision-title">Error</div><div class="decision-content">' + e + '</div>';
                });
            }

            function confirmW(ok) {
                if (!pendingReq) return;
                if (!ok) {
                    fetch('/api/deny-withdrawal', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...pendingReq, evaluation: pendingEval })
                    }).then(() => {
                        document.getElementById('decision').innerHTML = '<div class="decision-title">Recorded denial</div>';
                        pendingEval = null;
                        pendingReq = null;
                        loadDashboard();
                    });
                    return;
                }
                const tok = prompt('Optional: COSMO_ADMIN_TOKEN for Cosmo (leave blank if unset on server):') || '';
                fetch('/api/confirm-withdrawal', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...pendingReq, confirmed: true, admin_token: tok || null, evaluation: pendingEval })
                }).then(r => r.json()).then(res => {
                    document.getElementById('decision').innerHTML = '<div class="decision-title">' + (res.success ? '✅ Executed' : '❌ Failed') + '</div>' +
                        '<div class="decision-content">' + JSON.stringify(res, null, 2) + '</div>';
                    pendingEval = null;
                    pendingReq = null;
                    loadDashboard();
                });
            }

            function openBookies() {
                fetch('/api/bookies').then(r => r.json()).then(data => {
                    if (!data.enabled || !data.page_url) return;
                    window.open(data.page_url, '_blank', 'noopener,noreferrer');
                }).catch(() => {});
            }

            setInterval(loadDashboard, 5000);
            window.onload = loadDashboard;
        </script>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🌟 GLADE SYSTEMS</h1>
                <p>Personal OS for ambitious living. Cosmo + Rylee + Governor + Seer + Igor</p>
            </div>

            <form class="request-form" onsubmit="submitWithdrawal(event)">
                <h2 style="margin-bottom:8px;font-size:18px;">Capital request (Rylee → Governor)</h2>
                <label>Amount (£)</label>
                <input id="w-amount" type="number" step="0.01" min="0" required value="100" />
                <label>Category</label>
                <select id="w-cat">
                    <option value="learning">learning</option>
                    <option value="travel">travel</option>
                    <option value="building">building</option>
                    <option value="operations">operations</option>
                    <option value="general">general</option>
                </select>
                <label>Description</label>
                <textarea id="w-desc" placeholder="What is this for?"></textarea>
                <div class="controls" style="margin-top:12px;">
                    <button type="submit" class="btn-submit">Submit for Governor review</button>
                </div>
            </form>

            <div class="personas">
                <div class="persona" id="cosmo">Loading...</div>
                <div class="persona" id="rylee">Loading...</div>
                <div class="persona" id="governor">Loading...</div>
                <div class="persona" id="seer">Loading...</div>
                <div class="persona" id="igor">Loading...</div>
                <div class="persona persona-clickable" id="bookies" onclick="openBookies()">Loading...</div>
            </div>

            <div class="decision-panel" id="decision">
                <div class="decision-title">⏳ No pending decisions</div>
            </div>
        </div>
    </body>
    </html>
    """


@app.route("/")
def dashboard():
    """Main Glade dashboard."""
    return render_template_string(_HTML)


@app.route("/api/dashboard")
def api_dashboard():
    """Get all personas status."""
    try:
        cosmo_status = cosmo_client.get_portfolio_status()
        cosmo_running = cosmo_client.get_service_status()
    except Exception:
        cosmo_status = {}
        cosmo_running = cosmo_client.health_check()

    pv = float(cosmo_status.get("portfolio_value", 0) or 0)
    cash = float(
        cosmo_status.get("cash", cosmo_status.get("liquid_cash", 0)) or 0,
    )
    gov = _governor_stats()
    rylee_w = _rylee_widget()

    excess = cosmo_status.get("pct_return")
    edge = 1.5
    if excess is not None:
        try:
            edge = max(-99.0, min(99.0, float(excess) * 0.1))
        except (TypeError, ValueError):
            pass

    return jsonify(
        {
            "cosmo": {
                "portfolio_value": pv if pv else 8000,
                "liquid_cash": cash if cash else 0,
                "bss": float(cosmo_status.get("bss", 0) or 0),
                "holdings_count": int(cosmo_status.get("holdings_count", 0) or 0),
                "running": cosmo_running,
            },
            "rylee": rylee_w,
            "governor": gov,
            "seer": {
                "edge": round(edge, 2),
                "trend": "↗️ Positive" if edge >= 0 else "↘️ Caution",
                "latest_insight": "Cosmo vs benchmark: see Cosmo dashboard",
            },
            "igor": {
                "all_healthy": cosmo_running and SEER.get("enabled", True),
                "last_deploy": datetime.now().strftime("%Y-%m-%d %H:%M"),
            },
            "bookies": {
                "enabled": bool(BOOKIES.get("enabled", True)),
                "page_url": str(BOOKIES.get("page_url", "") or ""),
                "label": str(BOOKIES.get("label", "Open Bookies") or "Open Bookies"),
            },
        }
    )


@app.route("/api/bookies")
def api_bookies():
    return jsonify(
        {
            "enabled": bool(BOOKIES.get("enabled", True)),
            "page_url": str(BOOKIES.get("page_url", "") or ""),
            "label": str(BOOKIES.get("label", "Open Bookies") or "Open Bookies"),
        }
    )


@app.route("/api/withdrawal-request", methods=["POST"])
def api_withdrawal_request():
    """
    Request withdrawal. Governor evaluates.
    Returns recommendation + asks for user confirmation (or auto-executes if small).
    """
    data = request.get_json(silent=True) or {}
    amount = float(data.get("amount") or 0)
    category = data.get("category", "general")
    description = data.get("description", "")

    if amount <= 0:
        return jsonify({"approved": False, "reason": "Invalid amount", "summary": "Amount must be > 0"}), 400

    evaluation = governor.evaluate_withdrawal_request(amount, category, description)
    summary = governor.get_recommendation_summary(evaluation)
    threshold = float(GOVERNOR_RULES["auto_approve_under"])

    if evaluation.get("approved") and amount < threshold:
        try:
            admin_token = os.environ.get("COSMO_ADMIN_TOKEN") or data.get("admin_token")
            result = cosmo_client.request_withdrawal(
                amount, category, description, admin_token=admin_token
            )
            req = {"amount": amount, "category": category, "description": description}
            governor.log_decision(req, evaluation, True, True)
            return jsonify(
                {
                    "recommendation": evaluation["recommendation"],
                    "approved": True,
                    "auto_executed": True,
                    "threshold": threshold,
                    "summary": summary,
                    "message": f"Withdrawal executed automatically (< £{threshold}).",
                    "result": result,
                }
            )
        except Exception as e:
            return jsonify(
                {
                    "recommendation": evaluation["recommendation"],
                    "approved": True,
                    "auto_executed": False,
                    "error": str(e),
                    "summary": summary,
                }
            ), 500

    return jsonify(
        {
            "recommendation": evaluation.get("recommendation"),
            "reason": evaluation.get("reason"),
            "details": evaluation.get("details"),
            "conditions": evaluation.get("conditions", []),
            "approved": evaluation.get("approved", False),
            "summary": summary,
        }
    )


@app.route("/api/deny-withdrawal", methods=["POST"])
def api_deny_withdrawal():
    data = request.get_json(silent=True) or {}
    req = {
        "amount": data.get("amount"),
        "category": data.get("category"),
        "description": data.get("description", ""),
    }
    evaluation = data.get("evaluation") or {}
    governor.log_decision(req, evaluation, False, False)
    return jsonify({"success": True})


@app.route("/api/confirm-withdrawal", methods=["POST"])
def api_confirm_withdrawal():
    """
    User confirms withdrawal. Execute it.
    Cosmo updates paper state / rebalances.
    """
    data = request.get_json(silent=True) or {}
    amount = float(data.get("amount") or 0)
    category = data.get("category")
    description = data.get("description", "")
    user_confirmed = data.get("confirmed", False)
    evaluation = data.get("evaluation") or {}

    if not user_confirmed:
        return jsonify({"success": False, "reason": "User did not confirm"}), 400

    req = {"amount": amount, "category": category, "description": description}
    admin_token = data.get("admin_token") or os.environ.get("COSMO_ADMIN_TOKEN")

    try:
        result = cosmo_client.request_withdrawal(
            amount, category or "general", description, admin_token=admin_token
        )
        governor.log_decision(req, evaluation, True, True)
        return jsonify(
            {
                "success": True,
                "message": "Withdrawal executed. Cosmo updating paper state…",
                "result": result,
            }
        )
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


def main() -> None:
    app.run(
        host=GLADE_DASHBOARD["host"],
        port=int(GLADE_DASHBOARD["port"]),
        debug=False,
    )


if __name__ == "__main__":
    main()
