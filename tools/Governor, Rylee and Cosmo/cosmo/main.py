"""
Cosmo entrypoint: schedules morning assessment, afternoon rebalance, evening DB backup.

Uses stdlib scheduling (no extra deps). Run from the `cosmo` directory:
  python main.py
"""

from __future__ import annotations

import logging
import os
import shutil
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

import config
import database as db
from bees.value_bee import ValueBee
from data import fetchers
from discovery import stage1_numerical
from reporting import dashboard
from research_bees.deep_operator import DeepOperator
from research_bees.gate_keeper import GateKeeper
from research_bees.moat_scout import MoatScout
from scoring.bss import BSS_Calculator
from trading.trading212_manual import Trading212Logger

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore[misc, assignment]


def _configure_logging() -> None:
    """File + stdout; systemd and remote tail use logs/cosmo.log."""
    log_dir = Path(config.LOGS_DIR)
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "cosmo.log"
    fmt = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(logging.INFO)
    fh = logging.FileHandler(log_path, encoding="utf-8")
    fh.setLevel(logging.INFO)
    fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stdout)
    sh.setLevel(logging.INFO)
    sh.setFormatter(fmt)
    root.addHandler(fh)
    root.addHandler(sh)


_configure_logging()
logger = logging.getLogger(__name__)


def wire_modules() -> None:
    """Explicit import surface so `main` fails fast if any subsystem is missing."""
    _ = (
        ValueBee,
        DeepOperator,
        GateKeeper,
        MoatScout,
        BSS_Calculator,
        Trading212Logger,
        stage1_numerical.stage1_screening,
    )
    del _


def _now_local() -> datetime:
    if ZoneInfo is None:
        return datetime.now()
    return datetime.now(ZoneInfo(config.TIMEZONE))


def run_morning_assessment() -> None:
    """Value Bee pass + printable recommendations."""
    logger.info("Morning assessment starting")
    try:
        recs = dashboard.get_daily_recommendations()
        logger.info("Morning assessment: %d recommendation rows", len(recs))
        for row in recs[:20]:
            logger.info(
                "  %s %s — %s",
                row.get("symbol"),
                row.get("action"),
                str(row.get("reason", ""))[:120],
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not log recommendation list: %s", exc)
    dashboard.print_dashboard()
    logger.info("Morning assessment finished")


def run_afternoon_rebalance() -> None:
    """Lightweight health check: VIX / hornet-style triggers."""
    logger.info("Afternoon rebalance check")
    vix = fetchers.fetch_vix()
    # Placeholder market return — wire index series later
    mkt_ret = 0.0
    hornet = False
    if vix is not None and vix >= config.HORNET_VIX_MIN:
        hornet = True
        logger.warning("Hornet: VIX %.2f >= %.2f", vix, config.HORNET_VIX_MIN)
    if mkt_ret <= config.HORNET_MARKET_DROP_PCT / 100.0:
        hornet = True
        logger.warning("Hornet: market return %.2f%%", mkt_ret * 100.0)
    summ = dashboard.get_portfolio_summary()
    bss = summ.get("bss")
    if bss is not None and bss < config.BSS_TARGET_PAPER * 100.0:
        logger.warning("Portfolio BSS %.2f below paper target %.2f", bss, config.BSS_TARGET_PAPER * 100.0)
    if hornet:
        logger.warning("Review defensive allocation — hornet triggers flagged.")


def run_evening_backup() -> None:
    """Copy SQLite DB to archive/; optional B2 sync left to rclone/CLI outside Cosmo."""
    src = Path(config.DATABASE_PATH)
    if not src.is_file():
        logger.warning("No database file at %s to back up", src)
        return
    stamp = _now_local().strftime("%Y%m%d_%H%M%S")
    dest = Path(config.ARCHIVE_DIR) / f"cosmo_{stamp}.db"
    shutil.copy2(src, dest)
    logger.info("Backed up database to %s", dest)
    if config.B2_BUCKET_URL:
        logger.info("B2 bucket configured (%s) — use rclone/aws CLI to push %s", config.B2_BUCKET_URL, dest)


def _start_governor_api_thread() -> None:
    """Background Flask API for Governor (port from config.GOVERNOR_API)."""
    try:
        from cosmo_api_server import run_api_server

        run_api_server()
    except Exception as exc:  # noqa: BLE001
        logging.getLogger(__name__).exception("Governor API server exited: %s", exc)


def _maybe_start_governor_api() -> None:
    flag = os.environ.get("COSMO_START_GOVERNOR_API", "").strip().lower()
    if flag not in ("1", "true", "yes", "on"):
        return
    t = threading.Thread(target=_start_governor_api_thread, name="cosmo-governor-api", daemon=True)
    t.start()
    logger.info("Governor API thread started (COSMO_START_GOVERNOR_API=%s)", flag)


def _run_at(hour: int, minute: int, fn: Callable[[], None], last_fired: Optional[str]) -> Optional[str]:
    now = _now_local()
    key = f"{now.date().isoformat()}_{hour:02d}{minute:02d}"
    if now.hour == hour and now.minute == minute and last_fired != key:
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            logger.exception("Scheduled job failed: %s", exc)
        return key
    return last_fired


def main() -> None:
    """Sleep in a loop; fire jobs when local wall clock hits configured slots."""
    wire_modules()
    db.get_db()
    _maybe_start_governor_api()
    logger.info("Cosmo scheduler running in %s", config.TIMEZONE)
    last_morning: Optional[str] = None
    last_afternoon: Optional[str] = None
    last_backup: Optional[str] = None
    while True:
        t_m = config.MORNING_ASSESSMENT_TIME
        t_a = config.AFTERNOON_REBALANCE_TIME
        t_b = config.EVENING_BACKUP_TIME
        last_morning = _run_at(t_m.hour, t_m.minute, run_morning_assessment, last_morning)
        last_afternoon = _run_at(t_a.hour, t_a.minute, run_afternoon_rebalance, last_afternoon)
        last_backup = _run_at(t_b.hour, t_b.minute, run_evening_backup, last_backup)
        # Sleep until next minute boundary to avoid busy spin
        time.sleep(20)


if __name__ == "__main__":
    main()
