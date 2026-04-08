"""
Cosmo central configuration.

All magic numbers and paths live here so strategies, gates, and ops stay consistent.
"""

from __future__ import annotations

import os
from datetime import time
from pathlib import Path
from typing import Any, Dict, Final, Mapping

# Project root (directory containing this file)
BASE_DIR: Final[Path] = Path(__file__).resolve().parent

# --- Directories (created on import so downstream code can write safely) ---
DATA_DIR: Final[Path] = BASE_DIR / "data"
ARCHIVE_DIR: Final[Path] = BASE_DIR / "archive"
LOGS_DIR: Final[Path] = BASE_DIR / "logs"
DISCOVERY_OUTPUT_DIR: Final[Path] = DATA_DIR / "discovery"

for _d in (DATA_DIR, ARCHIVE_DIR, LOGS_DIR, DISCOVERY_OUTPUT_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# --- Database ---
DATABASE_PATH: Final[Path] = BASE_DIR / "cosmo.db"

# --- UK trading day anchors (local Europe/London; align with LSE cash session) ---
TIMEZONE: Final[str] = "Europe/London"
MORNING_ASSESSMENT_TIME: Final[time] = time(8, 30)
AFTERNOON_REBALANCE_TIME: Final[time] = time(16, 25)
EVENING_BACKUP_TIME: Final[time] = time(23, 0)

# --- Gate thresholds (baseline; regime overrides below) ---
GATE_OPERATOR_MIN: Final[float] = 5.0
GATE_MOAT_MIN: Final[float] = 4.0
GATE_FQS_MIN: Final[float] = 60.0

# --- Capital & risk ---
EMERGENCY_BUFFER_GBP: Final[float] = 8000.0
DEFENSIVE_FLOOR_PCT: Final[float] = 0.13  # 13% minimum defensive sleeve (conceptual)
INITIAL_CAPITAL_GBP: Final[float] = 8000.0
MAX_SINGLE_POSITION_PCT: Final[float] = 0.06  # 6% per holding cap for Value Bee sizing

# --- Milestones (GBP target by age) ---
MILESTONES_GBP: Final[Dict[int, float]] = {
    27: 42_000.0,
    30: 70_000.0,
    33: 100_000.0,
    41: 184_000.0,
}

# --- Regime detection thresholds (indicative; dashboard / main can refine) ---
REGIME_THRESHOLDS: Final[Dict[str, Dict[str, float]]] = {
    "bull": {"vix_max": 18.0, "corr_max": 0.75, "ret_min_lookback": 0.03},
    "sideways": {"vix_max": 22.0, "corr_max": 0.85, "ret_min_lookback": -0.02},
    "bear": {"vix_max": 30.0, "corr_max": 0.92, "ret_min_lookback": -0.08},
    "crisis": {"vix_min": 30.0, "corr_min": 0.90, "dd_min": 0.15},
}

# Per-regime gate strictness (operator, moat, FQS minima)
REGIME_GATE_THRESHOLDS: Final[Dict[str, Dict[str, float]]] = {
    "bull": {"operator": 5.0, "moat": 4.0, "fqs": 60.0},
    "sideways": {"operator": 5.5, "moat": 4.5, "fqs": 62.0},
    "bear": {"operator": 6.0, "moat": 5.0, "fqs": 65.0},
    "crisis": {"operator": 7.0, "moat": 6.0, "fqs": 70.0},
}

# Bee strategy weights by regime (must sum to ~1.0 per regime)
BEE_ALLOCATIONS: Final[Dict[str, Dict[str, float]]] = {
    "bull": {"value": 0.35, "growth": 0.25, "income": 0.20, "defensive": 0.20},
    "sideways": {"value": 0.40, "growth": 0.15, "income": 0.25, "defensive": 0.20},
    "bear": {"value": 0.45, "growth": 0.10, "income": 0.20, "defensive": 0.25},
    "crisis": {"value": 0.25, "growth": 0.05, "income": 0.20, "defensive": 0.50},
}

# Hornet (stress) triggers — any can flag defensive posture
HORNET_MARKET_DROP_PCT: Final[float] = -5.0
HORNET_VIX_MIN: Final[float] = 30.0
HORNET_CORRELATION_MIN: Final[float] = 0.95

# BSS targets (0–1 scale used alongside 0–100 scores in modules; see scoring/bss.py)
BSS_TARGET_LIVE: Final[float] = 0.65
BSS_TARGET_PAPER: Final[float] = 0.60

# Backtest + paper gate (BSS from scoring/bss.py is 0–100)
BACKTEST: Final[Dict[str, Any]] = {
    "start_year": 1990,
    "end_year": 2025,
    "random_quarters_count": 20,
    # Benchmark-only BSS tends to cluster ~58–64; 60 matches README “backtest >0.60”.
    "avg_bss_min_0_100": 60.0,
    "min_quarter_bss_floor_0_100": 55.0,
    "uk_benchmark_symbol": "^FTSE",
    # Fixed seed = reproducible CI / week2_run; set None to re-roll quarters each run.
    "random_seed": 42,
}

BSS_TARGETS: Final[Dict[str, float]] = {
    # Stricter hurdle before scaling real capital (90-day paper + live).
    "paper_trading_threshold_0_100": 65.0,
    "backtest_avg_min_0_100": 60.0,
    "backtest_quarter_floor_0_100": 55.0,
}

# Paper trading (Week 3): zero-capital simulation
PAPER_TRADING: Final[Dict[str, Any]] = {
    "duration_days": 90,
    # Each symbol triggers multiple yfinance calls via Value Bee; increase when stable.
    "daily_universe_cap": 20,
    "max_new_buys_per_day": 5,
    "max_holdings": 25,
    "state_filename": "paper_trades.json",
    "metrics_filename": "monitoring_metrics.json",
}

# Stage-1 screening defaults
STAGE1_MIN_MARKET_CAP: Final[float] = 500_000_000.0
STAGE1_MIN_AVG_VOLUME: Final[float] = 5_000_000.0
STAGE1_MAX_PE: Final[float] = 15.0
STAGE1_TARGET_MIN: Final[int] = 200
STAGE1_TARGET_MAX: Final[int] = 300

# Universe file: one symbol per line (e.g. VOD.L); expand toward 5k+ over time
UK_UNIVERSE_FILE: Final[Path] = DATA_DIR / "uk_universe.txt"

# Backup: local archive copy always; B2 upload optional via env
B2_BUCKET_URL: Final[str | None] = os.environ.get("COSMO_B2_BUCKET_URL")
B2_ARCHIVE_PREFIX: Final[str] = "cosmo-backups"


def _fmt_clock(t: time) -> str:
    return f"{t.hour:02d}:{t.minute:02d}"


# --- README-facing aliases (same values as above; introspection & doc parity) ---
TRADING_HOURS: Final[Dict[str, str]] = {
    "morning_open": _fmt_clock(MORNING_ASSESSMENT_TIME),
    "afternoon_close": _fmt_clock(AFTERNOON_REBALANCE_TIME),
    "evening_backup": _fmt_clock(EVENING_BACKUP_TIME),
}

GATES: Final[Dict[str, float]] = {
    "operator_score": GATE_OPERATOR_MIN,
    "moat_score": GATE_MOAT_MIN,
    "fqs_score": GATE_FQS_MIN,
}

MILESTONES: Final[Dict[str, Dict[str, float | int]]] = {
    "level_1": {"target": float(MILESTONES_GBP[27]), "age": 27},
    "level_2": {"target": float(MILESTONES_GBP[30]), "age": 30},
    "level_3": {"target": float(MILESTONES_GBP[33]), "age": 33},
    "level_4": {"target": float(MILESTONES_GBP[41]), "age": 41},
}

INITIAL_CAPITAL: Final[float] = INITIAL_CAPITAL_GBP
EMERGENCY_BUFFER: Final[float] = EMERGENCY_BUFFER_GBP
DEFENSIVE_FLOOR: Final[float] = DEFENSIVE_FLOOR_PCT

# Governor / integration docs expect LOG_DIR
LOG_DIR: Final[Path] = LOGS_DIR

# --- Liquid buffer (scales with NAV; Governor withdrawal guardrails) ---
LIQUID_BUFFER_TARGET_BY_PORTFOLIO: Final[Dict[int, float]] = {
    0: 8_000.0,
    25_000: 10_000.0,
    50_000: 12_000.0,
    100_000: 15_000.0,
    500_000: 25_000.0,
}


def calculate_liquid_buffer_target(portfolio_value: float) -> float:
    """Target liquid GBP to hold as NAV grows (piecewise thresholds)."""
    pv = float(portfolio_value)
    for threshold in sorted(LIQUID_BUFFER_TARGET_BY_PORTFOLIO.keys(), reverse=True):
        if pv >= float(threshold):
            return float(LIQUID_BUFFER_TARGET_BY_PORTFOLIO[threshold])
    return 8_000.0


LIQUID_BUFFER: Final[Dict[str, Any]] = {
    "target_base": EMERGENCY_BUFFER_GBP,
    "min_floor": 6_000.0,
    "max_pct_of_portfolio": 0.15,
    "auto_scale": True,
    "rebalance_on_withdrawal": True,
}

WITHDRAWAL: Final[Dict[str, Any]] = {
    "enabled": True,
    "min_portfolio_for_withdrawal": 25_000.0,
    "max_withdrawal_pct_of_buffer": 0.8,
    "min_bss_for_withdrawal": 50.0,
    "min_cash_post_withdrawal": 6_000.0,
    "rebalance_target_delta_pct": 2.0,
    "raise_shortfall_tolerance": 0.95,
}

# Sell priority when trimming (keys = rough regime buckets; values = bee names to cut first)
BEE_REBALANCE_PRIORITY: Final[Dict[str, list[str]]] = {
    "bull_low_vol": ["growth", "income", "value", "defensive"],
    "bull_high_vol": ["growth", "value", "income", "defensive"],
    "normal": ["growth", "income", "value", "defensive"],
    "high_vol": ["growth", "value"],
    "crisis": ["growth", "income", "value", "defensive"],
}

WITHDRAWAL_AUDIT: Final[Dict[str, Any]] = {
    "log_to_file": True,
    "log_file": "withdrawals.json",
    "log_trades": True,
    "log_allocations": True,
}

# Governor HTTP API (avoid clashing with monitoring.remote_dashboard on 5000)
GOVERNOR_API: Final[Dict[str, Any]] = {
    "host": os.environ.get("COSMO_GOVERNOR_API_BIND", "0.0.0.0"),
    "port": int(os.environ.get("COSMO_GOVERNOR_API_PORT", "5050")),
}


def get_gate_thresholds_for_regime(regime: str) -> Dict[str, float]:
    """Return operator/moat/FQS minima for a named regime (falls back to baseline)."""
    r = (regime or "sideways").lower()
    m: Mapping[str, float] = REGIME_GATE_THRESHOLDS.get(
        r,
        {
            "operator": GATE_OPERATOR_MIN,
            "moat": GATE_MOAT_MIN,
            "fqs": GATE_FQS_MIN,
        },
    )
    return {"operator": float(m["operator"]), "moat": float(m["moat"]), "fqs": float(m["fqs"])}


def milestone_table() -> Dict[str, Any]:
    """Human-readable milestone snapshot for reporting."""
    return {
        "emergency_buffer_gbp": EMERGENCY_BUFFER_GBP,
        "defensive_floor_pct": DEFENSIVE_FLOOR_PCT,
        "milestones_gbp": dict(MILESTONES_GBP),
        "initial_capital_gbp": INITIAL_CAPITAL_GBP,
    }
