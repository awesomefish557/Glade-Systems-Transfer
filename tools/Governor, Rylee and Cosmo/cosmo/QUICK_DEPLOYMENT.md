# Cosmo: quick deployment (about 30 minutes)

Deploy to a Linux VPS (e.g. Latitude 5290) so `main.py` runs 24/7 and the Flask dashboard is reachable over the network.

## Prep (today, a few minutes)

1. Server **IP or hostname** and **SSH user** (often `ubuntu` or `root`).
2. **OpenSSH Client** on your PC (`ssh` / `scp` in PATH). On Windows: Settings → Apps → Optional features → OpenSSH Client.
3. **Anthropic API key** (can be empty for now if unused).
4. Optional: B2 / rclone for backups (configure after first boot).

## Deploy (on your machine, from `cosmo/`)

```powershell
cd "c:\Users\Hazel\Glade Systems\Governor, Rylee and Cosmo\cosmo"
.\venv\Scripts\python.exe deploy_to_latitude.py
```

Non-interactive example:

```powershell
.\venv\Scripts\python.exe deploy_to_latitude.py --host YOUR_IP --user ubuntu --path /home/ubuntu/cosmo
```

Flags:

- `--dry-run` — print remote commands only.
- `--skip-tests` — skip pytest on the server (faster, less safe).
- `--port 22` — SSH port if not default.

The script will:

1. Pack the repo (excludes `venv`, `.git`, `__pycache__`, `.env`, `*.db`).
2. `scp` the archive and unpack on the server.
3. Create `venv`, `pip install -r requirements.txt`, run foundation tests.
4. Write `.env` from your inputs (base64-safe).
5. Install **cosmo.service** (scheduler) and **cosmo-dashboard.service** (Flask on port 5000).
6. Add a **cron** line for `health_check.py` every 5 minutes and a **23:00 rclone** line (fix bucket name after `rclone config`).

**Remote sudo:** installing units needs `sudo` on the server. Either run the systemd block manually or ensure your user can `sudo` (password once over SSH session, or NOPASSWD for the install commands).

## Verify (on server)

```bash
ssh ubuntu@YOUR_IP
sudo systemctl status cosmo cosmo-dashboard
tail -f ~/cosmo/cosmo/logs/cosmo.log
ls -la ~/cosmo/cosmo/data/paper_trades.json
```

Adjust paths if you used `--path`.

## Firewall

Allow dashboard port if you bind publicly:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 5000/tcp
sudo ufw enable
```

The dashboard unit sets `COSMO_REMOTE_DASHBOARD_BIND=0.0.0.0`. To listen only locally, override the unit `Environment=` to `127.0.0.1` and use an SSH tunnel:

```bash
ssh -L 5000:127.0.0.1:5000 ubuntu@YOUR_IP
# then open http://127.0.0.1:5000
```

## Optional: restart from the web UI

On the server:

```bash
export COSMO_ADMIN_TOKEN='long-random-secret'
sudo systemctl edit cosmo-dashboard
# add [Service] Environment=COSMO_ADMIN_TOKEN=...
```

Add sudoers (visudo) for passwordless restart:

```
ubuntu ALL=(ALL) NOPASSWD: /bin/systemctl restart cosmo
```

## Daily operations

- **Scheduler:** `main.py` via systemd — London times 8:30, 16:25, 23:00.
- **Paper + metrics:** add cron for `paper_trading_simulator.py` and `python -m monitoring.live_dashboard` if you want them daily (see `DEPLOYMENT_GUIDE.md`).
- **Health:** `health_check.py` every 5 minutes; logs in `logs/health.log` and `logs/alerts.log`.

## Troubleshooting

```bash
sudo journalctl -u cosmo -n 80 --no-pager
sudo journalctl -u cosmo-dashboard -n 80 --no-pager
./venv/bin/python -c "import config; print(config.BASE_DIR)"
```

If `scp` fails: confirm the same `ssh user@host` works. If `tar` unpack fails: check disk space on the server.

---

After a successful run, Cosmo should be up with auto-restart on failure and a browser dashboard for status and file-based paper snapshots.
