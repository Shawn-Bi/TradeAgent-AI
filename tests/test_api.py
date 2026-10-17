"""HTTP contract tests for PRD.md section 8 routes."""
import json

from simulation import run_simulation

from .conftest import CONTRACT

SIM_KEYS = {"simulation_id", "status", "account_id", "equity_usd", "positions", "completed_trades",
            "consecutive_losses", "entry_locked", "lock_reason", "prism_status"}
EVENT_KEYS = {"event_id", "seq", "timestamp", "rule_id", "expected_action", "actual_action", "compliant", "reason"}
REPORT_KEYS = {"simulation_id", "synthetic", "eligible_decisions", "compliant_decisions", "execution_conformance",
               "violations", "disclaimer"}
REF = {"strategy_id": "ng-demo-v1", "version": 1}


def _approve_v1(client):
    g = client.post("/api/strategies/generate", json={"template_id": "ng-long-pullback-v1", "overrides": {},
                                                      "free_text": ""})
    assert g.status_code == 200
    assert client.post("/api/strategies/approve", json=REF).status_code == 200
    return g.json()


def _err(resp, status, code):
    assert resp.status_code == status, resp.text
    body = resp.json()
    assert set(body) == {"error"} and set(body["error"]) == {"code", "message", "field"}
    assert body["error"]["code"] == code
    return body["error"]


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"ok": True, "contract_version": "1.0.0"}


def test_generate_preset_returns_exact_contract(client):
    r = client.post("/api/strategies/generate", json={"template_id": "ng-long-pullback-v1", "overrides": {},
                                                      "free_text": ""}).json()
    assert r["strategy"] == CONTRACT
    assert r["clarification_questions"] == [] and isinstance(r["warnings"], list)
    assert "4 ticks" in r["strategy_summary"] and "1.2R" in r["strategy_summary"]
    assert r["generator"] == "PRESET_FALLBACK"


def test_generate_is_idempotent_and_edits_create_new_draft_version(client):
    _approve_v1(client)
    again = client.post("/api/strategies/generate", json={}).json()["strategy"]
    assert again["version"] == 1 and again["approval_status"] == "APPROVED"
    edited = client.post("/api/strategies/generate", json={"overrides": {"stop": {"buffer_ticks": 5}}}).json()
    assert edited["strategy"]["version"] == 2
    assert edited["strategy"]["approval_status"] == "DRAFT"
    assert edited["strategy"]["stop"]["buffer_ticks"] == 5
    sim = client.post("/api/simulations/start", json={"strategy_id": "ng-demo-v1", "version": 2})
    _err(sim, 409, "STRATEGY_NOT_APPROVED")


def test_alias_routes(client):
    assert client.post("/api/strategy/generate", json={}).status_code == 200
    assert client.post("/api/strategy/approve", json=REF).json()["approval_status"] == "APPROVED"


def test_unapproved_strategy_cannot_start_or_run_scenarios(client):
    client.post("/api/strategies/generate", json={})
    _err(client.post("/api/simulations/start", json={**REF, "seed": 42, "fixture": "two-loss-lock"}),
         409, "STRATEGY_NOT_APPROVED")
    _err(client.post("/api/scenarios/generate", json={**REF, "seed": 42}), 409, "STRATEGY_NOT_APPROVED")
    _err(client.post("/api/strategies/approve", json={"strategy_id": "ng-demo-v1", "version": 9}),
         404, "STRATEGY_NOT_FOUND")


def test_ambiguous_points_requires_clarification(client, nicrron):
    r = client.post("/api/strategies/generate", json={"free_text": "stop 4 points under the swing low"}).json()
    assert any("points" in q and "ticks" in q for q in r["clarification_questions"])
    assert r["strategy"]["approval_status"] == "DRAFT" and r["approvable"] is False
    _err(client.post("/api/strategies/approve", json={"strategy_id": "ng-demo-v1",
                                                      "version": r["strategy"]["version"]}),
         409, "CLARIFICATION_REQUIRED")
    ok = client.post("/api/strategies/generate", json={"free_text": "long only, no shorts, never hold overnight"})
    assert ok.json()["clarification_questions"] == []


def test_invalid_overrides_rejected(client):
    _err(client.post("/api/strategies/generate", json={"overrides": {"direction": "SHORT"}}),
         400, "OVERRIDE_NOT_ALLOWED")
    _err(client.post("/api/strategies/generate", json={"overrides": {"stop": None}}), 422, "MISSING_STOP")
    e = _err(client.post("/api/strategies/generate", json={"overrides": {"exit": {"target_r": 0}}}),
             422, "INVALID_STRATEGY")
    assert e["field"] == "exit.target_r"
    _err(client.post("/api/strategies/generate", json={"overrides": {"timeframes": {"refine_minutes": 1}}}),
         422, "INVALID_STRATEGY")
    _err(client.post("/api/strategies/generate", json={"overrides": {"bogus": 1}}), 422, "INVALID_STRATEGY")
    _err(client.post("/api/strategies/generate", json={"template_id": "x"}), 400, "UNKNOWN_TEMPLATE")
    _err(client.post("/api/strategies/approve", json={"strategy_id": "ng-demo-v1"}), 422, "VALIDATION_ERROR")


def test_full_two_loss_lock_flow(client):
    _approve_v1(client)
    start = client.post("/api/simulations/start", json={**REF, "seed": 42, "fixture": "two-loss-lock"})
    assert start.status_code == 200
    s = start.json()
    assert s["status"] == "COMPLETED" and s["seed"] == 42
    sid = s["simulation_id"]

    sim = client.get(f"/api/simulations/{sid}").json()
    assert SIM_KEYS <= set(sim)
    assert sim["account_id"] == "DEMO-NG-001"
    assert sim["consecutive_losses"] == 2 and sim["entry_locked"] is True
    assert sim["lock_reason"] == "TWO_CONSECUTIVE_LOSSES" and sim["prism_status"] == "LOCAL_ONLY"
    assert sim["positions"] == [] and len(sim["completed_trades"]) == 2

    events = client.get(f"/api/simulations/{sid}/events").json()["events"]
    assert all(EVENT_KEYS <= set(e) for e in events)
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    blocked = [e for e in events if e["actual_action"] == "BLOCK_ENTRY"]
    assert len(blocked) == 1 and blocked[0]["rule_id"] == "RISK_TWO_LOSSES" and blocked[0]["compliant"] is True

    rep = client.get(f"/api/simulations/{sid}/report").json()
    assert REPORT_KEYS <= set(rep)
    assert rep["synthetic"] is True and rep["violations"] == 0 and rep["execution_conformance"] == 1.0
    assert rep["disclaimer"] == "Synthetic demo, not historical backtest"


def test_default_fixture_is_standard_and_unknown_fixture_rejected(client):
    _approve_v1(client)
    s = client.post("/api/simulations/start", json=REF).json()
    assert s["fixture"] == "standard" and s["seed"] == 42
    _err(client.post("/api/simulations/start", json={**REF, "fixture": "nope"}), 400, "UNKNOWN_FIXTURE")
    _err(client.get("/api/simulations/missing"), 404, "SIMULATION_NOT_FOUND")
    _err(client.get("/api/simulations/missing/events"), 404, "SIMULATION_NOT_FOUND")
    _err(client.get("/api/not-a-route"), 404, "NOT_FOUND")


def test_scenarios_are_synthetic_and_engine_computed(client, approved):
    _approve_v1(client)
    r = client.post("/api/scenarios/generate", json={**REF, "seed": 42}).json()
    assert r["synthetic"] is True and r["method"] == "RULE_BASED_SYNTHETIC_REPLAY" and r["seed"] == 42
    assert [s["name"] for s in r["scenarios"]] == ["trend", "range", "adverse"]
    for s in r["scenarios"]:
        assert s["assumptions"] and "not a historical backtest" in s["narrative"]
        assert s["computed_pnl_usd"] == run_simulation(approved, 42, s["name"])["realized_pnl_usd"]
    assert "win rate" not in json.dumps(r).lower().replace("no win rate", "")


def test_api_key_never_exposed(client, nicrron):
    from .conftest import FAKE_KEY

    nicrron.reply(status=401, body={"error": {"message": f"Invalid API key: {FAKE_KEY}"}})
    r = client.post("/api/strategies/generate", json={"free_text": "buy pullbacks in an uptrend"})
    assert r.status_code == 200
    assert FAKE_KEY not in r.text and "sk-af-test" not in r.text
    assert r.json()["nicrron"]["error_code"] == "NICRRON_AUTH_FAILED"
    assert r.json()["generator"] == "PRESET_FALLBACK"


def test_cors_allows_local_frontend(client):
    r = client.options("/api/health", headers={"Origin": "http://localhost:5173",
                                               "Access-Control-Request-Method": "GET"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_local_audit_written(client, tmp_path):
    _approve_v1(client)
    sid = client.post("/api/simulations/start", json={**REF, "fixture": "two-loss-lock"}).json()["simulation_id"]
    audit_dir = tmp_path / "audit"
    app_log = [json.loads(x) for x in (audit_dir / "app_audit.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [r["action"] for r in app_log] == ["STRATEGY_GENERATED", "STRATEGY_APPROVED", "SIMULATION_COMPLETED"]
    events = (audit_dir / f"{sid}.events.jsonl").read_text(encoding="utf-8").splitlines()
    assert any("TWO_CONSECUTIVE_LOSSES" in line for line in events)
