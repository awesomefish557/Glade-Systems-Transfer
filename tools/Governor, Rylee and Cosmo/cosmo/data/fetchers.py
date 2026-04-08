"""
Yahoo Finance-backed helpers for prices, fundamentals, and macro (VIX).

Failures return None for optional floats or empty DataFrame where appropriate.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Optional

import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)


def fetch_stock_price(symbol: str, on_date: date) -> Optional[float]:
    """Close price for `symbol` on `on_date` (nearest prior session if holiday)."""
    try:
        t = yf.Ticker(symbol)
        start = on_date - timedelta(days=10)
        end = on_date + timedelta(days=1)
        hist = t.history(start=start.isoformat(), end=end.isoformat(), auto_adjust=True)
        if hist is None or hist.empty:
            return None
        hist = hist[hist.index.date <= on_date]
        if hist.empty:
            return None
        return float(hist["Close"].iloc[-1])
    except Exception as exc:  # noqa: BLE001 — yfinance is noisy; log and degrade
        logger.debug("fetch_stock_price failed for %s: %s", symbol, exc)
        return None


def fetch_daily_data(symbol: str, days: int = 252) -> pd.DataFrame:
    """OHLCV history for the last `days` trading days."""
    try:
        t = yf.Ticker(symbol)
        end = datetime.utcnow().date()
        start = end - timedelta(days=int(days * 1.5))
        hist = t.history(start=start.isoformat(), end=end.isoformat(), auto_adjust=True)
        if hist is None or hist.empty:
            return pd.DataFrame()
        return hist.tail(days)
    except Exception as exc:
        logger.debug("fetch_daily_data failed for %s: %s", symbol, exc)
        return pd.DataFrame()


def fetch_pe_ratio(symbol: str) -> Optional[float]:
    try:
        t = yf.Ticker(symbol)
        info = t.info or {}
        pe = info.get("trailingPE") or info.get("forwardPE")
        if pe is None:
            return None
        v = float(pe)
        return v if v > 0 else None
    except Exception as exc:
        logger.debug("fetch_pe_ratio failed for %s: %s", symbol, exc)
        return None


def fetch_market_cap(symbol: str) -> Optional[float]:
    try:
        t = yf.Ticker(symbol)
        info = t.info or {}
        cap = info.get("marketCap")
        if cap is None:
            return None
        return float(cap)
    except Exception as exc:
        logger.debug("fetch_market_cap failed for %s: %s", symbol, exc)
        return None


def fetch_volume(symbol: str) -> Optional[float]:
    """20-day average daily volume (shares)."""
    try:
        df = fetch_daily_data(symbol, days=30)
        if df.empty or "Volume" not in df.columns:
            return None
        vol = df["Volume"].tail(20).mean()
        return float(vol) if vol == vol else None  # NaN check
    except Exception as exc:
        logger.debug("fetch_volume failed for %s: %s", symbol, exc)
        return None


def fetch_dividend_yield(symbol: str) -> Optional[float]:
    try:
        t = yf.Ticker(symbol)
        info = t.info or {}
        dy = info.get("dividendYield")
        if dy is None:
            return None
        v = float(dy)
        if v > 1.0:
            v /= 100.0
        return v
    except Exception as exc:
        logger.debug("fetch_dividend_yield failed for %s: %s", symbol, exc)
        return None


def fetch_vix() -> Optional[float]:
    try:
        t = yf.Ticker("^VIX")
        hist = t.history(period="5d", auto_adjust=True)
        if hist is None or hist.empty:
            return None
        return float(hist["Close"].iloc[-1])
    except Exception as exc:
        logger.debug("fetch_vix failed: %s", exc)
        return None
