"""
Smoke tests for Cosmo core modules. Run before backtests.

  pytest tests/test_foundation.py -v
  python tests/test_foundation.py
"""

from __future__ import annotations

from datetime import date

import pytest

import config
import database as db
from bees.value_bee import ValueBee
from data.fetchers import fetch_stock_price, fetch_vix
from discovery.stage1_numerical import get_all_uk_stocks
from reporting.dashboard import get_portfolio_summary
from research_bees.deep_operator import DeepOperator
from research_bees.gate_keeper import GateKeeper
from research_bees.moat_scout import MoatScout
from scoring.bss import BSS_Calculator
from trading.trading212_manual import Trading212Logger


def test_config_loads() -> None:
    assert config.INITIAL_CAPITAL == 8000.0
    assert config.GATE_OPERATOR_MIN == 5.0
    assert "start_year" in config.BACKTEST
    assert "paper_trading_threshold_0_100" in config.BSS_TARGETS


def test_database_init() -> None:
    db.init_db()
    conn = db.get_db()
    assert conn is not None
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='holdings'")
    assert cur.fetchone() is not None
    db.close_db()


@pytest.mark.network
def test_fetchers() -> None:
    price = fetch_stock_price("VOD.L", date.today())
    vix = fetch_vix()
    assert price is None or isinstance(price, float)
    assert vix is None or isinstance(vix, float)


def test_bss_calculator() -> None:
    calc = BSS_Calculator()
    bss = calc.calculate_bee_bss(
        "value_bee",
        [],
        [0.001, -0.002, 0.0015, 0.0003, -0.0005],
        "bull",
    )
    assert 0.0 <= bss <= 100.0


@pytest.mark.network
def test_value_bee() -> None:
    bee = ValueBee(regime="bull")
    rec = bee.get_recommendation("VOD.L")
    assert rec in ("BUY", "HOLD", "SELL", "REJECT")


@pytest.mark.network
def test_deep_operator() -> None:
    op = DeepOperator()
    tests = op.run_8_tests("HSBA.L")
    assert len(tests) == 8
    score = op.assess_operator("HSBA.L")
    assert 0.0 <= score <= 10.0


@pytest.mark.network
def test_moat_scout() -> None:
    ms = MoatScout()
    m = ms.assess_moat("BP.L", sector="Energy")
    assert 0.0 <= m <= 10.0


def test_gates() -> None:
    gk = GateKeeper(log_rejections=False)
    assert gk.apply_gates("X.L", 6.0, 5.0, 70.0, "bull") is True
    assert gk.apply_gates("X.L", 4.0, 5.0, 70.0, "bull") is False


def test_discovery_universe() -> None:
    all_stocks = get_all_uk_stocks()
    assert isinstance(all_stocks, list)
    assert len(all_stocks) > 0


@pytest.mark.network
@pytest.mark.slow
def test_discovery_screening_tiny_sample() -> None:
    """Hits yfinance; keep list tiny."""
    syms = get_all_uk_stocks()[:5]
    from discovery.stage1_numerical import stage1_screening

    out = stage1_screening(syms)
    assert isinstance(out, list)


def test_trading_logger() -> None:
    log = Trading212Logger()
    assert log.get_trade_history() is not None


def test_dashboard() -> None:
    summary = get_portfolio_summary()
    assert "total_value" in summary
    assert "holdings" in summary
    assert "regime" in summary


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v", "-m", "not slow"]))
