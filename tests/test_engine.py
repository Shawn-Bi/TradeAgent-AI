"""Deterministic engine tests mapped to FIRST_CUSTOMER_STRATEGY.md section E (T01-T12)."""
import math
from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from simulation import FIXTURES, get_report, run_simulation
from simulation.candles import get_fixture
from simulation.risk import SessionRiskState, pre_trade_gates

TICK = Decimal("0.001")


def ticks(price):
    return int((Decimal(str(price)) / TICK).to_integral_value())


def by_action(r, action):
    return [e for e in r["events"] if e["expected_action"] == action]


def test_t01_entry_at_next_1m_open_after_completed_5m_signal(approved):
    r = run_simulation(approved, 42, "two-loss-lock")
    candles = {c["timestamp"]: c for c in get_fixture("two-loss-lock", 42, *_day_tz(approved))["candles"]}
    p1 = r["completed_trades"][0]
    signal_start = datetime.fromisoformat(p1["signal_bar_id"].split("-", 1)[1])
    assert datetime.fromisoformat(p1["entry_time"]) == signal_start + timedelta(minutes=5)
    assert p1["entry_price"] == candles[p1["entry_time"]]["open"]
    assert p1["quantity_contracts"] == 2
    risk = ticks(p1["entry_price"]) - ticks(p1["stop_price"])
    assert risk == p1["initial_risk_ticks"] > 0
    assert ticks(p1["target_price"]) == ticks(p1["entry_price"]) + math.ceil(Decimal("1.2") * risk)


def test_t01_stop_is_swing_low_minus_4_ticks(approved):
    r = run_simulation(approved, 42, "two-loss-lock")
    opened = by_action(r, "OPEN_LONG")[0]
    candles = get_fixture("two-loss-lock", 42, *_day_tz(approved))["candles"]
    signal_start = datetime.fromisoformat(opened["signal_bar_id"].split("-", 1)[1])
    window_start = signal_start - timedelta(minutes=20)  # 5 completed 5m bars incl. signal bar
    lows = [ticks(c["low"]) for c in candles
            if window_start <= datetime.fromisoformat(c["timestamp"]) < signal_start + timedelta(minutes=5)]
    p1 = r["completed_trades"][0]
    assert ticks(p1["stop_price"]) == min(lows) - 4


def test_t02_trend_failure_never_trades(approved):
    r = run_simulation(approved, 42, "trend-fail")
    signals = [e for e in r["events"] if e["category"] == "SIGNAL"]
    assert signals and all(e["reason_code"] == "NO_TRADE_TREND" and e["trend_ok"] is False for e in signals)
    assert r["fills"] == [] and r["completed_trades"] == []


def test_t03_no_trade_entry_events_really_fail_the_entry_rule(approved):
    r = run_simulation(approved, 42, "standard")
    rejected = [e for e in r["events"] if e["reason_code"] == "NO_TRADE_ENTRY"]
    assert rejected
    for e in rejected:
        d = e["details"]
        sma, tol = Decimal(str(d["sma5"])), Decimal(d["tolerance_ticks"]) * TICK
        low, o, c = (Decimal(str(d[k])) for k in ("bar5_low", "bar5_open", "bar5_close"))
        in_band = sma - tol - Decimal("0.0001") <= low <= sma + tol + Decimal("0.0001")
        assert not (in_band and c > o and c > sma + Decimal("0.0001")), e


def test_t04_unapproved_strategy_blocks_every_candidate(contract):
    assert contract["approval_status"] == "DRAFT"
    r = run_simulation(contract, 42, "two-loss-lock")
    blocked = by_action(r, "BLOCK_ENTRY")
    assert blocked and all(e["reason_code"] == "BLOCKED_UNAPPROVED" for e in blocked)
    assert r["fills"] == []


def _gate(**kw):
    tz_now = datetime.fromisoformat("2026-10-17T10:00:00-04:00")
    args = dict(approved=True, state=SessionRiskState(3, 2), entry_time=tz_now,
                cutoff=tz_now + timedelta(hours=6), position_open=False, entry_ticks=3100, stop_ticks=3090,
                equity_usd=100_000.0, quantity=2, margin_per_contract_usd=5_000.0)
    args.update(kw)
    return pre_trade_gates(**args)


def test_t05_invalid_risk_and_missing_stop_rejected():
    assert _gate().passed
    assert _gate(stop_ticks=3100).reason_code == "INVALID_RISK"
    assert _gate(stop_ticks=3105).reason_code == "INVALID_RISK"
    assert _gate(stop_ticks=None).reason_code == "MISSING_STOP"
    assert _gate(equity_usd=1.0).reason_code == "INSUFFICIENT_MARGIN"
    assert _gate(position_open=True).reason_code == "POSITION_NOT_FLAT"


def test_gate_order_matches_spec():
    locked = SessionRiskState(3, 2, completed_trades=3, consecutive_losses=2, loss_locked=True)
    assert _gate(approved=False, state=locked).reason_code == "BLOCKED_UNAPPROVED"
    assert _gate(state=locked).reason_code == "TWO_CONSECUTIVE_LOSSES"
    late = datetime.fromisoformat("2026-10-17T16:00:00-04:00")
    assert _gate(entry_time=late, cutoff=late).reason_code == "SESSION_CUTOFF"
    assert _gate(state=SessionRiskState(3, 2, completed_trades=3)).reason_code == "MAX_TRADES"


def test_t06_partial_exit_closes_exactly_one_then_original_stop(approved):
    r = run_simulation(approved, 42, "winning-reset")
    p2 = r["completed_trades"][1]
    first, second = p2["legs"]
    assert first["contracts"] == 1 and first["exit_reason"] == "TARGET_PARTIAL_EXIT"
    assert first["exit_price"] == p2["target_price"]
    assert second["contracts"] == 1 and second["exit_reason"] == "STOP_HIT"
    assert second["exit_price"] == p2["stop_price"]  # original stop unchanged
    assert p2["realized_pnl_usd"] == first["pnl_usd"] + second["pnl_usd"] > 0


def test_t08_winning_trade_resets_streak_and_max_trades_blocks(approved):
    r = run_simulation(approved, 42, "winning-reset")
    assert [t["result"] for t in r["completed_trades"]] == ["LOSS", "WIN", "LOSS"]
    streak = [e["details"]["consecutive_losses"] for e in by_action(r, "COUNT_LOSS") + by_action(r, "RESET_STREAK")]
    assert sorted(streak) == [0, 1, 1]
    assert r["consecutive_losses"] == 1
    assert r["entry_locked"] is True and r["lock_reason"] == "MAX_TRADES"
    blocked = by_action(r, "BLOCK_ENTRY")
    assert len(blocked) == 1 and blocked[0]["reason_code"] == "MAX_TRADES" and blocked[0]["compliant"]
    assert len([f for f in r["fills"] if f["side"] == "BUY"]) == 3


def test_t09_cutoff_flattens_open_position(approved):
    r = run_simulation(approved, 42, "cutoff")
    cut = by_action(r, "EXIT_CUTOFF")
    assert len(cut) == 1 and cut[0]["timestamp"] == "2026-10-17T16:00:00-04:00"
    assert r["completed_trades"][0]["legs"][-1]["contracts"] == 2
    assert r["positions"] == [] and r["session_status"] == "SESSION_CLOSED"
    assert r["events"][-1]["expected_action"] == "CLOSE_SESSION"
    assert all(e["timestamp"] <= "2026-10-17T16:00:00-04:00" for e in r["events"])


@pytest.mark.parametrize("fixture", ["standard", "two-loss-lock", "trend", "adverse"])
def test_t10_same_seed_same_audit_and_pnl(approved, fixture):
    a, b = run_simulation(approved, 7, fixture), run_simulation(approved, 7, fixture)
    assert a == b


def test_t10_different_seed_changes_seeded_candles(approved):
    day_tz = _day_tz(approved)
    assert get_fixture("standard", 1, *day_tz)["candles"] != get_fixture("standard", 2, *day_tz)["candles"]


def test_t11_ambiguous_bar_stop_first(approved):
    r = run_simulation(approved, 42, "ambiguous-bar")
    stops = by_action(r, "EXIT_STOP")
    assert len(stops) == 1 and stops[0]["reason_code"] == "AMBIGUOUS_BAR_STOP_FIRST"
    assert by_action(r, "EXIT_PARTIAL") == []
    trade = r["completed_trades"][0]
    assert trade["legs"] == [{**trade["legs"][0], "contracts": 2, "exit_price": trade["stop_price"]}]


def test_insufficient_history_waits_and_data_end_flattens(approved):
    candles = get_fixture("standard", 42, *_day_tz(approved))["candles"][:90]
    r = run_simulation(approved, 42, "standard", candles=candles)
    assert r["events"][0]["reason_code"] == "WAIT_INSUFFICIENT_HISTORY"
    assert r["fills"] == []
    assert r["events"][-1]["reason_code"] == "DATA_END_BEFORE_CUTOFF"
    assert get_report(r)["execution_conformance"] is None or get_report(r)["violations"] == 0


def test_report_conformance_is_null_without_eligible_decisions(approved):
    r = run_simulation(approved, 42, "standard", candles=[])
    r["events"] = [e for e in r["events"] if not e["eligible"]]
    assert get_report(r)["execution_conformance"] is None


@pytest.mark.parametrize("fixture", FIXTURES)
@pytest.mark.parametrize("seed", [1, 42, 99])
def test_invariants_every_fixture(approved, fixture, seed):
    r = run_simulation(approved, seed, fixture)
    net = 0
    for f in r["fills"]:
        net += f["contracts"] if f["side"] == "BUY" else -f["contracts"]
        assert 0 <= net <= approved["quantity_contracts"]  # long only, no pyramiding
        if f["side"] == "BUY":
            assert f["timestamp"] < "2026-10-17T16:00:00-04:00"
    assert net == 0 and r["positions"] == []  # flat, no overnight
    assert len(r["completed_trades"]) <= approved["risk"]["max_completed_trades_per_session"]
    for t in r["completed_trades"]:
        assert t["initial_risk_ticks"] > 0
        assert round(sum(leg["pnl_usd"] for leg in t["legs"]), 2) == t["realized_pnl_usd"]
    assert r["equity_usd"] == round(100_000 + sum(t["realized_pnl_usd"] for t in r["completed_trades"]), 2)
    rep = get_report(r)
    assert rep["violations"] == 0 and rep["execution_conformance"] == 1.0
    assert all(e["data_source"] == "MOCK" for e in r["events"])
    assert r["prism_status"] == "LOCAL_ONLY"


def _day_tz(strategy):
    from datetime import date

    return date.fromisoformat(strategy["session"]["demo_date"]), strategy["session"]["timezone"]
