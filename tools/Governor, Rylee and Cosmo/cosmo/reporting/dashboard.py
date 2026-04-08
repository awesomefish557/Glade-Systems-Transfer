"""
Text-first dashboard: portfolio, recommendations, BSS snapshot, milestone progress.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

import config
import database as db
from bees.value_bee import ValueBee
from data import fetchers
from scoring.bss import BSS_Calculator

logger = logging.getLogger(__name__)


def _infer_regime() -> str:
    """Cheap regime hint from VIX only; extend with correlation series later."""
    vix = fetchers.fetch_vix()
    if vix is None:
        return "sideways"
    if vix >= config.REGIME_THRESHOLDS["crisis"]["vix_min"]:
        return "crisis"
    if vix >= config.REGIME_THRESHOLDS["bear"]["vix_max"]:
        return "bear"
    if vix <= config.REGIME_THRESHOLDS["bull"]["vix_max"]:
        return "bull"
    return "sideways"


def get_portfolio_summary() -> Dict[str, Any]:
    """Holdings snapshot with naive mark-to-market using last close."""
    bee = ValueBee(regime=_infer_regime())
    holdings = bee.get_portfolio()
    total = 0.0
    enriched: List[Dict[str, Any]] = []
    for h in holdings:
        sym = h["symbol"]
        px = fetchers.fetch_stock_price(sym, date.today())
        qty = float(h["quantity"])
        mv = qty * float(px or h["entry_price"])
        total += mv
        enriched.append({**h, "last_price": px, "market_value_gbp": mv})
    regime = _infer_regime()
    alloc = config.BEE_ALLOCATIONS.get(regime, config.BEE_ALLOCATIONS["sideways"])
    bss_calc = BSS_Calculator()
    bee_scores = {"value": 55.0, "growth": 52.0, "income": 53.0, "defensive": 54.0}
    portfolio_bss = bss_calc.calculate_portfolio_bss(bee_scores, alloc)
    return {
        "total_value": total,
        "holdings": enriched,
        "allocations": alloc,
        "bss": portfolio_bss,
        "regime": regime,
    }


def get_daily_recommendations(symbols: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Value Bee recommendations for a watchlist (defaults to current holdings)."""
    bee = ValueBee(regime=_infer_regime())
    if symbols is None:
        symbols = [h["symbol"] for h in bee.get_portfolio()]
        if not symbols:
            symbols = ["VOD.L", "BP.L"]
    out: List[Dict[str, Any]] = []
    for sym in symbols:
        rec = bee.get_recommendation(sym)
        px = fetchers.fetch_stock_price(sym, date.today())
        a = bee.assess_candidate(sym)
        reason = "passed gates" if a["passes_gates"] else "; ".join(a.get("gate_reasons") or [])
        out.append({"symbol": sym, "action": rec, "reason": reason, "price": px})
    return out


def get_bss_status() -> Dict[str, Any]:
    """Bee-level BSS placeholders until performance table is wired."""
    regime = _infer_regime()
    alloc = config.BEE_ALLOCATIONS.get(regime, config.BEE_ALLOCATIONS["sideways"])
    calc = BSS_Calculator()
    bees = {"value": 58.0, "growth": 55.0, "income": 57.0, "defensive": 56.0}
    port = calc.calculate_portfolio_bss(bees, alloc)
    return {
        "bee_scores": bees,
        "portfolio_bss": port,
        "interpretation": calc.get_bss_interpretation(port),
    }


def get_level_progress(current_age: int, net_worth: float) -> Dict[str, Any]:
    """Map net worth to next milestone from config."""
    milestones = sorted(config.MILESTONES_GBP.items())
    next_age, target = milestones[-1]
    prev_val = 0.0
    for age, tgt in milestones:
        if net_worth < tgt:
            next_age, target = age, tgt
            break
        prev_val = tgt
    progress_pct = min(100.0, max(0.0, (net_worth - prev_val) / max(target - prev_val, 1.0) * 100.0))
    return {
        "current_level": f"Toward age {next_age} target",
        "progress_pct": round(progress_pct, 2),
        "age_estimate": current_age,
        "next_target_gbp": target,
    }


def print_dashboard() -> None:
    """Emit a formatted snapshot to stdout."""
    summ = get_portfolio_summary()
    bss = get_bss_status()
    prog = get_level_progress(current_age=27, net_worth=float(summ["total_value"] or config.INITIAL_CAPITAL_GBP))
    recs = get_daily_recommendations()
    print("=== Cosmo Dashboard ===")
    print(f"Regime: {summ['regime']}  |  Portfolio BSS: {summ['bss']:.1f}")
    print(f"Total value (approx): £{summ['total_value']:,.2f}")
    print("BSS:", bss["interpretation"], "| bees:", bss["bee_scores"])
    print("Progress:", prog)
    print("-- Recommendations --")
    for r in recs:
        print(f"  {r['symbol']}: {r['action']} @ {r['price']} — {r['reason']}")
