"""Replay two_loss_lock.fixture.json (repo root) through the real risk gate.

The JSON fixture is an event sequence (fixture-only P&L of -80 / -100), not candles, so
it is replayed directly against ``SessionRiskState`` + ``pre_trade_gates`` — the same
objects the candle engine uses. Entries are "otherwise eligible": a valid stop below
entry, before cutoff, with sufficient demo margin.
"""
from __future__ import annotations

from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from .engine import DEMO_MARGIN_PER_CONTRACT_USD, STARTING_EQUITY_USD
from .risk import SessionRiskState, pre_trade_gates


def replay_event_fixture(fixture: dict, strategy: dict) -> dict:
    tz = ZoneInfo(strategy["session"]["timezone"])
    day = date.fromisoformat(strategy["session"]["demo_date"])
    hh, mm = (int(x) for x in strategy["session"]["cutoff_local"].split(":"))
    cutoff = datetime.combine(day, time(hh, mm), tzinfo=tz)
    entry_time = datetime.combine(day, time(10, 0), tzinfo=tz)
    qty = strategy["quantity_contracts"]
    state = SessionRiskState(strategy["risk"]["max_completed_trades_per_session"],
                             fixture["preconditions"].get("consecutive_loss_lock",
                                                          strategy["risk"]["consecutive_loss_lock"]))
    approved = fixture["preconditions"]["approval_status"] == "APPROVED"
    open_positions: set[str] = set()
    realized = 0.0
    steps = []
    opened_after_lock = False
    for step in fixture["steps"]:
        row = {"step": step["step"], "event": step["event"], "position_id": step.get("position_id")}
        if step["event"] == "ENTRY_ELIGIBLE":
            locked_before = state.loss_locked
            gate = pre_trade_gates(
                approved=approved, state=state, entry_time=entry_time, cutoff=cutoff,
                position_open=bool(open_positions), entry_ticks=3100, stop_ticks=3090,
                equity_usd=STARTING_EQUITY_USD + realized, quantity=qty,
                margin_per_contract_usd=DEMO_MARGIN_PER_CONTRACT_USD,
            )
            actual = "OPEN_LONG" if gate.passed else "BLOCK_ENTRY"
            if gate.passed:
                open_positions.add(step["position_id"])
                opened_after_lock |= locked_before
            row.update(expected=step["expected"], actual=actual, reason=gate.reason_code, rule_id=gate.rule_id,
                       matches=actual == step["expected"] and step.get("reason") in (None, gate.reason_code))
        elif step["event"] == "POSITION_CLOSED":
            open_positions.discard(step["position_id"])
            realized += step["realized_pnl_usd"]
            state.record_closed_position(step["realized_pnl_usd"])
            row.update(realized_pnl_usd=step["realized_pnl_usd"], consecutive_losses=state.consecutive_losses,
                       matches=state.consecutive_losses == step["expected_consecutive_losses"])
        else:
            row.update(matches=False, error="unknown fixture event")
        steps.append(row)
    return {
        "fixture_id": fixture["fixture_id"],
        "steps": steps,
        "consecutive_losses": state.consecutive_losses,
        "lock_reason": state.lock_reason,
        "new_position_after_step_5": opened_after_lock,
        "session_locked": state.entry_locked,
        "blocked_entry_logged": any(s.get("actual") == "BLOCK_ENTRY" for s in steps),
        "risk_violations": sum(1 for s in steps if not s["matches"]),
    }
