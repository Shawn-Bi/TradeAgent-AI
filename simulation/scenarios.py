"""Hypothetical scenario replays: engine-computed numbers on labeled synthetic candles."""
from __future__ import annotations

from .engine import run_simulation

SCENARIOS = [
    ("trend", "Synthetic uptrend with oscillating pullbacks"),
    ("range", "Synthetic sideways range with no drift"),
    ("adverse", "Synthetic uptrend that reverses into a downtrend at 11:00"),
]


def generate_scenarios(strategy: dict, seed: int) -> dict:
    out = []
    for name, shape in SCENARIOS:
        r = run_simulation(strategy, seed=seed, fixture=name)
        entries = sum(1 for e in r["events"] if e["actual_action"] == "OPEN_LONG")
        evaluations = sum(1 for e in r["events"] if e["category"] in ("SIGNAL", "RISK_GATE")
                          or e["expected_action"] == "OPEN_LONG")
        pnl = r["realized_pnl_usd"]
        narrative = (
            f"{shape} (seed {seed}). The deterministic engine evaluated {evaluations} completed 5m bars, "
            f"opened {entries} paper position(s), blocked {r['blocked_entry_count']} candidate(s) via risk gates "
            f"and completed {r['completed_trade_count']} trade(s) for a computed synthetic P&L of "
            f"{pnl:+.2f} USD (zero fees/slippage). "
            + ("Entries were locked: " + r["lock_reason"] + ". " if r["entry_locked"] else "")
            + "Hypothetical illustration only, not a historical backtest or a forecast."
        )
        out.append({
            "name": name,
            "assumptions": [
                f"synthetic candles: {r['fixture_description']} (seed {seed})",
                *r["assumptions"][1:],
            ],
            "narrative": narrative,
            "computed_pnl_usd": pnl,
            # additive
            "completed_trades": r["completed_trade_count"],
            "entries": entries,
            "blocked_entries": r["blocked_entry_count"],
            "entry_locked": r["entry_locked"],
            "lock_reason": r["lock_reason"],
        })
    return {
        "synthetic": True,
        "method": "RULE_BASED_SYNTHETIC_REPLAY",
        "seed": seed,
        "scenarios": out,
        "disclaimer": "Hypothetical synthetic scenarios, not historical backtests; no win rate is implied.",
    }
