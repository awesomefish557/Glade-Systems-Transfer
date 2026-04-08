# Cosmo ↔ Governor integration

Governor talks to Cosmo over **HTTP JSON** on the **Governor API** (default **port 5050**). The read-only **remote dashboard** (`monitoring.remote_dashboard`) can stay on **5000** to avoid clashes.

## Environment

| Variable | Purpose |
|----------|---------|
| `COSMO_START_GOVERNOR_API=1` | When set, `main.py` starts the API in a background thread. |
| `COSMO_GOVERNOR_API_PORT` | Listener port (default `5050`). |
| `COSMO_GOVERNOR_API_BIND` | Bind address (default `0.0.0.0`). |

## Data model (SQLite)

- **`portfolio_state`**: row `id=1`, column `cash_gbp` — liquid GBP for withdrawals.
- **`holdings`**: optional **`bee`** column (`value`, `growth`, `income`, `defensive`) for allocation math.
- **`trades`**: audit trail for sells triggered by withdrawals.
- **`data/withdrawals.json`**: append-only JSON history from `CosmoWithdrawalHandler`.

## API contract

### Health

`GET /api/status`

### Portfolio (Governor)

`GET /api/portfolio` — DB NAV + cash, paper simulator summary, bee weights (%).

`GET /api/allocations` — current vs target (regime from VIX) and `balanced` flag (±2%).

`GET /api/holdings` — rows from `holdings`.

`GET /api/logs` — tail of `logs/cosmo.log`.

### Withdrawal (dry run)

`POST /api/withdrawal-capability`  
Body: `{"amount": 1500}`

Response:

```json
{
  "can_withdraw": true,
  "reason": "OK",
  "details": { "cash": 8000, "portfolio_value": 50000, "floor": 6000 }
}
```

### Withdrawal (execute)

`POST /api/withdraw`  
Body:

```json
{
  "amount": 1500,
  "category": "learning",
  "description": "Berlin language course"
}
```

Cosmo may sell holdings (trimming an over-allocated bee first) until `cash_gbp >= amount + floor`, then debits `amount` from `portfolio_state`.

### History

`GET /api/withdrawal-history?limit=20`

### Paper / ops

`POST /api/run-assessment` — runs `PaperTradingSimulator.run_daily_assessment()`.

## Local test

```powershell
cd cosmo
$env:COSMO_START_GOVERNOR_API="0"
.\venv\Scripts\python.exe cosmo_api_server.py
```

Other terminal:

```powershell
curl -s http://127.0.0.1:5050/api/status
curl -s -X POST http://127.0.0.1:5050/api/withdrawal-capability -H "Content-Type: application/json" -d "{\"amount\": 1500}"
```

## Rules (config)

Tune in `config.py`:

- `WITHDRAWAL` — min portfolio, min BSS (from metrics file if present), post-withdrawal cash floor, etc.
- `LIQUID_BUFFER` / `calculate_liquid_buffer_target` — scale cash floor with NAV.
- `BEE_ALLOCATIONS` — regime targets; `BEE_REBALANCE_PRIORITY` — trim order when raising cash.

## Systemd hint

Add to the `cosmo.service` unit:

```ini
Environment=COSMO_START_GOVERNOR_API=1
Environment=COSMO_GOVERNOR_API_PORT=5050
```

Or run `cosmo_api_server.py` as its own service (similar to `cosmo-dashboard.service`).

## Flow (summary)

1. Governor calls `GET /api/portfolio` and `GET /api/allocations`.
2. Governor calls `POST /api/withdrawal-capability` with the requested amount.
3. Human approves in Glade UI.
4. Governor calls `POST /api/withdraw`.
5. Cosmo sells if needed, updates cash and holdings, appends `withdrawals.json`, returns before/after allocations.

---

Cosmo is wired for programmatic capital requests while keeping an audit trail and minimum liquidity.
