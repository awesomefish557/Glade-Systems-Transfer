"""
Cron-friendly health check: verify `cosmo` systemd unit; optional auto-restart.

Run every 5 minutes on the server:
  */5 * * * * cd /path/to/cosmo && ./venv/bin/python health_check.py

Requires passwordless sudo for `systemctl restart cosmo` if COSMO_HEALTH_RESTART=1:
  cosmo ALL=(ALL) NOPASSWD: /bin/systemctl restart cosmo
"""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import config


def _log(path: Path, line: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def check_service() -> bool:
    if sys.platform == "win32":
        return True
    try:
        r = subprocess.run(
            ["systemctl", "is-active", "cosmo"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        return r.returncode == 0 and r.stdout.strip() == "active"
    except (OSError, subprocess.TimeoutExpired):
        return False


def send_alert(message: str) -> None:
    log_path = Path(config.LOGS_DIR) / "alerts.log"
    _log(log_path, f"{datetime.now(timezone.utc).isoformat()} {message}")


def main() -> None:
    logs = Path(config.LOGS_DIR)
    health_log = logs / "health.log"
    ok = check_service()
    ts = datetime.now(timezone.utc).isoformat()
    _log(health_log, f"{ts} cosmo_active={ok}")

    if not ok and sys.platform != "win32":
        send_alert("COSMO systemd unit not active")
        if os.environ.get("COSMO_HEALTH_RESTART", "1") not in ("0", "false", "no"):
            try:
                subprocess.run(
                    ["sudo", "-n", "systemctl", "restart", "cosmo"],
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
                send_alert("Attempted: sudo systemctl restart cosmo (check sudoers if no effect)")
            except (OSError, subprocess.TimeoutExpired) as exc:
                send_alert(f"Restart failed: {exc}")


if __name__ == "__main__":
    main()
