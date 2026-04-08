"""
GLADE SYSTEMS Configuration
All personas, settings, decision rules.
"""

from pathlib import Path
from enum import Enum

# Directories
BASE_DIR = Path(__file__).resolve().parent
GLADE_DATA_DIR = BASE_DIR / "glade_data"
GLADE_DATA_DIR.mkdir(parents=True, exist_ok=True)
(GLADE_DATA_DIR / "analytics").mkdir(parents=True, exist_ok=True)

# ═══════════════════════════════════════════════════════════════
# PERSONAS
# ═══════════════════════════════════════════════════════════════


class Persona(Enum):
    COSMO = "cosmo"  # Financial engine
    RYLEE = "rylee"  # Creative
    GOVERNOR = "governor"  # Decision maker
    SEER = "seer"  # Analytics
    IGOR = "igor"  # Systems
    BOOKIES = "bookies"  # Betting constellation


# ═══════════════════════════════════════════════════════════════
# COSMO INTEGRATION
# ═══════════════════════════════════════════════════════════════

COSMO = {
    "api_url": "http://localhost:5000",  # Local for dev; http://latitude-ip:5000 for prod
    "timeout": 10,
    "dashboard_endpoint": "/api/portfolio",
    "status_endpoint": "/api/status",
    "logs_endpoint": "/api/logs",
}

# Liquid buffer settings
LIQUID_BUFFER = {
    "year_1_2": 8000,
    "year_3_4": 10000,
    "year_5_10": 15000,
    "year_10_20": 25000,
    "auto_scale": True,  # Scale based on portfolio value
    "min_portfolio_for_rebalance": 25000,  # Only rebalance if portfolio large enough
}

# ═══════════════════════════════════════════════════════════════
# GOVERNOR DECISION LOGIC
# ═══════════════════════════════════════════════════════════════

GOVERNOR_RULES = {
    # Can we fund projects?
    "allow_withdrawal": True,
    # Minimum portfolio size to enable withdrawals
    "min_portfolio_for_withdrawal": 25000,
    # Maximum withdrawal as % of liquid buffer
    "max_withdrawal_pct_of_buffer": 0.8,  # Don't drain buffer completely
    # Minimum cash after withdrawal
    "min_cash_after_withdrawal": 6000,
    # Can we fund Rylee projects automatically?
    "auto_approve_under": 500,  # Auto-approve <£500 (no user confirmation)
    # Require user confirmation for >£500
    "require_confirmation_over": 500,
    # Decision categories
    "categories": {
        "learning": {
            "max_per_month": 1000,
            "priority": "high",
            "description": "Education, courses, books",
        },
        "travel": {
            "max_per_month": 2000,
            "priority": "medium",
            "description": "Travel, accommodation, experiences",
        },
        "building": {
            "max_per_month": 1500,
            "priority": "high",
            "description": "Project building, R&D, tooling",
        },
        "operations": {
            "max_per_month": 500,
            "priority": "critical",
            "description": "Rent, food, essentials",
        },
    },
}

# ═══════════════════════════════════════════════════════════════
# RYLEE INTEGRATION
# ═══════════════════════════════════════════════════════════════

RYLEE = {
    "income_target_year_1": 500,  # £500/year side income
    "income_target_year_4": 3000,  # £3k/year by year 4
    "projects": [],  # Populated from glade_data/projects.json
    "funding_requests_file": GLADE_DATA_DIR / "rylee_requests.json",
}

# ═══════════════════════════════════════════════════════════════
# SEER ANALYTICS
# ═══════════════════════════════════════════════════════════════

SEER = {
    "enabled": True,
    "analytics_dir": GLADE_DATA_DIR / "analytics",
    "insights_update_frequency": "daily",  # How often Seer analyzes
    "tracked_metrics": [
        "cosmo_bss",
        "portfolio_vs_ftse",
        "liquid_buffer_usage",
        "rylee_income_vs_target",
        "withdrawal_patterns",
    ],
}

# ═══════════════════════════════════════════════════════════════
# IGOR SYSTEMS
# ═══════════════════════════════════════════════════════════════

IGOR = {
    "system_monitor": True,
    "deployment_tracking": True,
    "code_repo": "https://github.com/YOUR_USERNAME/cosmo-private",
}

# ═══════════════════════════════════════════════════════════════
# BOOKIES INTEGRATION
# ═══════════════════════════════════════════════════════════════

BOOKIES = {
    "enabled": True,
    "page_url": "http://localhost:5173",
    "label": "Open Bookies",
}

# ═══════════════════════════════════════════════════════════════
# GLADE DASHBOARD
# ═══════════════════════════════════════════════════════════════

GLADE_DASHBOARD = {
    "host": "0.0.0.0",
    "port": 8000,
    "refresh_interval_seconds": 5,
    "session_timeout_minutes": 60,
    "require_auth": False,  # Set to True if hosting publicly
}

# ═══════════════════════════════════════════════════════════════
# MILESTONES
# ═══════════════════════════════════════════════════════════════

MILESTONES = {
    "level_1": {"target": 42000, "age": 27, "name": "Inflection Point"},
    "level_2": {"target": 70000, "age": 30, "name": "Feeling Exponential"},
    "level_3": {"target": 100000, "age": 33, "name": "Sabbatical Money"},
    "level_4": {"target": 184000, "age": 41, "name": "The Number"},
}
