"""
One-shot deployment helper for Cosmo on a Linux host (e.g. Latitude 5290).

Prefers OpenSSH client + scp in PATH. Builds a gzipped tarball (excludes venv, .git),
uploads it, unpacks, creates venv, runs tests, writes .env, installs systemd units.

Usage (from `cosmo/`):

  python deploy_to_latitude.py
  python deploy_to_latitude.py --host 1.2.3.4 --user ubuntu --dry-run

Requires: ssh, scp (Windows: install OpenSSH Client optional feature).
Remote: sudo without password for systemd, or run the systemd block manually.
"""

from __future__ import annotations

import argparse
import base64
import getpass
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path
from typing import Callable, List, Optional, Sequence, Tuple

_LOCAL_ROOT = Path(__file__).resolve().parent

_EXCLUDE_DIR_NAMES = {"venv", "__pycache__", ".git", ".pytest_cache", "node_modules"}
_EXCLUDE_SUFFIXES = {".pyc", ".db-wal"}


def _should_skip(path: Path, root: Path) -> bool:
    try:
        rel = path.relative_to(root)
    except ValueError:
        return True
    for part in rel.parts:
        if part in _EXCLUDE_DIR_NAMES:
            return True
        if part.startswith(".") and part not in (".", ".."):
            return True
    if path.suffix in _EXCLUDE_SUFFIXES:
        return True
    if path.name == ".env":
        return True
    if path.suffix == ".db":
        return True
    return False


def _build_tarball(src: Path) -> Path:
    """Write cosmo-deploy.tgz to a temp file; return path."""
    fd, tpath = tempfile.mkstemp(suffix=".tgz")
    os.close(fd)
    out = Path(tpath)
    with tarfile.open(out, "w:gz") as tar:
        for p in src.rglob("*"):
            if p.is_dir():
                continue
            if _should_skip(p, src):
                continue
            tar.add(p, arcname=p.relative_to(src))
    return out


def _run(
    args: Sequence[str],
    *,
    shell: bool = False,
    capture: bool = True,
) -> Tuple[int, str, str]:
    r = subprocess.run(
        list(args) if not shell else args,
        shell=shell,
        capture_output=capture,
        text=True,
    )
    out = (r.stdout or "") + (r.stderr or "")
    err = r.stderr or ""
    return r.returncode, out, err


class LatitudeDeployer:
    """Push Cosmo to a remote Linux directory and register systemd services."""

    def __init__(
        self,
        server_ip: str,
        server_user: str,
        server_path: str = "/home/cosmo/cosmo",
        ssh_port: int = 22,
    ) -> None:
        self.server_ip = server_ip.strip()
        self.server_user = server_user.strip()
        self.server_path = server_path.rstrip("/")
        self.ssh_port = int(ssh_port)
        self.local_path = _LOCAL_ROOT
        self._target = f"{self.server_user}@{self.server_ip}"

    def _ssh_base(self) -> List[str]:
        return ["ssh", "-p", str(self.ssh_port), self._target]

    def _scp_to_remote(self, local: Path, remote_path: str) -> Tuple[int, str]:
        code, out, err = _run(
            [
                "scp",
                "-P",
                str(self.ssh_port),
                str(local),
                f"{self._target}:{remote_path}",
            ]
        )
        return code, out + err

    def run_remote(self, bash_cmd: str, description: str, dry_run: bool) -> bool:
        print(f"\n>> {description}")
        full = ["bash", "-lc", bash_cmd]
        cmd = self._ssh_base() + full
        if dry_run:
            print("   [dry-run]", " ".join(cmd))
            return True
        code, out, err = _run(cmd)
        if out.strip():
            print(out[:2000])
        if code != 0:
            print(f"   FAILED (exit {code}): {err[:500]}")
            return False
        print("   OK")
        return True

    def test_connection(self, dry_run: bool) -> bool:
        print(f"\n== Test SSH to {self._target} ==")
        if dry_run:
            return True
        code, _, err = _run(self._ssh_base() + ["echo", "OK"])
        if code != 0:
            print(f"SSH failed: {err}")
            return False
        print("SSH OK")
        return True

    def copy_files(self, dry_run: bool) -> bool:
        print("\n== Pack and upload codebase ==")
        tgz = _build_tarball(self.local_path)
        try:
            remote_tgz = f"/tmp/cosmo-deploy-{self.server_user}.tgz"
            if dry_run:
                print(f"   [dry-run] would upload {tgz} -> {remote_tgz}")
                return True
            code, msg = self._scp_to_remote(tgz, remote_tgz)
            if code != 0:
                print(f"scp failed: {msg}")
                return False
            unpack = (
                f"set -e; mkdir -p {self.server_path}; "
                f"tar -xzf {remote_tgz} -C {self.server_path}; "
                f"rm -f {remote_tgz}; mkdir -p {self.server_path}/logs"
            )
            return self.run_remote(unpack, "Unpack on server", dry_run)
        finally:
            try:
                tgz.unlink(missing_ok=True)
            except OSError:
                pass

    def setup_venv(self, dry_run: bool) -> bool:
        p = self.server_path
        cmds: List[Tuple[str, str]] = [
            (
                f"cd {p} && python3 -m venv venv",
                "Create venv",
            ),
            (
                f"cd {p} && ./venv/bin/pip install -q --upgrade pip && ./venv/bin/pip install -q -r requirements.txt",
                "Install dependencies",
            ),
            (
                f"cd {p} && ./venv/bin/python -m pytest tests/test_foundation.py -q -m 'not slow'",
                "Foundation tests",
            ),
        ]
        for bash_cmd, desc in cmds:
            if not self.run_remote(bash_cmd, desc, dry_run):
                return False
        return True

    def setup_env_file(
        self,
        api_key: str,
        b2_key: Optional[str],
        b2_bucket: Optional[str],
        dry_run: bool,
    ) -> bool:
        p = self.server_path
        lines = "\n".join(
            [
                f"ANTHROPIC_API_KEY={api_key}",
                f"COSMO_B2_BUCKET_URL={b2_bucket or ''}",
                f"B2_APPLICATION_KEY={b2_key or ''}",
                "",
            ]
        )
        b64 = base64.b64encode(lines.encode("utf-8")).decode("ascii")
        cmd = f"echo {b64} | base64 -d > {p}/.env && chmod 600 {p}/.env"
        return self.run_remote(cmd, "Write .env (chmod 600)", dry_run)

    def _unit_cosmo(self) -> str:
        py = f"{self.server_path}/venv/bin/python"
        main_py = f"{self.server_path}/main.py"
        log = f"{self.server_path}/logs/cosmo.log"
        return f"""[Unit]
Description=Cosmo scheduler (main.py)
After=network.target

[Service]
Type=simple
User={self.server_user}
WorkingDirectory={self.server_path}
ExecStart={py} {main_py}
Restart=always
RestartSec=15
Environment=PYTHONUNBUFFERED=1
StandardOutput=append:{log}
StandardError=append:{log}

[Install]
WantedBy=multi-user.target
"""

    def _unit_dashboard(self) -> str:
        py = f"{self.server_path}/venv/bin/python"
        log = f"{self.server_path}/logs/dashboard.log"
        return f"""[Unit]
Description=Cosmo remote Flask dashboard
After=network.target

[Service]
Type=simple
User={self.server_user}
WorkingDirectory={self.server_path}
ExecStart={py} -m monitoring.remote_dashboard
Restart=always
RestartSec=10
Environment=PYTHONUNBUFFERED=1
Environment=COSMO_REMOTE_DASHBOARD_BIND=0.0.0.0
Environment=COSMO_REMOTE_DASHBOARD_PORT=5000
StandardOutput=append:{log}
StandardError=append:{log}

[Install]
WantedBy=multi-user.target
"""

    def setup_systemd(self, dry_run: bool) -> bool:
        print("\n== systemd (requires sudo on remote) ==")
        u1 = self._unit_cosmo()
        u2 = self._unit_dashboard()
        if dry_run:
            print("   [dry-run] would install cosmo.service + cosmo-dashboard.service")
            return True
        tmp1 = Path(tempfile.mkstemp(suffix=".service")[1])
        tmp2 = Path(tempfile.mkstemp(suffix=".service")[1])
        try:
            tmp1.write_text(u1, encoding="utf-8")
            tmp2.write_text(u2, encoding="utf-8")
            r1 = self._scp_to_remote(tmp1, "/tmp/cosmo.service")
            r2 = self._scp_to_remote(tmp2, "/tmp/cosmo-dashboard.service")
            if r1[0] != 0 or r2[0] != 0:
                print("scp unit files failed")
                return False
            script = (
                "set -e; "
                "sudo install -m 644 /tmp/cosmo.service /etc/systemd/system/cosmo.service; "
                "sudo install -m 644 /tmp/cosmo-dashboard.service /etc/systemd/system/cosmo-dashboard.service; "
                "sudo systemctl daemon-reload; "
                "sudo systemctl enable cosmo cosmo-dashboard; "
                "sudo systemctl restart cosmo || sudo systemctl start cosmo; "
                "sudo systemctl restart cosmo-dashboard || sudo systemctl start cosmo-dashboard"
            )
            return self.run_remote(script, "Install and start cosmo + cosmo-dashboard", dry_run)
        finally:
            tmp1.unlink(missing_ok=True)
            tmp2.unlink(missing_ok=True)

    def setup_health_cron(self, dry_run: bool) -> bool:
        py = f"{self.server_path}/venv/bin/python"
        line = f"*/5 * * * * cd {self.server_path} && {py} health_check.py >> {self.server_path}/logs/health_cron.log 2>&1"
        # Idempotent-ish: remove old cosmo health lines then append
        script = (
            f"set -e; "
            f"(crontab -l 2>/dev/null | grep -v 'health_check.py' || true) | crontab -; "
            f"(crontab -l 2>/dev/null; echo '{line}') | crontab -"
        )
        return self.run_remote(script, "Cron: health_check every 5 minutes", dry_run)

    def setup_backup_cron(self, dry_run: bool) -> bool:
        line = f"0 23 * * * rclone sync {self.server_path}/data/ b2:cosmo-backup/ -q"
        script = (
            f"set -e; "
            f"(crontab -l 2>/dev/null | grep -v 'rclone sync.*cosmo' || true) | crontab -; "
            f"(crontab -l 2>/dev/null; echo '{line}') | crontab -"
        )
        ok = self.run_remote(script, "Cron: nightly rclone (install rclone + config first)", dry_run)
        if not ok:
            print("   (Backup cron may fail if rclone missing — configure later.)")
        return True

    def deploy_all(
        self,
        api_key: str,
        b2_key: Optional[str],
        b2_bucket: Optional[str],
        *,
        dry_run: bool,
        skip_tests: bool,
    ) -> bool:
        print("\n" + "=" * 60)
        print("COSMO DEPLOYMENT")
        print("=" * 60)
        print(f"Target: {self._target}:{self.server_path}")

        if shutil.which("ssh") is None or shutil.which("scp") is None:
            print("ERROR: ssh and scp must be in PATH.")
            return False

        steps: List[Tuple[str, Callable[[], bool]]] = [
            ("SSH", lambda: self.test_connection(dry_run)),
            ("Copy", lambda: self.copy_files(dry_run)),
            ("Venv", lambda: self.setup_venv(dry_run) if not skip_tests else self.run_remote(
                f"cd {self.server_path} && python3 -m venv venv && ./venv/bin/pip install -q -r requirements.txt",
                "Venv without tests",
                dry_run,
            )),
            (".env", lambda: self.setup_env_file(api_key, b2_key, b2_bucket, dry_run)),
            ("systemd", lambda: self.setup_systemd(dry_run)),
            ("health cron", lambda: self.setup_health_cron(dry_run)),
            ("backup cron", lambda: self.setup_backup_cron(dry_run)),
        ]

        for name, fn in steps:
            if not fn():
                print(f"\nDeployment stopped at: {name}")
                return False

        print("\n" + "=" * 60)
        print("DEPLOYMENT COMPLETE")
        print("=" * 60)
        print(f"""
Next:
  sudo ufw allow 5000/tcp   # if using UFW — dashboard port
  http://{self.server_ip}:5000

Status:
  ssh {self._target} "sudo systemctl status cosmo cosmo-dashboard"

Logs:
  ssh {self._target} "tail -f {self.server_path}/logs/cosmo.log"
""")
        return True


def main() -> None:
    ap = argparse.ArgumentParser(description="Deploy Cosmo to a Linux server via SSH/scp.")
    ap.add_argument("--host", help="Server IP or hostname")
    ap.add_argument("--user", default="ubuntu", help="SSH user")
    ap.add_argument("--path", default="/home/cosmo/cosmo", help="Remote install path")
    ap.add_argument("--port", type=int, default=22, help="SSH port")
    ap.add_argument("--dry-run", action="store_true", help="Print steps only")
    ap.add_argument("--skip-tests", action="store_true", help="Skip pytest on server")
    args = ap.parse_args()

    host = args.host or input("Server IP/hostname: ").strip()
    user = (args.user or "ubuntu").strip()
    if not host:
        print("Host required.")
        sys.exit(1)

    api_key = getpass.getpass("ANTHROPIC_API_KEY (empty ok): ")
    b2_key = input("B2 / optional secret (optional): ").strip() or None
    b2_bucket = input("COSMO_B2_BUCKET_URL or bucket id (optional): ").strip() or None

    d = LatitudeDeployer(host, user, server_path=args.path, ssh_port=args.port)
    ok = d.deploy_all(api_key, b2_key, b2_bucket, dry_run=args.dry_run, skip_tests=args.skip_tests)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
