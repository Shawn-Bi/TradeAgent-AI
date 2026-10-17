"""The eval inputs are well-formed and the grader checks what the rubric says (no network)."""
import importlib.util
from pathlib import Path

from backend.strategy_service import _get_path
from .conftest import CONTRACT

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("eval_run", ROOT / "scripts" / "eval_run.py")
eval_run = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(eval_run)

EXPECT_KEYS = {"set", "set_or_clarify", "forbid", "allow", "approvable", "clarify_any", "warn_any"}
CATEGORIES = {"clear", "unit_trap", "fraction", "unsupported", "risk_loosening", "typo_runon", "vague"}


def test_inputs_are_well_formed():
    items = eval_run.load_inputs()
    assert len(items) >= 50 and len({i["id"] for i in items}) == len(items)
    assert {i["category"] for i in items} == CATEGORIES
    for item in items:
        assert item["text"].strip() and set(item["expect"]) <= EXPECT_KEYS, item["id"]
        e = item["expect"]
        paths = [*e.get("set", {}), *e.get("set_or_clarify", {}), *e.get("allow", {}), *e.get("forbid", [])]
        for p in paths:  # every path is a real StrategySpec field
            assert _get_path(CONTRACT, tuple(p.split("."))) is not eval_run._MISSING, (item["id"], p)


def _body(interpreted=(), strategy_patch=None, questions=(), warnings=(), approvable=None, generator="NICRRON"):
    strategy = {**CONTRACT, "stop": {**CONTRACT["stop"], **(strategy_patch or {}).get("stop", {})},
                "exit": {**CONTRACT["exit"], **(strategy_patch or {}).get("exit", {})}}
    return {"generator": generator, "strategy": strategy, "interpreted_fields": list(interpreted),
            "clarification_questions": list(questions), "warnings": list(warnings),
            "approvable": (not questions) if approvable is None else approvable,
            "nicrron": {"error_code": None if generator == "NICRRON" else "NICRRON_INVALID_JSON"}}


def test_grade_pass_and_wrong_value():
    expect = {"set": {"stop.buffer_ticks": 6, "exit.target_r": 1.5}, "approvable": True}
    ok = _body(["stop.buffer_ticks", "exit.target_r"], {"stop": {"buffer_ticks": 6}, "exit": {"target_r": 1.5}})
    assert eval_run.grade(expect, ok) == []
    wrong = _body(["stop.buffer_ticks", "exit.target_r"], {"stop": {"buffer_ticks": 60}, "exit": {"target_r": 1.5}})
    assert eval_run.grade(expect, wrong) == ["wrong:stop.buffer_ticks=60 (expected 6)"]


def test_grade_unit_trap_converted_points_fails():
    expect = {"forbid": ["stop.buffer_ticks"], "approvable": False, "clarify_any": ["tick"]}
    converted = _body(["stop.buffer_ticks"], {"stop": {"buffer_ticks": 40}}, questions=["Restate in ticks"])
    assert eval_run.grade(expect, converted) == ["forbidden:stop.buffer_ticks=40"]
    asked = _body([], questions=["Points are not ticks; how many ticks?"])
    assert eval_run.grade(expect, asked) == []


def test_grade_invented_value_and_silence():
    expect = {"approvable": False}
    invented = _body(["stop.buffer_ticks"], {"stop": {"buffer_ticks": 2}})
    assert eval_run.grade(expect, invented) == ["invented:stop.buffer_ticks=2", "not_asked"]


def test_grade_set_or_clarify_and_model_error():
    expect = {"set_or_clarify": {"stop.buffer_ticks": 4}}
    assert eval_run.grade(expect, _body([], questions=["0.004 = 4 ticks?"])) == []
    assert eval_run.grade(expect, _body([])) == ["missed:stop.buffer_ticks (neither set nor asked)"]
    assert eval_run.grade(expect, _body(generator="PRESET_FALLBACK")) == ["model_error:NICRRON_INVALID_JSON"]
