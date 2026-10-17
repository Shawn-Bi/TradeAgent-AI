"""Deterministic risk gate shared by the candle engine and the event-fixture replay.

The model never places trades: every entry passes through ``pre_trade_gates`` in the
fixed order from FIRST_CUSTOMER_STRATEGY.md section C.5.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

LOCK_TWO_LOSSES = "TWO_CONSECUTIVE_LOSSES"
LOCK_MAX_TRADES = "MAX_TRADES"


@dataclass(frozen=True)
class GateResult:
    passed: bool
    rule_id: str
    reason_code: str | None
    message: str


PASS = GateResult(True, "ENTRY_5M_PULLBACK", None, "All pre-trade risk gates passed")


@dataclass
class SessionRiskState:
    """Per-session counters. Only a new simulated session clears the lock."""

    max_completed_trades: int
    consecutive_loss_lock: int
    completed_trades: int = 0
    consecutive_losses: int = 0
    loss_locked: bool = False

    @property
    def max_trades_reached(self) -> bool:
        return self.completed_trades >= self.max_completed_trades

    @property
    def entry_locked(self) -> bool:
        return self.loss_locked or self.max_trades_reached

    @property
    def lock_reason(self) -> str | None:
        if self.loss_locked:
            return LOCK_TWO_LOSSES
        if self.max_trades_reached:
            return LOCK_MAX_TRADES
        return None

    def record_closed_position(self, realized_pnl_usd: float) -> dict:
        """Count one completed position. Net < 0 is a loss; >= 0 resets the streak."""
        was_loss_locked = self.loss_locked
        was_max = self.max_trades_reached
        self.completed_trades += 1
        if realized_pnl_usd < 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0
        if self.consecutive_losses >= self.consecutive_loss_lock:
            self.loss_locked = True
        return {
            "result": "LOSS" if realized_pnl_usd < 0 else ("WIN" if realized_pnl_usd > 0 else "BREAKEVEN"),
            "newly_loss_locked": self.loss_locked and not was_loss_locked,
            "newly_max_trades": self.max_trades_reached and not was_max,
        }


def pre_trade_gates(
    *,
    approved: bool,
    state: SessionRiskState,
    entry_time: datetime,
    cutoff: datetime,
    position_open: bool,
    entry_ticks: int,
    stop_ticks: int | None,
    equity_usd: float,
    quantity: int,
    margin_per_contract_usd: float,
) -> GateResult:
    if not approved:
        return GateResult(False, "RISK_APPROVAL", "BLOCKED_UNAPPROVED", "Strategy version is not APPROVED")
    if state.loss_locked:
        return GateResult(False, "RISK_TWO_LOSSES", LOCK_TWO_LOSSES,
                          f"Two completed losing trades: entries locked until next session "
                          f"(consecutive_losses={state.consecutive_losses})")
    if entry_time >= cutoff:
        return GateResult(False, "RISK_SESSION_CUTOFF", "SESSION_CUTOFF", "At or after demo session cutoff")
    if position_open:
        return GateResult(False, "RISK_FLAT_ONLY", "POSITION_NOT_FLAT", "Position still open; no pyramiding")
    if state.max_trades_reached:
        return GateResult(False, "RISK_MAX_TRADES", LOCK_MAX_TRADES,
                          f"Maximum completed trades reached ({state.completed_trades}/{state.max_completed_trades})")
    if stop_ticks is None:
        return GateResult(False, "RISK_STOP_VALID", "MISSING_STOP", "No protective stop could be computed")
    if entry_ticks - stop_ticks <= 0:
        return GateResult(False, "RISK_STOP_VALID", "INVALID_RISK", "Entry is not above stop (risk <= 0)")
    if equity_usd < quantity * margin_per_contract_usd:
        return GateResult(False, "RISK_MARGIN", "INSUFFICIENT_MARGIN", "Mock account margin reserve insufficient")
    return PASS
