# GLADE SYSTEMS: INTEGRATION GUIDE

## What is Glade?

Glade Systems is your personal operating system where:

- **Cosmo** (Financial): Compounds capital 8–10% p.a.
- **Rylee** (Creative): Builds projects, earns income
- **Governor** (Rational): Makes capital decisions
- **Seer** (Analytics): Optimizes and insights
- **Igor** (Systems): Manages deployments

All coordinated in one dashboard.

---

## Setup (about 30 minutes)

### Step 1: Install dependencies

```bash
cd glade_systems
pip install -r requirements.txt
```

### Step 2: Configure Cosmo API

Edit `glade_config.py`:

```python
COSMO = {
    "api_url": "http://localhost:5000",  # Dev: local
    # Prod: "http://<latitude-ip>:5000"
}
```

Cosmo’s HTTP API is served by the **remote dashboard** (`cosmo/monitoring/remote_dashboard.py`), typically on port **5000**.

### Step 3: Run Cosmo dashboard (Terminal 1)

From the `cosmo` folder (with your venv activated):

```bash
python -m monitoring.remote_dashboard
```

Or set `COSMO_REMOTE_DASHBOARD_BIND=0.0.0.0` if you need LAN access.

### Step 4: Run Glade dashboard (Terminal 2)

```bash
cd glade_systems
python glade_dashboard.py
```

Open: [http://localhost:8000](http://localhost:8000)

Optional: set `COSMO_ADMIN_TOKEN` on the Cosmo host and the same value in Glade’s environment (or paste when confirming a withdrawal) so `POST /api/withdraw` is authorized.

---

## How It Works

### Rylee requests capital

Example: Rylee needs £1.5k for a Berlin course. Enter amount, category, and description in the **Capital request** form on the Glade dashboard.

### Governor evaluates

Governor checks:

1. Portfolio large enough? (> £25k)
2. Liquid cash available? (≥ request)
3. Won’t drain buffer? (leaves > £6k cash after)
4. Category budget ok? (e.g. learning: max £1k/month) — skipped for `general`
5. Cosmo BSS healthy? (> 50)

### Governor recommends

If approved, you see a summary with conditions. Requests **under £500** that pass checks can **auto-execute** (no button click). Larger amounts need **APPROVE** or **DENY**.

### You confirm

Click **APPROVE** or **DENY**.

If approved:

1. Glade calls Cosmo `POST /api/withdraw`
2. Cosmo updates **paper** state: raises cash by selling smallest positions (by entry notional) if needed, then records the withdrawal
3. State is written to `cosmo/data/paper_trades.json` (or your configured `state_filename`)

---

## Withdrawal Decision Flow

```text
Rylee: "Need £1.5k"
  ↓
Governor: "Check Cosmo capacity"
  ↓
Glade API: "Evaluate request"
  ├─ Portfolio > £25k?
  ├─ Cash ≥ amount?
  ├─ Won’t drain buffer?
  ├─ Category budget ok?
  └─ BSS healthy?
  ↓
Governor: "APPROVE" or "DENY"
  ↓
Dashboard: show recommendation
  ↓
You: confirm (or auto if < £500)
  ↓
Cosmo: execute withdrawal (paper state)
  ↓
Done: capital logged; portfolio state updated
```

---

## Dashboard Widgets

### COSMO

Portfolio, liquid cash (`cash` from `/api/portfolio`), BSS, holdings count, reachability.

### RYLEE

Income target (year 1), active projects (from config), queued requests (`glade_data/rylee_requests.json`).

### GOVERNOR

Totals from `glade_data/governor_decisions.json` (approved + executed).

### SEER / IGOR

Light placeholders / health hints until those services are wired in.

---

## Running live

### Local development

```bash
# Terminal 1 — Cosmo remote API (from cosmo repo root)
python -m monitoring.remote_dashboard

# Terminal 2 — Glade
cd glade_systems
python glade_dashboard.py
```

Browser: [http://localhost:8000](http://localhost:8000)

### Production (e.g. Latitude)

Point `COSMO["api_url"]` at `http://<server-ip>:5000`, bind Cosmo’s dashboard appropriately, and use `COSMO_ADMIN_TOKEN` for withdrawals.

---

## Troubleshooting

**Glade can’t connect to Cosmo**

- Error: `Cannot connect to Cosmo API`
- Fix: Run `python -m monitoring.remote_dashboard` from Cosmo and check `COSMO["api_url"]`.

**Governor denies withdrawal**

- Portfolio below `min_portfolio_for_withdrawal`
- Not enough **cash** (Governor does not yet model “sell holdings to raise cash” in the check)
- Buffer / category / BSS rules in `glade_config.py`

**Withdraw returns 403**

- Set `COSMO_ADMIN_TOKEN` on the server and send the same token from Glade (`X-Cosmo-Token`), or clear the token on the server for dev-only use.

**BSS always 0**

- Until Cosmo has metrics history, BSS may read as 0 and block approvals. Run the paper pipeline so `monitoring_metrics.json` is populated, or temporarily relax the BSS rule in `governor_logic.py` for local testing.

---

## Philosophy

Glade is **coordination**: Cosmo supplies numbers, Governor applies rules, you keep authority, and execution stays traceable in JSON logs.

**Run Glade. Coordinate your system. Build wealth with intention.**
