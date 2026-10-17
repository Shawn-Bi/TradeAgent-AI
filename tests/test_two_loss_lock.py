"""P0-4: two completed losses lock entries; third otherwise-eligible entry is BLOCKED."""
import json

from simulation import get_report, run_simulation
from simulation.candles import get_fixture
from simulation.engine import _Config, _Simulator, _to_bars, reconcile
from simulation.fixture_replay import replay_event_fixture

from .conftest import ROOT

FIXTURE = json.loads((ROOT / "two_loss_lock.fixture.json").read_text(encoding="utf-8"))


def test_json_event_fixture_replays_through_real_risk_gate(approved):
    out = replay_event_fixture(FIXTURE, approved)
    for step in out["steps"]:
        assert step["matches"], step
    step5 = out["steps"][4]
    assert step5["actual"] == "BLOCK_ENTRY"
    assert step5["reason"] == "TWO_CONSECUTIVE_LOSSES"
    assert out["consecutive_losses"] == 2
    for key, expected in FIXTURE["assertions"].items():
        assert out[key] == expected, key


def test_candle_two_loss_lock_blocks_third_entry(approved):
    r = run_simulation(approved, seed=FIXTURE["seed"], fixture="two-loss-lock")
    trades = r["completed_trades"]
    assert len(trades) == 2
    assert all(t["realized_pnl_usd"] < 0 for t in trades)
    assert all(t["result"] == "LOSS" and t["status"] == "CLOSED" for t in trades)
    assert r["consecutive_losses"] == 2
    assert r["entry_locked"] is True
    assert r["lock_reason"] == "TWO_CONSECUTIVE_LOSSES"
    assert r["positions"] == []

    blocked = [e for e in r["events"] if e["expected_action"] == "BLOCK_ENTRY"]
    assert len(blocked) == 1
    b = blocked[0]
    assert b["rule_id"] == "RISK_TWO_LOSSES"
    assert b["actual_action"] == "BLOCK_ENTRY"
    assert b["compliant"] is True
    assert b["reason_code"] == "TWO_CONSECUTIVE_LOSSES"
    assert b["trend_ok"] is True and b["entry_ok"] is True  # otherwise eligible
    assert b["session_locked"] is True

    lock = next(e for e in r["events"] if e["expected_action"] == "LOCK_ENTRIES")
    assert lock["seq"] < b["seq"] and lock["compliant"] is True
    buys = [f for f in r["fills"] if f["side"] == "BUY"]
    assert [f["position_id"] for f in buys] == ["P1", "P2"]
    assert all(f["timestamp"] <= lock["timestamp"] for f in buys)

    rep = get_report(r)
    assert rep["violations"] == 0
    assert rep["execution_conformance"] == 1.0
    assert rep["eligible_decisions"] == rep["compliant_decisions"] > 0


def test_lock_holds_for_rest_of_session_and_only_new_session_clears(approved):
    r = run_simulation(approved, seed=42, fixture="two-loss-lock")
    lock_seq = next(e["seq"] for e in r["events"] if e["expected_action"] == "LOCK_ENTRIES")
    after = [e for e in r["events"] if e["seq"] > lock_seq]
    assert not any(e["actual_action"] == "OPEN_LONG" for e in after)
    assert all(e["session_locked"] for e in after)
    fresh = run_simulation(approved, seed=42, fixture="standard")  # new simulated session
    assert fresh["consecutive_losses"] == 0 and fresh["lock_reason"] != "TWO_CONSECUTIVE_LOSSES"


def test_audit_reconciliation_detects_an_order_after_lock(approved):
    """The audit is not tautological: a ledger row after the lock is flagged."""
    cfg = _Config.from_strategy(approved)
    fx = get_fixture("two-loss-lock", 42, cfg.day, cfg.tz.key)
    sim = _Simulator(cfg, _to_bars(fx["candles"], cfg))
    sim.run()
    blocked = next(e for e in sim.events if e["expected_action"] == "BLOCK_ENTRY")
    sim.fills.append({"fill_id": "rogue", "timestamp": blocked["timestamp"], "position_id": "P3", "side": "BUY",
                      "contracts": 2, "price_ticks": 3400, "action": "OPEN_LONG",
                      "decision_ref": blocked["event_id"]})
    orphans = reconcile(sim.events, sim.fills)
    assert orphans == 1
    assert blocked["actual_action"] == "OPEN_LONG" and blocked["compliant"] is False
    lock = next(e for e in sim.events if e["expected_action"] == "LOCK_ENTRIES")
    assert lock["actual_action"] == "ENTRY_AFTER_LOCK" and lock["compliant"] is False
