# Cosmo deployment guide (Latitude 5290 or similar)

Deploy Cosmo on an always-on Linux host so `main.py` runs 24/7 with Europe/London schedule (8:30, 16:25, 23:00).

**Faster path:** run `python deploy_to_latitude.py` from your laptop (needs `ssh`/`scp`) and follow **QUICK_DEPLOYMENT.md** for a scripted install, systemd units, Flask dashboard, and health cron.

## Prerequisites

- SSH access to the server
- Python 3.9+ (`python3`)
- This repo’s `cosmo/` tree (Week 1–3 files)
- Optional: Anthropic API key in `.env` (future NLP)
- Optional: Backblaze B2 + `rclone` for off-site backup

SQLite is already used; no PostgreSQL required unless you choose to migrate later.

## 1. Package locally

From the machine that has the project:

```bash
cd /path/to/cosmo
tar -czf cosmo-deploy.tar.gz \
  config.py database.py main.py backtest.py paper_trading_simulator.py week2_run.py week3_setup.py requirements.txt \
  bees/ data/ discovery/ monitoring/ reporting/ research_bees/ scoring/ trading/ tests/
```

Copy `.env` separately (never commit secrets). Omit `venv/` and `__pycache__/`.

## 2. Install on the server

```bash
ssh user@your-server
mkdir -p ~/cosmo && cd ~/cosmo
# scp cosmo-deploy.tar.gz from your machine, then:
tar -xzf cosmo-deploy.tar.gz
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Place `.env` in `~/cosmo/` if you use API keys.

## 3. systemd service (scheduler)

Create `/etc/systemd/system/cosmo.service` (adjust user and paths):

```ini
[Unit]
Description=Cosmo trading scheduler
After=network.target

[Service]
Type=simple
User=cosmo
WorkingDirectory=/home/cosmo/cosmo
ExecStart=/home/cosmo/cosmo/venv/bin/python /home/cosmo/cosmo/main.py
Restart=always
RestartSec=15
Environment=PYTHONUNBUFFERED=1
StandardOutput=append:/home/cosmo/cosmo/logs/cosmo_service.log
StandardError=append:/home/cosmo/cosmo/logs/cosmo_service.log

[Install]
WantedBy=multi-user.target
```

Ensure `logs/` exists or change log paths.

```bash
sudo systemctl daemon-reload
sudo systemctl enable cosmo
sudo systemctl start cosmo
sudo systemctl status cosmo
tail -f /home/cosmo/cosmo/logs/cosmo_service.log
```

## 4. Paper trading and dashboard (cron)

During the 90-day paper phase you can cron the simulator and dashboard after the open:

```cron
30 8 * * * cd /home/cosmo/cosmo && /home/cosmo/cosmo/venv/bin/python paper_trading_simulator.py >> logs/paper.log 2>&1
35 8 * * * cd /home/cosmo/cosmo && /home/cosmo/cosmo/venv/bin/python -m monitoring.live_dashboard >> logs/paper.log 2>&1
```

## 5. Backups

- Local: `main.py` already copies `cosmo.db` to `archive/` at 23:00.
- B2: install `rclone`, configure a B2 remote, then cron e.g. `rclone sync /home/cosmo/cosmo/archive b2:your-bucket/cosmo-archive/`.

## 6. Troubleshooting

**Service fails immediately**

- Check `WorkingDirectory` matches where `config.py` lives.
- Run manually: `cd ~/cosmo/cosmo && ./venv/bin/python -c "import config; print(config.BASE_DIR)"`.

**Import errors**

- Activate the same venv as `ExecStart`.
- Re-run `pip install -r requirements.txt`.

**yfinance / rate limits**

- Reduce `PAPER_TRADING["daily_universe_cap"]` in `config.py`.
- Stagger cron vs heavy batch jobs.

## 7. Going live (after paper BSS gate)

- Keep executing real trades manually in Trading 212 until an API integration is built.
- Start with a small fraction of capital; scale only if paper/live BSS stay above your configured targets.

## Security checklist

- SSH keys, disable password login where possible
- `chmod 600 .env`
- Rotate API keys periodically
- Private GitHub repo; no secrets in tarballs you leave on disk

---

Silent, disciplined automation beats hero trades. Ship the scheduler, then let compound time do the work.
