"""One-address deploy: the backend serves the built frontend next to the API (docs/DEPLOY.md)."""
import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def served(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>TradeAgent AI</title>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log('ok')", encoding="utf-8")
    monkeypatch.setenv("FRONTEND_DIST", str(dist))
    monkeypatch.setenv("AUDIT_DIR", str(tmp_path / "audit"))
    import backend.main as main

    main = importlib.reload(main)  # the mount is decided at import time
    main.reset_state()
    with TestClient(main.app) as c:
        yield c
    monkeypatch.delenv("FRONTEND_DIST")
    importlib.reload(main)


def test_root_serves_the_frontend(served):
    r = served.get("/")
    assert r.status_code == 200 and "TradeAgent AI" in r.text
    assert served.get("/assets/app.js").status_code == 200


def test_api_routes_still_win(served):
    assert served.get("/api/health").json()["ok"] is True
    assert served.post("/api/strategies/generate", json={}).status_code == 200


def test_unknown_api_path_keeps_json_404(served):
    r = served.get("/api/not-a-route")
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
    assert served.post("/api/nope", json={}).json()["error"]["code"] == "NOT_FOUND"


def test_token_guards_the_api_but_not_the_static_site(served, monkeypatch):
    monkeypatch.setenv("DEMO_ACCESS_TOKEN", "t0ken")
    assert served.get("/").status_code == 200
    assert served.post("/api/strategies/generate", json={}).status_code == 401


def test_no_frontend_build_means_api_only(client):
    # Without frontend/dist (plain backend dev and the rest of the suite) "/" is a JSON 404.
    import backend.main as main

    if (main.FRONTEND_DIST / "index.html").is_file():
        pytest.skip("frontend/dist is built in this checkout")
    assert client.get("/").status_code == 404
