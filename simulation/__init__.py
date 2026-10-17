"""Deterministic NG_SIM paper-trading simulator (simulation only, synthetic data)."""
from .candles import FIXTURES, FixtureError
from .engine import DISCLAIMER, get_report, run_simulation

__all__ = ["run_simulation", "get_report", "FIXTURES", "FixtureError", "DISCLAIMER"]
