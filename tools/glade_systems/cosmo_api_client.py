"""
Cosmo API Client: Query remote Cosmo API.
Handles portfolio status, withdrawal, rebalancing.
"""

from datetime import datetime

import requests


class CosmoAPIClient:
    """Client for remote Cosmo API."""

    def __init__(self, api_url: str, timeout: int = 10) -> None:
        self.api_url = api_url.rstrip("/")
        self.timeout = timeout

    def get_portfolio_status(self) -> dict:
        """Get current portfolio status."""
        try:
            response = requests.get(
                f"{self.api_url}/api/portfolio",
                timeout=self.timeout,
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            raise Exception(f"Cannot fetch portfolio: {e}") from e

    def get_service_status(self) -> bool:
        """Check if Cosmo service is running."""
        try:
            response = requests.get(
                f"{self.api_url}/api/status",
                timeout=self.timeout,
            )
            return response.status_code == 200
        except OSError:
            return False

    def get_recent_logs(self, lines: int = 20) -> list:
        """Get recent logs from Cosmo."""
        try:
            response = requests.get(
                f"{self.api_url}/api/logs?lines={lines}",
                timeout=self.timeout,
            )
            response.raise_for_status()
            return response.json().get("logs", [])
        except OSError:
            return []

    def request_withdrawal(
        self,
        amount: float,
        category: str,
        description: str,
        admin_token: str | None = None,
    ) -> dict:
        """
        Request withdrawal from Cosmo.
        Cosmo validates and rebalances.
        """
        try:
            data = {
                "amount": amount,
                "category": category,
                "description": description,
                "timestamp": datetime.now().isoformat(),
            }
            headers: dict[str, str] = {}
            if admin_token:
                headers["X-Cosmo-Token"] = admin_token

            response = requests.post(
                f"{self.api_url}/api/withdraw",
                json=data,
                headers=headers,
                timeout=self.timeout,
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            raise Exception(f"Withdrawal request failed: {e}") from e

    def get_holdings(self) -> dict | list:
        """Get current holdings."""
        try:
            response = requests.get(
                f"{self.api_url}/api/holdings",
                timeout=self.timeout,
            )
            response.raise_for_status()
            return response.json()
        except OSError:
            return []

    def health_check(self) -> bool:
        """Simple health check."""
        return self.get_service_status()
