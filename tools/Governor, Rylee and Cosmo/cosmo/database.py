"""
SQLite persistence for Cosmo: holdings, trades, assessments, BSS, regime log.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Optional

import config

_conn: Optional[sqlite3.Connection] = None


def _db_path() -> Path:
    return Path(config.DATABASE_PATH)


def init_db() -> None:
    """Create all Cosmo tables if they do not exist."""
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    try:
        cur = conn.cursor()
        cur.executescript(
            """
            CREATE TABLE IF NOT EXISTS holdings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                entry_price REAL NOT NULL,
                entry_date TEXT NOT NULL,
                quantity REAL NOT NULL,
                sector TEXT
            );
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                action TEXT NOT NULL,
                price REAL NOT NULL,
                quantity REAL NOT NULL,
                date TEXT NOT NULL,
                reason TEXT
            );
            CREATE TABLE IF NOT EXISTS assessments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                operator_score REAL,
                moat_score REAL,
                fqs_score REAL,
                date TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS bss_scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bee_name TEXT NOT NULL,
                bss_value REAL NOT NULL,
                date TEXT NOT NULL,
                regime TEXT
            );
            CREATE TABLE IF NOT EXISTS regime_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                regime TEXT NOT NULL,
                vix REAL,
                correlation REAL,
                drawdown REAL,
                date TEXT NOT NULL
            );
            """
        )
        conn.commit()
    finally:
        conn.close()


def _migrate(conn: sqlite3.Connection) -> None:
    """Apply additive schema for Governor / withdrawals."""
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS portfolio_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            cash_gbp REAL NOT NULL
        );
        """
    )
    cur.execute(
        "INSERT OR IGNORE INTO portfolio_state (id, cash_gbp) VALUES (1, ?)",
        (float(config.EMERGENCY_BUFFER_GBP),),
    )
    cur.execute("PRAGMA table_info(holdings)")
    cols = {row[1] for row in cur.fetchall()}
    if "bee" not in cols:
        try:
            cur.execute("ALTER TABLE holdings ADD COLUMN bee TEXT DEFAULT 'value'")
        except sqlite3.OperationalError:
            pass
    conn.commit()


def get_db() -> sqlite3.Connection:
    """Return a shared SQLite connection (creates DB file and schema on first use)."""
    global _conn
    if _conn is None:
        init_db()
        _conn = sqlite3.connect(_db_path(), check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _migrate(_conn)
    return _conn


def close_db() -> None:
    """Close the shared connection if open."""
    global _conn
    if _conn is not None:
        _conn.close()
        _conn = None
