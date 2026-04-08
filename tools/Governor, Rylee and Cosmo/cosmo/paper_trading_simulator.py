"""
Paper trading simulator: apply Value Bee logic using in-memory + JSON state (not SQLite holdings).

Tracks cash, holdings, marks to market, daily equity curve for BSS (0–100), and FTSE benchmark.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yfinance as yf

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import config
from bees.value_bee import ValueBee
from data.fetchers import fetch_stock_price, fetch_vix
from discovery.stage1_numerical import get_all_uk_stocks
from scoring.bss import BSS_Calculator

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(message)s")

_BENCHMARK = str(config.BACKTEST.get("uk_benchmark_symbol", "^FTSE"))


def _fetch_benchmark_close(on_date: date) -> Optional[float]:
    """FTSE (or configured index) close near `on_date` for benchmark comparison."""
    try:
        t = yf.Ticker(_BENCHMARK)
        start = on_date - timedelta(days=7)
        end = on_date + timedelta(days=1)
        hist = t.history(start=start.isoformat(), end=end.isoformat(), auto_adjust=True)
        if hist is None or hist.empty:
            return None
        hist = hist[hist.index.date <= on_date]
        if hist.empty:
            return None
        return float(hist["Close"].iloc[-1])
    except Exception as exc:  # noqa: BLE001
        logger.debug("benchmark fetch failed: %s", exc)
        return None


def _infer_regime_from_vix() -> str:
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


def paper_recommendation(bee: ValueBee, symbol: str, held: bool) -> str:
    """
    BUY / HOLD / SELL / REJECT using the same rules as Value Bee, but `held` reflects paper book.
    """
    a = bee.assess_candidate(symbol)
    if not a["passes_gates"]:
        return "REJECT"
    if not held:
        return "BUY"
    if a["fqs"] < config.GATE_FQS_MIN * 0.9:
        return "SELL"
    return "HOLD"


class PaperTradingSimulator:
    """Simulated portfolio with JSON persistence under DATA_DIR."""

    def __init__(self, initial_capital: Optional[float] = None) -> None:
        self.initial_capital = float(
            initial_capital if initial_capital is not None else config.INITIAL_CAPITAL_GBP
        )
        self.cash = self.initial_capital
        self.holdings: Dict[str, Dict[str, Any]] = {}
        self.trades: List[Dict[str, Any]] = []
        self.equity_history: List[Dict[str, Any]] = []
        self.benchmark_start: Optional[float] = None
        self.paper_started: Optional[str] = None

        pt = config.PAPER_TRADING
        self.paper_trades_file = config.DATA_DIR / str(pt["state_filename"])
        self.bss_calculator = BSS_Calculator()
        self.load_paper_state()

    def load_paper_state(self) -> None:
        if not self.paper_trades_file.is_file():
            return
        try:
            raw = json.loads(self.paper_trades_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Could not load paper state: %s", exc)
            return
        self.cash = float(raw.get("cash", self.initial_capital))
        self.holdings = dict(raw.get("holdings", {}))
        self.trades = list(raw.get("trades", []))
        self.equity_history = list(raw.get("equity_history", []))
        bs = raw.get("benchmark_start")
        self.benchmark_start = float(bs) if bs is not None else None
        self.paper_started = raw.get("paper_started")

    def save_paper_state(self) -> None:
        state = {
            "cash": self.cash,
            "holdings": self.holdings,
            "trades": self.trades,
            "equity_history": self.equity_history[-400:],
            "benchmark_start": self.benchmark_start,
            "paper_started": self.paper_started,
            "last_updated": datetime.now(timezone.utc).isoformat(),
        }
        self.paper_trades_file.parent.mkdir(parents=True, exist_ok=True)
        self.paper_trades_file.write_text(json.dumps(state, indent=2), encoding="utf-8")

    def _record_daily_equity(self) -> None:
        """One snapshot per calendar day for BSS and trends."""
        today = date.today().isoformat()
        value = self.calculate_paper_portfolio_value()
        if self.equity_history and self.equity_history[-1].get("date") == today:
            self.equity_history[-1]["value"] = value
            return
        if self.benchmark_start is None:
            bx = _fetch_benchmark_close(date.today())
            if bx is not None:
                self.benchmark_start = bx
        bench = _fetch_benchmark_close(date.today())
        self.equity_history.append(
            {
                "date": today,
                "value": value,
                "benchmark_close": bench,
            }
        )

    def run_daily_assessment(self) -> List[Dict[str, Any]]:
        """
        Scan a slice of the universe, execute a limited number of paper BUYs,
        and SELLs where paper book + gates say so.
        """
        if self.paper_started is None:
            self.paper_started = datetime.now(timezone.utc).date().isoformat()

        regime = _infer_regime_from_vix()
        bee = ValueBee(regime=regime)
        pt = config.PAPER_TRADING
        cap = int(pt["daily_universe_cap"])
        max_buys = int(pt["max_new_buys_per_day"])
        max_holdings = int(pt["max_holdings"])

        universe = get_all_uk_stocks()[:cap]
        recommendations: List[Dict[str, Any]] = []
        buys_done = 0

        for symbol in universe:
            held = symbol in self.holdings
            rec = paper_recommendation(bee, symbol, held)
            px = fetch_stock_price(symbol, date.today())

            if rec == "SELL" and held and px and px > 0:
                qty = float(self.holdings[symbol]["quantity"])
                self.execute_paper_trade(symbol, "SELL", px, qty, "Paper: Value Bee SELL")
                recommendations.append(
                    {
                        "symbol": symbol,
                        "action": "SELL",
                        "price": px,
                        "date": datetime.now(timezone.utc).isoformat(),
                    }
                )
            elif (
                rec == "BUY"
                and not held
                and px
                and px > 0
                and buys_done < max_buys
                and len(self.holdings) < max_holdings
            ):
                notional = min(
                    bee.calculate_position_size(self.cash + sum(self._position_value(sym) for sym in self.holdings), symbol),
                    self.cash * 0.99,
                )
                qty = notional / px if notional > 0 else 0.0
                if qty * px >= 50.0 and self.cash >= qty * px:
                    self.execute_paper_trade(symbol, "BUY", px, qty, "Paper: Value Bee BUY")
                    buys_done += 1
                    recommendations.append(
                        {
                            "symbol": symbol,
                            "action": "BUY",
                            "price": px,
                            "quantity": qty,
                            "date": datetime.now(timezone.utc).isoformat(),
                        }
                    )

        self._record_daily_equity()
        self.save_paper_state()
        return recommendations

    def _position_value(self, symbol: str) -> float:
        h = self.holdings.get(symbol)
        if not h:
            return 0.0
        px = fetch_stock_price(symbol, date.today()) or float(h.get("entry_price", 0.0))
        return float(h["quantity"]) * px

    def execute_paper_trade(
        self,
        symbol: str,
        action: str,
        price: float,
        quantity: float,
        reason: str = "",
    ) -> bool:
        symbol = symbol.upper()
        action = action.upper()
        notional = float(price) * float(quantity)

        if action == "BUY" and self.cash < notional:
            return False
        if action == "SELL":
            if symbol not in self.holdings:
                return False
            if float(self.holdings[symbol]["quantity"]) + 1e-9 < float(quantity):
                return False

        trade = {
            "symbol": symbol,
            "action": action,
            "price": float(price),
            "quantity": float(quantity),
            "notional": notional,
            "date": datetime.now(timezone.utc).isoformat(),
            "reason": reason,
        }
        self.trades.append(trade)

        if action == "BUY":
            self.cash -= notional
            if symbol not in self.holdings:
                self.holdings[symbol] = {
                    "quantity": 0.0,
                    "entry_price": float(price),
                    "entry_date": datetime.now(timezone.utc).date().isoformat(),
                }
            h = self.holdings[symbol]
            old_q = float(h["quantity"])
            new_q = old_q + float(quantity)
            if new_q > 0:
                h["entry_price"] = (old_q * float(h["entry_price"]) + notional) / new_q
            h["quantity"] = new_q
            return True

        if action == "SELL" and symbol in self.holdings:
            self.cash += notional
            h = self.holdings[symbol]
            h["quantity"] = float(h["quantity"]) - float(quantity)
            if h["quantity"] <= 1e-9:
                del self.holdings[symbol]
            return True

        return False

    def calculate_paper_portfolio_value(self) -> float:
        total = self.cash
        for symbol, h in list(self.holdings.items()):
            px = fetch_stock_price(symbol, date.today())
            if px is None:
                px = float(h.get("entry_price", 0.0))
            total += float(h["quantity"]) * px
        return float(total)

    def calculate_paper_returns(self) -> Dict[str, Any]:
        portfolio_value = self.calculate_paper_portfolio_value()
        gain_loss = portfolio_value - self.initial_capital
        pct_return = (gain_loss / self.initial_capital) * 100.0 if self.initial_capital > 0 else 0.0

        bench_pct = None
        excess = None
        if self.benchmark_start and self.benchmark_start > 0:
            bc = _fetch_benchmark_close(date.today())
            if bc:
                bench_pct = (bc / self.benchmark_start - 1.0) * 100.0
                excess = pct_return - bench_pct

        return {
            "portfolio_value": portfolio_value,
            "gain_loss": gain_loss,
            "pct_return": pct_return,
            "holdings_count": len(self.holdings),
            "benchmark_pct_return": bench_pct,
            "excess_vs_ftse_pct": excess,
        }

    def calculate_paper_bss(self) -> float:
        """BSS from daily equity curve (needs ≥2 days of history)."""
        regime = _infer_regime_from_vix()
        if len(self.equity_history) < 2:
            r = self.calculate_paper_returns()
            # Single scalar is not ideal for BSS; nudge from total return vs flat
            pseudo = [0.0, r["pct_return"] / 100.0]
            return self.bss_calculator.calculate_bee_bss(
                "paper_trading",
                [],
                pseudo,
                regime,
            )

        vals = [float(x["value"]) for x in self.equity_history if x.get("value") is not None]
        daily: List[float] = []
        for i in range(1, len(vals)):
            prev, cur = vals[i - 1], vals[i]
            if prev > 0:
                daily.append((cur - prev) / prev)
        if len(daily) < 2:
            return 50.0

        w = 1.0 / max(len(self.holdings), 1)
        holdings_maps = [{"weight": w, "drawdown_contrib": 0.0} for _ in self.holdings]
        return self.bss_calculator.calculate_bee_bss(
            "paper_trading",
            holdings_maps,
            daily,
            regime,
        )

    def get_summary(self) -> Dict[str, Any]:
        self._record_daily_equity()
        returns = self.calculate_paper_returns()
        bss = self.calculate_paper_bss()
        return {
            "portfolio_value": returns["portfolio_value"],
            "gain_loss": returns["gain_loss"],
            "pct_return": returns["pct_return"],
            "holdings_count": returns["holdings_count"],
            "benchmark_pct_return": returns["benchmark_pct_return"],
            "excess_vs_ftse_pct": returns["excess_vs_ftse_pct"],
            "bss": bss,
            "trades_executed": len(self.trades),
            "cash_available": self.cash,
            "equity_days": len(self.equity_history),
            "paper_started": self.paper_started,
        }


def main() -> Dict[str, Any]:
    sim = PaperTradingSimulator()
    sim.run_daily_assessment()
    summary = sim.get_summary()
    sim.save_paper_state()

    thr = float(config.BSS_TARGETS["paper_trading_threshold_0_100"])
    print("\nCOSMO PAPER TRADING SUMMARY")
    print("=" * 60)
    print(f"Portfolio value:    GBP {summary['portfolio_value']:,.2f}")
    print(f"Gain/loss:          GBP {summary['gain_loss']:,.2f} ({summary['pct_return']:.2f}%)")
    if summary.get("benchmark_pct_return") is not None:
        print(f"FTSE (since start): {summary['benchmark_pct_return']:.2f}%")
    if summary.get("excess_vs_ftse_pct") is not None:
        print(f"Excess vs FTSE:     {summary['excess_vs_ftse_pct']:.2f}%")
    print(f"Holdings:           {summary['holdings_count']}")
    print(f"Trades (all time):  {summary['trades_executed']}")
    print(f"Paper BSS (0-100):  {summary['bss']:.2f}  (live target >= {thr})")
    print(f"Cash:               GBP {summary['cash_available']:,.2f}")
    print(f"Equity snapshots:   {summary['equity_days']} days")
    print("=" * 60)
    return summary


if __name__ == "__main__":
    main()
