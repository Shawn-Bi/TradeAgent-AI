"""PRISM tracing: one trace per Nicrron call, never blocking, CONNECTED only when real."""
from backend import prism_client

from .conftest import FAKE_KEY, FAKE_PRISM_KEY

GOOD = {"overrides": {"stop": {"buffer_ticks": 6}}, "clarification_questions": [],
        "unsupported_requirements": [], "interpretation_notes": ["stop.buffer_ticks=6 from 'stop 6 ticks'"]}


def _generate(client, text="Put my stop 6 ticks under the swing low.", **extra):
    r = client.post("/api/strategies/generate", json={"free_text": text, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def _approve_and_run(client, version):
    client.post("/api/strategies/approve", json={"strategy_id": "ng-demo-v1", "version": version})
    sid = client.post("/api/simulations/start", json={"strategy_id": "ng-demo-v1", "version": version,
                                                      "fixture": "two-loss-lock"}).json()["simulation_id"]
    return client.get(f"/api/simulations/{sid}").json(), client.get(f"/api/simulations/{sid}/report").json()


def test_not_configured_keeps_local_only(client, nicrron):
    nicrron.reply(GOOD)
    body = _generate(client)
    assert body["prism"]["status"] == "NOT_CONFIGURED"
    state, report = _approve_and_run(client, body["strategy"]["version"])
    assert state["prism_status"] == "LOCAL_ONLY" and report["prism_status"] == "LOCAL_ONLY"
    assert state["prism_trace_id"] is None


def test_trace_sent_for_each_model_call(client, nicrron, prism):
    nicrron.reply(GOOD)
    body = _generate(client, session_id="conv-1")
    assert body["prism"] == {"status": "SENT", "trace_id": "trace-1", "error": None, "send_ms": body["prism"]["send_ms"],
                             "session_id": "conv-1", "agent_id": prism_client.AGENT_ID}
    req = prism.calls[0]
    assert req.url.path == "/api/traces" and req.headers["X-PRISMtrace-Key"] == FAKE_PRISM_KEY
    sent = prism.bodies()[0]
    assert sent["agent_id"] == "tradeagent-strategy-translator" and sent["session_id"] == "conv-1"
    assert sent["model"] == nicrron.model
    assert sent["input_messages"][0]["role"] == "system"
    assert "Put my stop 6 ticks" in sent["input_messages"][-1]["content"]
    assert '"buffer_ticks": 6' in sent["output_message"]
    assert sent["metadata"]["prompt_version"] == "v1"
    assert sent["metadata"]["interpreted_fields"] == ["stop.buffer_ticks"]
    assert sent["metadata"]["approvable"] is True
    assert FAKE_KEY not in str(sent)  # the Nicrron key never leaves the server


def test_simulation_connected_only_with_accepted_trace(client, nicrron, prism):
    nicrron.reply(GOOD)
    version = _generate(client)["strategy"]["version"]
    state, report = _approve_and_run(client, version)
    assert state["prism_status"] == "CONNECTED" and report["prism_status"] == "CONNECTED"
    assert state["prism_trace_id"] == "trace-1" and state["prism_scope"] == "STRATEGY_GENERATION"


def test_preset_makes_no_trace(client, prism):
    body = _generate(client, text="")
    assert body["prism"]["status"] == "NOT_REQUESTED" and prism.calls == []
    state, _ = _approve_and_run(client, body["strategy"]["version"])
    assert state["prism_status"] == "LOCAL_ONLY"


def test_prism_failure_never_blocks_drafting(client, nicrron, prism):
    nicrron.reply(GOOD)
    prism.status = 500
    body = _generate(client)
    assert body["generator"] == "NICRRON" and body["approvable"] is True
    assert body["prism"]["status"] == "FAILED" and "HTTP 500" in body["prism"]["error"]
    assert FAKE_PRISM_KEY not in body["prism"]["error"]
    state, _ = _approve_and_run(client, body["strategy"]["version"])
    assert state["prism_status"] == "LOCAL_ONLY"


def test_failed_model_call_is_traced_as_failure(client, nicrron, prism):
    nicrron.reply("this is not json")
    body = _generate(client)
    assert body["generator"] == "PRESET_FALLBACK"
    sent = prism.bodies()[0]
    assert sent["output_message"].startswith("[NICRRON ERROR NICRRON_INVALID_JSON]")
    assert sent["metadata"]["nicrron_status"] == "FAILED" and sent["metadata"]["approvable"] is False


def test_session_id_is_validated(client):
    r = client.post("/api/strategies/generate", json={"free_text": "", "session_id": "bad id with spaces"})
    assert r.status_code == 422
