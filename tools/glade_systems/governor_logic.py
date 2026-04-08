"""
GOVERNOR LOGIC: Decision engine for capital deployment.
Checks: Can we afford it? Is it worth it? Recommend approve/deny.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from cosmo_api_client import CosmoAPIClient
from glade_config import COSMO, GLADE_DATA_DIR, GOVERNOR_RULES


class Governor:
    """
    Rational decision maker.
    Evaluates Rylee requests against Cosmo capacity.
    Recommends approval with reasoning.
    """

    def __init__(self) -> None:
        self.cosmo = CosmoAPIClient(COSMO["api_url"], timeout=int(COSMO.get("timeout", 10)))
        self.decisions_log: Path = GLADE_DATA_DIR / "governor_decisions.json"
        self.load_decisions_history()

    def load_decisions_history(self) -> None:
        """Load past decisions for reference."""
        if not self.decisions_log.is_file():
            self.decisions_history: list = []
            return
        try:
            with open(self.decisions_log, encoding="utf-8") as f:
                self.decisions_history = json.load(f)
            if not isinstance(self.decisions_history, list):
                self.decisions_history = []
        except (json.JSONDecodeError, OSError):
            self.decisions_history = []

    def evaluate_withdrawal_request(
        self,
        amount: float,
        category: str,
        description: str,
    ) -> dict:
        """
        Evaluate if we can/should fund this request.
        Returns dict: {approved: bool, reason: str, details: dict, ...}
        """
        if not GOVERNOR_RULES.get("allow_withdrawal", True):
            return {
                "approved": False,
                "reason": "Withdrawals disabled in GOVERNOR_RULES",
                "recommendation": "DENY",
                "details": {"amount": amount, "category": category},
            }

        try:
            cosmo_status = self.cosmo.get_portfolio_status()
        except Exception as e:
            return {
                "approved": False,
                "reason": f"Cannot connect to Cosmo API: {e}",
                "recommendation": "DENY",
                "details": {"error": str(e)},
            }

        portfolio_value = float(cosmo_status.get("portfolio_value", 0))
        liquid_cash = float(cosmo_status.get("cash", cosmo_status.get("liquid_cash", 0)))
        bss = float(cosmo_status.get("bss", 0))

        if portfolio_value < GOVERNOR_RULES["min_portfolio_for_withdrawal"]:
            return {
                "approved": False,
                "reason": (
                    f"Portfolio too small (£{portfolio_value:,.0f} < "
                    f"£{GOVERNOR_RULES['min_portfolio_for_withdrawal']:,})"
                ),
                "recommendation": "DENY",
                "details": {
                    "portfolio_value": portfolio_value,
                    "liquid_cash": liquid_cash,
                    "category": category,
                    "amount": amount,
                },
            }

        if liquid_cash < amount:
            return {
                "approved": False,
                "reason": f"Not enough liquid cash (£{liquid_cash:,.0f} < £{amount:,})",
                "recommendation": "DENY",
                "details": {
                    "liquid_cash": liquid_cash,
                    "requested": amount,
                    "shortfall": amount - liquid_cash,
                },
            }

        cash_after = liquid_cash - amount
        min_cash = GOVERNOR_RULES["min_cash_after_withdrawal"]

        if cash_after < min_cash:
            return {
                "approved": False,
                "reason": (
                    f"Would drain buffer too much (£{cash_after:,.0f} < £{min_cash:,} minimum)"
                ),
                "recommendation": "DENY",
                "details": {
                    "liquid_cash": liquid_cash,
                    "after_withdrawal": cash_after,
                    "minimum_required": min_cash,
                },
            }

        if category in GOVERNOR_RULES["categories"]:
            max_per_month = GOVERNOR_RULES["categories"][category]["max_per_month"]
            spent_this_month = self.get_spending_this_month(category)

            if spent_this_month + amount > max_per_month:
                return {
                    "approved": False,
                    "reason": f"Would exceed {category} budget (£{max_per_month:,}/month)",
                    "recommendation": "DENY",
                    "details": {
                        "category": category,
                        "budget": max_per_month,
                        "already_spent": spent_this_month,
                        "requested": amount,
                        "would_total": spent_this_month + amount,
                    },
                }

        if bss < 50:
            return {
                "approved": False,
                "reason": f"Cosmo BSS too low ({bss:.1f} < 50). Portfolio struggling.",
                "recommendation": "WAIT_FOR_RECOVERY",
                "details": {
                    "bss": bss,
                    "recommendation": "Recommend waiting for BSS to recover above 60",
                },
            }

        conditions = [
            "✅ Portfolio large enough",
            "✅ Liquid cash available",
            f"✅ Cash buffer maintained (£{cash_after:,.0f} > £{min_cash:,})",
        ]
        if category in GOVERNOR_RULES["categories"]:
            conditions.append("✅ Within category budget")
        else:
            conditions.append("✅ Category: general (no monthly cap)")
        conditions.append(f"✅ Cosmo BSS healthy ({bss:.1f})")

        return {
            "approved": True,
            "recommendation": "APPROVE",
            "reason": "All checks passed",
            "details": {
                "portfolio_value": portfolio_value,
                "liquid_cash": liquid_cash,
                "cash_after_withdrawal": cash_after,
                "bss": bss,
                "category": category,
                "amount": amount,
                "description": description,
                "rebalance_will_occur": True,
            },
            "conditions": conditions,
        }

    def get_spending_this_month(self, category: str) -> float:
        """How much was approved and executed in this category this calendar month."""
        today = datetime.now()
        month_start = today.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        spent = 0.0
        for decision in self.decisions_history:
            if not isinstance(decision, dict):
                continue
            try:
                raw = decision["date"]
                if raw.endswith("Z"):
                    raw = raw.replace("Z", "+00:00")
                decision_date = datetime.fromisoformat(raw)
                if decision_date.tzinfo:
                    decision_date = decision_date.replace(tzinfo=None)
            except (KeyError, ValueError, TypeError):
                continue
            if decision_date < month_start:
                continue
            req = decision.get("request") or {}
            if req.get("category") != category:
                continue
            if decision.get("user_approved") and decision.get("executed"):
                spent += float(req.get("amount", 0) or 0)
        return spent

    def log_decision(
        self,
        request: dict,
        evaluation: dict,
        user_approved: bool,
        executed: bool = False,
    ) -> None:
        """Append a decision record."""
        decision = {
            "date": datetime.now().isoformat(),
            "request": request,
            "evaluation": evaluation,
            "user_approved": user_approved,
            "executed": executed,
        }
        self.decisions_history.append(decision)
        self.decisions_log.parent.mkdir(parents=True, exist_ok=True)
        with open(self.decisions_log, "w", encoding="utf-8") as f:
            json.dump(self.decisions_history, f, indent=2)

    def get_recommendation_summary(self, evaluation: dict) -> str:
        """Generate human-readable summary."""
        rec = evaluation.get("recommendation", "")
        if rec == "APPROVE":
            d = evaluation.get("details") or {}
            cond = evaluation.get("conditions") or []
            return f"""
✅ GOVERNOR APPROVES

Amount: £{float(d.get('amount', 0)):,.2f}
Category: {d.get('category', '')}
Description: {d.get('description', '')}

Portfolio will rebalance to maintain:
- Liquid buffer targets (see glade_config LIQUID_BUFFER)
- Bee allocations: Optimal
- Growth trajectory: Uninterrupted

Conditions met:
{chr(10).join(cond)}

Awaiting your confirmation (or auto-execute if under £{GOVERNOR_RULES['auto_approve_under']})...
"""
        details = evaluation.get("details")
        detail_str = json.dumps(details, indent=2) if details is not None else "{}"
        return f"""
❌ GOVERNOR DENIES

Reason: {evaluation.get('reason', '')}

Details:
{detail_str}

Recommendation: {evaluation.get('recommendation', '')}
"""


def main() -> None:
    """Test Governor logic."""
    gov = Governor()
    request = {
        "amount": 1500,
        "category": "learning",
        "description": "Berlin language course (3 months)",
    }
    evaluation = gov.evaluate_withdrawal_request(
        amount=request["amount"],
        category=request["category"],
        description=request["description"],
    )
    print(gov.get_recommendation_summary(evaluation))


if __name__ == "__main__":
    main()
