"""Public-demo protections: demo token guard, CORS allowlist, Nicrron spend guard."""
import json

import pytest

from backend import nicrron_client

TOKEN = "demo-token-for-tests-0123456789abcdef"
ALLOWED = "http://localhost:5173"
PROTECTED = [
    ("POST", "/api/strategies/generate", {"free_text": "stop 5 ticks"}),
    ("POST", "/api/strategy/generate", {}),
    ("POST", "/api/strategies/approve", {"strategy_id": "ng-demo-v1", "version": 1}),
    ("POST", "/api/strategy/approve", {"strategy_id": "ng-demo-v1", "version": 1}),
    ("POST", "/api/scenarios/generate", {"strategy_id": "ng-demo-v1", "version": 1, "seed": 42}),
    ("POST", "/api/simulations/start", {"strategy_id": "ng-demo-v1", "version": 1}),
    ("GET", "/api/simulations/sim-42-standard-v1", None),
    ("GET", "/api/simulations/sim-42-standard-v1/events", None),
    ("GET", "/api/simulations/sim-42-standard-v1/report", None),
]


@pytest.fixture
def guarded(monkeypatch):
    monkeypatch.setenv("DEMO_ACCESS_TOKEN", TOKEN)


def _send(client, method, path, body, headers=None):
    return client.request(method, path, json=body, headers=headers or {})


def test_guard_off_without_token_setting(client):
    assert client.post("/api/strategies/generate", json={}).status_code == 200
    assert client.get("/docs").status_code == 200


def test_health_stays_open(client, guarded):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"ok": True, "contract_version": "1.0.0"}


@pytest.mark.parametrize("method,path,body", PROTECTED)
def test_every_other_route_requires_token(client, guarded, method, path, body):
    for headers in ({}, {"X-Demo-Token": "wrong"}, {"X-Demo-Token": TOKEN[:-1]}):
        r = _send(client, method, path, body, headers)
        assert r.status_code == 401, (path, headers)
        assert r.json() == {"error": {"code": "UNAUTHORIZED", "message": "Missing or invalid X-Demo-Token header",
                                      "field": "X-Demo-Token"}}


def test_valid_token_runs_full_flow(client, guarded):
    h = {"X-Demo-Token": TOKEN}
    g = client.post("/api/strategies/generate", json={}, headers=h).json()
    ref = {"strategy_id": "ng-demo-v1", "version": g["strategy"]["version"]}
    assert client.post("/api/strategies/approve", json=ref, headers=h).status_code == 200
    s = client.post("/api/simulations/start", json={**ref, "fixture": "two-loss-lock"}, headers=h).json()
    assert client.get(f"/api/simulations/{s['simulation_id']}/report", headers=h).json()["violations"] == 0


def test_docs_hidden_when_guarded(client, guarded):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path, headers={"X-Demo-Token": TOKEN}).status_code == 404


def test_unauthorized_request_never_reaches_nicrron(client, guarded, nicrron):
    r = client.post("/api/strategies/generate", json={"free_text": "stop 5 ticks below the low"})
    assert r.status_code == 401 and nicrron.calls == []


def test_token_read_from_dotenv(client, monkeypatch, tmp_path):
    env = tmp_path / "demo.env"
    env.write_text(f"DEMO_ACCESS_TOKEN={TOKEN}\n", encoding="utf-8")
    monkeypatch.setenv("NICRRON_ENV_FILE", str(env))
    assert client.post("/api/strategies/generate", json={}).status_code == 401
    assert client.post("/api/strategies/generate", json={}, headers={"X-Demo-Token": TOKEN}).status_code == 200


def test_cors_preflight_allows_only_frontend_origin_and_headers(client, guarded):
    ok = client.options("/api/strategies/generate", headers={
        "Origin": ALLOWED, "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-demo-token"})
    assert ok.status_code == 200 and ok.headers["access-control-allow-origin"] == ALLOWED
    evil = client.options("/api/strategies/generate", headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in evil.headers
    odd = client.options("/api/strategies/generate", headers={
        "Origin": ALLOWED, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-other"})
    assert odd.status_code == 400
    assert "*" not in ok.headers.get("access-control-allow-origin", "")


def test_401_is_readable_by_allowed_browser_origin(client, guarded):
    r = client.post("/api/strategies/generate", json={}, headers={"Origin": ALLOWED})
    assert r.status_code == 401 and r.headers["access-control-allow-origin"] == ALLOWED


# ---- Nicrron spend guard ----------------------------------------------------

def test_hourly_budget_blocks_paid_calls(client, nicrron, monkeypatch):
    monkeypatch.setenv("NICRRON_MAX_CALLS_PER_HOUR", "2")
    for text in ("rule one", "rule two"):
        assert client.post("/api/strategies/generate", json={"free_text": text}).json()["generator"] == "NICRRON"
    r = client.post("/api/strategies/generate", json={"free_text": "rule three"}).json()
    assert len(nicrron.calls) == 2
    assert r["nicrron"]["error_code"] == "NICRRON_BUDGET_EXCEEDED" and r["nicrron"]["status"] == "FAILED"
    assert r["generator"] == "PRESET_FALLBACK" and r["approvable"] is False
    assert int(r["nicrron"]["retry_after"]) > 0


def test_concurrent_call_is_refused_and_slot_released(client, nicrron):
    nicrron_client._budget.acquire()  # simulate a generation already in flight
    try:
        r = client.post("/api/strategies/generate", json={"free_text": "rule"}).json()
        assert r["nicrron"]["error_code"] == "NICRRON_BUSY" and nicrron.calls == []
    finally:
        nicrron_client._budget.release()
    nicrron.reply(status=500, body={"error": {"message": "boom"}})
    client.post("/api/strategies/generate", json={"free_text": "rule a"})
    nicrron.reply(status=200, body=None)
    ok = client.post("/api/strategies/generate", json={"free_text": "rule b"}).json()
    assert ok["generator"] == "NICRRON"  # slot was released after the failed call


def test_missing_key_does_not_consume_budget(client, monkeypatch):
    monkeypatch.setenv("NICRRON_MAX_CALLS_PER_HOUR", "1")
    for _ in range(3):
        r = client.post("/api/strategies/generate", json={"free_text": "rule"}).json()
        assert r["nicrron"]["error_code"] == "NICRRON_NOT_CONFIGURED"


def test_token_never_echoed(client, guarded):
    r = client.post("/api/strategies/generate", json={}, headers={"X-Demo-Token": TOKEN + "x"})
    assert TOKEN not in r.text and TOKEN not in json.dumps(dict(r.headers))
