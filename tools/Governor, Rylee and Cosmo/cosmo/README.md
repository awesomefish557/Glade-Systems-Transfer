# COSMO: The Financial Engine of Glade Systems

## What Is Cosmo?

Cosmo is an automated trading system that runs 8:30am–4:25pm daily, assessing UK companies and building a portfolio of 15–25 quality holdings. It's the financial foundation of Glade Systems — a personal OS where AI personas (Rylee, Governor, Igor) coordinate projects, capital, risk, and learning.

**Goal:** Build £8k → £184k over 20 years at 8–10% annual returns. By age 41, you're financially independent. Money stress solved. Build what you want.

---

## The Vision

- **Rylee (Creative):** "I want to fund a Berlin residency"
- **Governor (Rational):** "Do we have capital?"
- **Cosmo (Financial):** "Yes, £6k deployable"
- **You (Authority):** "Approved. Go to Berlin."

Cosmo enables Rylee's dreams by generating capital quietly in the background.

---

## How Cosmo Works

### Trading Schedule

- **8:30am:** Morning assessment (Cosmo recommends buys/sells)
- **You:** Execute trades in Trading 212 (manual, controlled)
- **4:25pm:** Afternoon rebalance
- **11pm:** Backup to Backblaze B2 (cold storage)

### The Three Gates (Every candidate must pass)

- **Operator Score >5/10** (CEO/leadership assessment, 8 tests)
- **Moat Score >4/10** (Competitive advantage analysis)
- **FQS Score >60** (5-pillar fundamental quality)

Fail any gate = **AUTO-REJECT**. No exceptions.

### Holdings Target

- 15–25 quality companies (no quotas, no forced buying)
- Long-term holds (months to years)
- Defensive hedges in crashes
- Dividends reinvested

### Returns Target

- 8–10% p.a. (realistic, not greedy)
- Conservative value investing
- Beats 80%+ of professionals + hedge funds
- Zero fees (you code it)

---

## The System Architecture

### Meta-Bees (Oversight & Intelligence)

**Regime Detector**

- Watches VIX, correlations, market drawdown
- Categorizes market: bull/bear/crisis/sideways
- Adjusts bee weighting automatically

**Governor**

- Maintains £8k emergency buffer (untouchable)
- Maintains 13% defensive floor
- Approves/denies capital deployments
- Answers: "Can we afford Rylee's project?"

**Risk Sentinel (Hornet Events)**

- Triggers on: Market -5%+, VIX >30, correlation >0.95
- Auto-rebalances to defensive
- Catches crashes automatically

**Scoring Meta-Bee**

- Calculates BSS (Bee Success Score) daily
- Shows which strategies winning/losing
- Tracks performance by regime

**Mutation Meta-Bee**

- Tests new bee variants in background
- Compares synthetic → paper → live
- Promotes winners automatically

### Dynamic Bee Lineup (Not all bees all the time)

```
Bull market:     Value, Momentum, Equal Weight (defensive benched)
Sideways:        Value, Mean Reversion (momentum benched)
Bear market:     Value, Defensive, Mean Reversion (momentum benched)
Crisis:          Value, Defensive (40%!), Mean Reversion (everything else benched)
```

*(Current code implements configurable `BEE_ALLOCATIONS` in `config.py`; extend bees as you add strategies.)*

---

## The Data Pipeline

**Stage 1: Numerical Screening (5,000 → 200–300)**

- Market cap >£500m
- Daily volume threshold (configurable; see `STAGE1_*` in `config.py`)
- P/E <15x
- Automated, no human bias

**Stage 2: Red Flag Scan (200–300 → 50–70)** — *planned*

- NLP analysis for warnings
- CEO/CFO churn?
- Dividend cuts?
- Blame language in filings?

**Stage 3: Deep Due Diligence (50–70 → 30)** — *manual + tools*

- Operator 8-test analysis
- Moat evaluation
- Sector thesis

**Stage 4: Final Approval (30 → 15–25)**

- All gates must pass
- Added to portfolio

---

## Backtesting Strategy (Anti-Overfitting)

**The trap:** Backtest on cherry-picked quarters, fails live.

**The solution:**

- Pick 20 **random** quarters (1990–2025, not sequential)
- Keep gates **FIXED** (don't optimize based on results)
- Measure: Does it work across different regimes?
- If backtest BSS >0.60 → proceed to paper trading

**Paper Trading (90 days):**

- Real market conditions
- Zero capital deployed
- Measure: Does it work live?

**Live (If paper BSS >0.65):**

- Start with 10% capital
- Scale +5% per month if BSS stays >0.65
- Document everything (case system)

---

## Gamified Progression (4 Milestones)

```
LEVEL 1: INFLECTION POINT
Target: £42,000 | Age: ~27 | When: "Earnings match savings"
Character perks: [Compound Awareness], [Passive Income £3.3k/yr]

LEVEL 2: FEELING EXPONENTIAL
Target: £70,000 | Age: ~30 | When: "Returns doing 60% of work"
Progress: £42k/£70k [████████░░░░░░░░░░] 60% (not reset to 0!)
Character perks: [Exponential Confirmed], [£5.6k/yr passive]

LEVEL 3: SABBATICAL MONEY
Target: £100,000 | Age: ~33 | When: "Can take 3-month break"
Progress: £70k/£100k [███████░░░░░░░░░░░░] 70%
Character perks: [Freedom Tasting], [£8k/yr passive]

LEVEL 4: THE NUMBER (FINAL BOSS)
Target: £184,000 | Age: ~41 | When: "Money stress GONE"
Progress: £100k/£184k [█████████░░░░░░░░░░] 54%
Character perks: [FINANCIAL INDEPENDENCE], [£14.7k/yr passive]
```

---

## The 13 Files You're Building (6 Weeks)

**Week 1 (Foundation)**

- `config.py` — All settings in one place
- `requirements.txt` — Dependencies
- `database.py` — SQLite setup
- `data/fetchers.py` — Get stock data from yfinance
- `scoring/bss.py` — Calculate BSS (Bee Success Score)

**Week 2 (Value Bee)**

- `bees/value_bee.py` — Core trading logic
- `research_bees/deep_operator.py` — 8-test operator assessment
- `research_bees/moat_scout.py` — Moat analysis
- `research_bees/gate_keeper.py` — Apply gates (pass/fail)
- `discovery/stage1_numerical.py` — Screening pipeline

**Week 3 (Operations & Deployment)**

- `trading/trading212_manual.py` — Log trades in Trading 212
- `reporting/dashboard.py` — Show recommendations
- `main.py` — Scheduler + entry point

**Week 4–5 (Testing)**

- Synthetic backtest (20 random quarters)
- Unit tests (pytest)

**Week 6 (Deploy)**

- Deploy to Latitude 5290
- Paper trading begins

---

## File Dependencies (Build Order Matters)

```
config.py ← Everything depends on this
  ↓
database.py ← Sets up data layer
  ↓
data/fetchers.py ← Gets the data
  ↓
scoring/bss.py ← Calculates scores
  ↓
research_bees/* ← Assessment functions
  ↓
bees/value_bee.py ← Main trading logic
  ↓
discovery/stage1_numerical.py ← Screening pipeline
  ↓
trading/trading212_manual.py ← Execution logging
  ↓
reporting/dashboard.py ← UI/recommendations
  ↓
main.py ← Ties it all together
```

---

## Technology Stack

| Layer | Choice |
|--------|--------|
| Language | Python 3.9+ |
| Database | SQLite (local, no server) |
| Data | yfinance (free stock data) |
| API | Anthropic Claude (for NLP, operator assessment) |
| Broker | Trading 212 (manual execution) |
| Backup | Backblaze B2 (cold storage) |
| Deployment | Latitude 5290 (always-on server) |
| Version control | GitHub (private repo) |

---

## Key Settings (From config.py)

These names are exposed for README parity; canonical typed constants remain the source of truth.

```python
TRADING_HOURS = {
    'morning_open': '08:30',
    'afternoon_close': '16:25',
    'evening_backup': '23:00',
}

GATES = {
    'operator_score': 5.0,
    'moat_score': 4.0,
    'fqs_score': 60,
}

MILESTONES = {
    'level_1': {'target': 42000, 'age': 27},
    'level_2': {'target': 70000, 'age': 30},
    'level_3': {'target': 100000, 'age': 33},
    'level_4': {'target': 184000, 'age': 41},
}

INITIAL_CAPITAL = 8000
EMERGENCY_BUFFER = 8000
DEFENSIVE_FLOOR = 0.13
```

Run from this directory:

```bash
python main.py
```

---

## How to Use This in Cursor

1. Read this README fully.
2. Review the mega build prompt.
3. Paste the mega prompt into Cursor.
4. Cursor builds each file in dependency order.
5. Test and iterate (`pytest`, smoke imports, paper trading).

---

## Success Metrics

- Backtest BSS: >0.60 across 20 random quarters
- Paper BSS: >0.65 over 90 days
- Live returns: 8–10% p.a. (first 5 years realistic: 6–9%)
- Crash protection: BSS >0.55 even in 2008-style crash
- Consistency: Returns stable across bull/bear/sideways markets

---

## Notes

- This is a 20-year project, not a get-rich scheme.
- Compound is the engine. Discipline is the fuel.
- You start at 21. Time is your biggest advantage.
- By 41, you're free. Not rich (yet), but free.
- By 51, actually wealthy. Just sitting there, compounding.

---

## Related Documents

- `COSMO_FINAL_MASTER_DOCUMENT.md` — Full system philosophy
- `cosmo_exponential_growth_curves.md` — Math (year-by-year)
- `cosmo_milestone_gamification.md` — Level-up system
- `cosmo_master_condensed.md` — Quick reference
- `cosmo_comparative_performance.md` — Why you'll win
