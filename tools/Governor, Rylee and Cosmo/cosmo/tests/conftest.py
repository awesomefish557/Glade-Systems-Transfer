"""Pytest configuration for Cosmo."""


def pytest_configure(config):
    config.addinivalue_line("markers", "network: requires live yfinance / HTTP")
    config.addinivalue_line("markers", "slow: many network calls")
