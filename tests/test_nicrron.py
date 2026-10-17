"""Mocked Nicrron integration: request shape, pipeline safety and error handling.

No test reaches the network (see conftest._no_live_nicrron); responses mimic the
OpenAI-compatible chat-completions body documented for the Nicrron gateway.
"""
import json

import httpx
import pytest

from backend import nicrron_client

from .conftest import CONTRACT, FAKE_KEY

REF = {"strategy_id": "ng-demo-v1"}


def ai(overrides=None, questions=(), unsupported=(), notes=()):
    return {"overrides": overrides or {}, "clarification_questions": list(questions),
            "unsupported_requirements": list(unsupported), "interpretation_notes": list(notes)}


def gen(client, text, **body):
    r = client.post("/api/strategies/generate", json={"free_text": text, **body})
    assert r.status_code == 200, r.text
    return r.json()


# ---- request shape ----------------------------------------------------------

def test_request_follows_documented_openai_compatible_api(client, nicrron):
    nicrron.reply(ai({"stop": {"buffer_ticks": 5}}))
    gen(client, "Stop 5 ticks below the swing low")
    assert len(nicrron.calls) == 1
    req = nicrron.calls[0]
    assert req.method == "POST"
    assert str(req.url) == "https://api.nicrron.ai/v1/chat/completions"
    assert req.headers["authorization"] == f"Bearer {FAKE_KEY}"
    body = json.loads(req.content)
    assert body["model"] == "nicrron/auto"
    assert body["temperature"] == 0
    assert [m["role"] for m in body["messages"]] == ["system", "user"]
    assert "Stop 5 ticks below the swing low" in body["messages"][1]["content"]
    assert "response_format" not in body  # JSON mode is not documented by Nicrron


def test_model_is_configurable(client, nicrron, monkeypatch):
    monkeypatch.setenv("NICRRON_MODEL", "nicrron/reasoning")
    r = gen(client, "buy pullbacks")
    assert json.loads(nicrron.calls[0].content)["model"] == "nicrron/reasoning"
    assert r["nicrron"]["model_requested"] == "nicrron/reasoning"


def test_key_read_from_dotenv_file(client, nicrron, monkeypatch, tmp_path):
    env = tmp_path / "backend.env"
    env.write_text('# local only\nNICRRON_API_KEY="sk-af-from-dotenv-file"\n', encoding="utf-8")
    monkeypatch.delenv("NICRRON_API_KEY")
    monkeypatch.setenv("NICRRON_ENV_FILE", str(env))
    r = gen(client, "buy pullbacks")
    assert nicrron.calls[0].headers["authorization"] == "Bearer sk-af-from-dotenv-file"
    assert "sk-af-from-dotenv-file" not in json.dumps(r)


# ---- successful generation --------------------------------------------------

def test_success_preserves_customer_values_and_still_needs_approval(client, nicrron):
    nicrron.reply(ai({"stop": {"buffer_ticks": 5}, "exit": {"target_r": 1.5},
                      "risk": {"max_completed_trades_per_session": 2}},
                     notes=["'5 ticks below the swing low' -> stop.buffer_ticks=5"]),
                  headers={"X-Nicrron-Cache": "HIT"})
    r = gen(client, "Stop 5 ticks below the swing low, take profit at 1.5R, max 2 trades a day")
    s = r["strategy"]
    assert r["generator"] == "NICRRON" and r["nicrron"]["status"] == "SUCCESS"
    assert r["nicrron"]["model_used"] == "anthropic/claude-sonnet-5-5" and r["nicrron"]["cached"] is True
    assert s["stop"]["buffer_ticks"] == 5 and s["exit"]["target_r"] == 1.5
    assert s["risk"]["max_completed_trades_per_session"] == 2
    assert r["interpreted_fields"] == ["exit.target_r", "risk.max_completed_trades_per_session",
                                       "stop.buffer_ticks"]
    assert set(s) == set(CONTRACT) and s["approval_status"] == "DRAFT"
    assert r["approvable"] is True and any(w.startswith("Nicrron:") for w in r["warnings"])

    ref = {**REF, "version": s["version"]}
    sim = client.post("/api/simulations/start", json={**ref, "fixture": "two-loss-lock"})
    assert sim.status_code == 409  # Nicrron output is a proposal; approval still required
    assert client.post("/api/strategies/approve", json=ref).json()["approval_status"] == "APPROVED"
    sid = client.post("/api/simulations/start", json={**ref, "fixture": "two-loss-lock"}).json()["simulation_id"]
    state = client.get(f"/api/simulations/{sid}").json()
    assert state["entry_locked"] is True and state["lock_reason"] == "TWO_CONSECUTIVE_LOSSES"
    assert client.get(f"/api/simulations/{sid}/report").json()["violations"] == 0


def test_explicit_ui_overrides_win_over_nicrron(client, nicrron):
    nicrron.reply(ai({"stop": {"buffer_ticks": 6}, "exit": {"target_r": 1.4}}))
    r = gen(client, "stop 6 ticks, target 1.4R", overrides={"stop": {"buffer_ticks": 4}})
    assert r["strategy"]["stop"]["buffer_ticks"] == 4 and r["strategy"]["exit"]["target_r"] == 1.4
    assert r["interpreted_fields"] == ["exit.target_r"]


def test_fenced_json_is_accepted(client, nicrron):
    nicrron.reply("```json\n" + json.dumps(ai({"entry": {"tolerance_ticks": 2}})) + "\n```")
    assert gen(client, "pullback within 2 ticks")["strategy"]["entry"]["tolerance_ticks"] == 2


def test_nicrron_provenance_is_a_separate_version_from_preset(client, nicrron):
    preset = client.post("/api/strategies/generate", json={}).json()
    nic = gen(client, "the usual rules")
    assert preset["strategy"]["version"] != nic["strategy"]["version"]
    assert preset["generator"] == "PRESET_FALLBACK" and nic["generator"] == "NICRRON"
    assert any("no strategy parameters" in w for w in nic["warnings"])


# ---- unsupported / unsafe output never becomes approvable -------------------

def test_unsupported_and_invalid_values_become_clarifications(client, nicrron):
    nicrron.reply(ai({"trend": {"ma_type": "EMA", "period": 50}, "direction": "SHORT",
                      "stop": {"buffer_ticks": 6}, "made_up_field": 1},
                     unsupported=["use a trailing stop on the runner"]))
    r = gen(client, "EMA 50 trend, also short the downtrend, stop 6 ticks, trail the runner")
    s = r["strategy"]
    assert s["trend"]["ma_type"] == "SMA" and s["direction"] == "LONG_ONLY"
    assert s["trend"]["period"] == 50 and s["stop"]["buffer_ticks"] == 6  # supported parts preserved
    qs = " | ".join(r["clarification_questions"])
    assert "trend.ma_type" in qs and "'direction'" in qs and "made_up_field" in qs and "trailing stop" in qs
    assert qs.count("Trailing stops are not supported") == 0  # keyword dup suppressed
    assert r["unsupported_requirements"] == ["use a trailing stop on the runner"]
    assert "trend.ma_type" not in r["interpreted_fields"]
    assert r["approvable"] is False
    resp = client.post("/api/strategies/approve", json={**REF, "version": s["version"]})
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "CLARIFICATION_REQUIRED"


@pytest.mark.parametrize("unsafe", [
    {"risk": {"stop_required": False}},
    {"risk": {"no_overnight": False}},
    {"simulation_only": False},
    {"instrument": {"symbol": "NG"}},
    {"timeframes": {"refine_minutes": 1}},
    {"exit": {"target_r": -2}},
    {"quantity_contracts": 2, "exit": {"first_target_close_contracts": 2}},
    {"stop": None},
])
def test_unsafe_nicrron_output_is_never_approvable(client, nicrron, unsafe):
    nicrron.reply(ai(unsafe))
    r = gen(client, "some rules")
    assert r["approvable"] is False and r["clarification_questions"]
    s = r["strategy"]
    assert s["risk"]["stop_required"] is True and s["risk"]["no_overnight"] is True
    assert s["simulation_only"] is True and s["instrument"] == CONTRACT["instrument"]
    assert s["timeframes"]["refine_minutes"] is None and s["exit"]["target_r"] > 0
    assert s["exit"]["first_target_close_contracts"] < s["quantity_contracts"] and s["stop"]
    assert client.post("/api/strategies/approve", json={**REF, "version": s["version"]}).status_code == 409


def test_points_flagged_even_if_nicrron_silently_converted(client, nicrron):
    nicrron.reply(ai({"stop": {"buffer_ticks": 4}}))
    r = gen(client, "stop 4 points under the low")
    assert any("points" in q for q in r["clarification_questions"]) and r["approvable"] is False


def test_nicrron_clarification_questions_pass_through(client, nicrron):
    nicrron.reply(ai(questions=["By '4 points' do you mean 4 ticks or 4 cents?"]))
    r = gen(client, "stop 4 points")
    assert r["clarification_questions"] == ["By '4 points' do you mean 4 ticks or 4 cents?"]  # no keyword dup
    assert r["approvable"] is False
    nicrron.reply(ai(questions=["Which swing low do you mean?"]))
    r = gen(client, "stop 4 points under the swing low")
    assert len(r["clarification_questions"]) == 2  # unrelated question does not suppress the 'points' guard


def test_risk_loosening_is_warned(client, nicrron):
    nicrron.reply(ai({"risk": {"consecutive_loss_lock": 3, "max_completed_trades_per_session": 5}}))
    r = gen(client, "stop after 3 losses, up to 5 trades")
    assert sum(w.startswith("RISK_LOOSENED") for w in r["warnings"]) == 2
    assert r["approvable"] is True  # customer's explicit choice, surfaced for human approval


# ---- failures are reported, fallback is labeled and not approvable -----------

def _assert_failed_fallback(r, code):
    assert r["generator"] == "PRESET_FALLBACK"
    assert r["nicrron"]["status"] in ("FAILED", "NOT_CONFIGURED")
    assert r["nicrron"]["error_code"] == code
    assert r["approvable"] is False
    assert "NOT your written requirements" in r["clarification_questions"][0]
    assert any("DEMO PRESET FALLBACK" in w for w in r["warnings"])
    assert r["interpreted_fields"] == []
    s = {k: v for k, v in r["strategy"].items() if k != "version"}
    assert s == {k: v for k, v in CONTRACT.items() if k != "version"}


def test_missing_key_stops_before_any_request(client):
    r = gen(client, "stop 5 ticks below the low")  # autouse guard fails on any HTTP call
    _assert_failed_fallback(r, "NICRRON_NOT_CONFIGURED")
    assert r["nicrron"]["status"] == "NOT_CONFIGURED"
    assert "backend/.env" in r["nicrron"]["error_message"]


@pytest.mark.parametrize("status,body,code", [
    (401, {"error": {"message": "invalid key"}}, "NICRRON_AUTH_FAILED"),
    (403, {"error": {"message": "forbidden"}}, "NICRRON_AUTH_FAILED"),
    (429, {"error": {"message": "slow down"}}, "NICRRON_RATE_LIMITED"),
    (404, {"error": {"message": "model nicrron/auto not found"}}, "NICRRON_MODEL_UNAVAILABLE"),
    (400, {"error": {"message": "Unknown model: nicrron/auto"}}, "NICRRON_MODEL_UNAVAILABLE"),
    (400, {"error": {"message": "messages must not be empty"}}, "NICRRON_BAD_REQUEST"),
    (500, {"error": {"message": "boom"}}, "NICRRON_UPSTREAM_ERROR"),
    (503, {"error": {"message": "all providers down"}}, "NICRRON_UPSTREAM_ERROR"),
])
def test_http_errors_are_reported(client, nicrron, status, body, code):
    nicrron.reply(status=status, body=body, headers={"retry-after": "7"} if status == 429 else {})
    r = gen(client, "buy pullbacks")
    _assert_failed_fallback(r, code)
    assert r["nicrron"]["http_status"] == status
    if status == 429:
        assert r["nicrron"]["retry_after"] == "7"


def test_timeout_is_reported(client, nicrron):
    nicrron.reply(exc=lambda req: httpx.ReadTimeout("timed out", request=req))
    _assert_failed_fallback(gen(client, "buy pullbacks"), "NICRRON_TIMEOUT")


def test_connection_error_is_reported(client, nicrron):
    nicrron.reply(exc=lambda req: httpx.ConnectError("dns failure", request=req))
    _assert_failed_fallback(gen(client, "buy pullbacks"), "NICRRON_CONNECTION_ERROR")


@pytest.mark.parametrize("content,code", [
    ("Sure! I would set the stop to five ticks.", "NICRRON_INVALID_JSON"),
    ('{"overrides": [1, 2]}', "NICRRON_INVALID_OUTPUT"),
    ('{"overrides": {}, "clarification_questions": "nope"}', "NICRRON_INVALID_OUTPUT"),
    ("", "NICRRON_INVALID_JSON"),
])
def test_invalid_model_output_is_reported(client, nicrron, content, code):
    nicrron.reply(content)
    _assert_failed_fallback(gen(client, "buy pullbacks"), code)


def test_retry_count_comes_from_config(nicrron, monkeypatch):
    monkeypatch.setenv("NICRRON_MAX_RETRIES", "1")
    nicrron.reply(status=500, body={"error": {"message": "boom"}}, headers={"retry-after-ms": "1"})
    with pytest.raises(nicrron_client.NicrronError) as exc:
        nicrron_client.translate("buy pullbacks", CONTRACT)
    assert exc.value.code == "NICRRON_UPSTREAM_ERROR" and len(nicrron.calls) == 2


def test_failed_generation_is_audited(client, nicrron, tmp_path):
    nicrron.reply(status=401, body={"error": {"message": "bad key"}})
    gen(client, "buy pullbacks")
    rows = [json.loads(x) for x in (tmp_path / "audit" / "app_audit.jsonl").read_text(encoding="utf-8").splitlines()]
    assert rows[-1]["nicrron_status"] == "FAILED" and rows[-1]["nicrron_error"] == "NICRRON_AUTH_FAILED"
    assert FAKE_KEY not in json.dumps(rows)
