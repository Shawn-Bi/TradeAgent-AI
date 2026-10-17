"""PRISM Knowledge Base retrieval (prompt v2): used in the prompt, shown in the response, never blocking."""
import json

import httpx
import pytest

from backend import kb_client, nicrron_client, prism_client

from .conftest import FAKE_PRISM_KEY

GOOD = {"overrides": {"stop": {"buffer_ticks": 6}}, "clarification_questions": [],
        "unsupported_requirements": [], "interpretation_notes": ["stop.buffer_ticks=6 from 'stop 6 ticks' [S1]"]}
TEXT = "Put my stop 6 ticks under the swing low."


def _generate(client, text=TEXT, **extra):
    r = client.post("/api/strategies/generate", json={"free_text": text, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def _messages(nicrron) -> list[dict]:
    return json.loads(nicrron.calls[0].content)["messages"]


def test_v2_retrieves_cites_and_reports_sources(client, nicrron, prism):
    nicrron.reply(GOOD)
    body = _generate(client, session_id="conv-kb")

    kb_req = json.loads(prism.kb_calls[0].content)
    assert kb_req == {"project_id": "00000000-0000-0000-0000-000000000001",
                      "agent_id": "tradeagent-strategy-translator", "query": TEXT, "limit": 3}
    assert prism.kb_calls[0].url.host == "api.prism.blockconvey.com"
    assert prism.kb_calls[0].headers["X-PRISMtrace-Key"] == FAKE_PRISM_KEY

    system = _messages(nicrron)[0]["content"]
    assert system.startswith(nicrron_client.SYSTEM_PROMPT_V2)
    assert "KNOWLEDGE_BASE_CONTEXT" in system
    assert "[S1] source: NG_SIM_UNITS.md\nPoints are NOT ticks." in system
    assert "[S2] source: STRATEGYSPEC_FIELD_GUIDE.md" in system

    kb = body["knowledge_base"]
    assert kb["status"] == "USED" and kb["error"] is None
    assert kb["sources_used"] == ["NG_SIM_UNITS.md", "STRATEGYSPEC_FIELD_GUIDE.md"]
    assert kb["snippets"][0] == {"source": "NG_SIM_UNITS.md", "score": 0.31,
                                 "excerpt": "Points are NOT ticks. 1 tick = 0.001 price units = $10 per contract."}
    assert body["nicrron"]["prompt_version"] == "v2"
    assert body["generator"] == "NICRRON" and body["approvable"] is True

    trace = prism.bodies()[0]
    assert trace["metadata"]["prompt_version"] == "v2" and trace["metadata"]["kb_status"] == "USED"
    assert trace["metadata"]["kb_sources"] == ["NG_SIM_UNITS.md", "STRATEGYSPEC_FIELD_GUIDE.md"]
    assert "[S1] source: NG_SIM_UNITS.md" in trace["input_messages"][0]["content"]

    span_req = json.loads(prism.span_calls[0].content)
    assert span_req["trace_id"] == "trace-1" and span_req["session_id"] == "conv-kb"
    span = span_req["spans"][0]
    assert span["span_type"] == "tool" and span["name"] == "knowledge_base_search"
    assert span["input_text"] == TEXT and "Points are NOT ticks." in span["output_text"]
    assert body["prism"]["context_span"] == "SENT"


def test_kb_http_error_never_blocks_generation(client, nicrron, prism):
    nicrron.reply(GOOD)
    prism.kb_status = 500
    body = _generate(client)
    assert body["generator"] == "NICRRON" and body["approvable"] is True
    kb = body["knowledge_base"]
    assert kb["status"] == "FAILED" and "HTTP 500" in kb["error"] and kb["sources_used"] == []
    assert FAKE_PRISM_KEY not in kb["error"]
    assert "(no documents matched this request)" in _messages(nicrron)[0]["content"]
    assert body["prism"]["status"] == "SENT" and prism.span_calls == []  # no retrieval step to attach
    assert prism.bodies()[0]["metadata"]["kb_status"] == "FAILED"


def test_kb_unreachable_never_blocks_generation(client, nicrron, prism):
    nicrron.reply(GOOD)
    prism.kb_exc = lambda req: httpx.ConnectError("boom", request=req)
    body = _generate(client)
    assert body["generator"] == "NICRRON" and body["approvable"] is True
    assert body["knowledge_base"]["status"] == "FAILED"


def test_kb_timeout_never_blocks_generation(client, nicrron, prism):
    nicrron.reply(GOOD)
    prism.kb_exc = lambda req: httpx.ReadTimeout("slow", request=req)
    body = _generate(client)
    assert body["generator"] == "NICRRON" and body["approvable"] is True
    assert body["knowledge_base"]["status"] == "FAILED"
    assert prism.kb_calls[0].extensions["timeout"]["read"] == prism_client.DEFAULT_TIMEOUT_S == 5.0
    assert prism.calls[0].extensions["timeout"]["read"] == 5.0


@pytest.mark.parametrize("value, expected", [("12", 12.0), ("2.5", 2.5), ("abc", 5.0), ("0", 5.0), ("90", 5.0), ("", 5.0)])
def test_prism_timeout_from_env(client, nicrron, prism, monkeypatch, value, expected):
    monkeypatch.setenv("PRISM_TIMEOUT_SECONDS", value)
    assert prism_client.timeout_s() == expected
    nicrron.reply(GOOD)
    _generate(client)
    # KB search, trace and span all use the configured limit
    assert prism.kb_calls[0].extensions["timeout"]["read"] == expected
    assert {c.extensions["timeout"]["read"] for c in prism.calls} == {expected}


def test_kb_no_match_is_still_a_traced_retrieval(client, nicrron, prism):
    nicrron.reply(GOOD)
    prism.kb_results = []
    body = _generate(client)
    assert body["knowledge_base"]["status"] == "NO_MATCH" and body["knowledge_base"]["sources_used"] == []
    span = json.loads(prism.span_calls[0].content)["spans"][0]
    assert span["output_text"].startswith("No Knowledge Base snippets matched")


def test_v1_is_the_original_prompt_without_retrieval(client, nicrron, prism, monkeypatch):
    monkeypatch.setenv("PROMPT_VERSION", "v1")
    nicrron.reply(GOOD)
    body = _generate(client)
    assert prism.kb_calls == [] and prism.span_calls == []
    assert _messages(nicrron)[0]["content"] == nicrron_client.SYSTEM_PROMPT
    assert body["knowledge_base"]["status"] == "NOT_REQUESTED"
    assert body["nicrron"]["prompt_version"] == "v1"
    assert prism.bodies()[0]["metadata"]["prompt_version"] == "v1"
    assert "context_span" not in body["prism"]


def test_kb_not_configured_without_prism_credentials(client, nicrron):
    nicrron.reply(GOOD)  # the autouse guard fails the test on any PRISM request
    body = _generate(client)
    assert body["knowledge_base"]["status"] == "NOT_CONFIGURED"
    assert body["generator"] == "NICRRON" and body["nicrron"]["prompt_version"] == "v2"


def test_preset_makes_no_kb_call(client, prism):
    body = _generate(client, text="")
    assert prism.kb_calls == [] and body["knowledge_base"]["status"] == "NOT_REQUESTED"
    assert body["nicrron"]["prompt_version"] is None


def test_unknown_prompt_version_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("PROMPT_VERSION", "v9")
    assert nicrron_client.prompt_version() == nicrron_client.DEFAULT_PROMPT_VERSION
    monkeypatch.setenv("PROMPT_VERSION", "V1")
    assert nicrron_client.prompt_version() == "v1"


def test_v2_prompt_extends_v1():
    v2 = nicrron_client.build_messages(TEXT, {}, version="v2", kb_context="[S1] source: X\nfoo")
    v1 = nicrron_client.build_messages(TEXT, {}, version="v1")
    assert v2[0]["content"].startswith(nicrron_client.SYSTEM_PROMPT)
    assert "Never invent a value" in v2[0]["content"] and "a point is NOT a tick" in v2[0]["content"]
    assert v1[1] == v2[1]  # identical user message: same input for both versions
