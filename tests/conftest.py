import copy
import json
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parent.parent
CONTRACT = json.loads((ROOT / "contracts" / "strategy.example.json").read_text(encoding="utf-8"))
FAKE_KEY = "sk-af-test-key-0123456789"


@pytest.fixture(autouse=True)
def _no_live_nicrron(tmp_path, monkeypatch):
    """Tests never read the real backend/.env and never reach the network."""
    from backend import nicrron_client

    monkeypatch.setenv("NICRRON_ENV_FILE", str(tmp_path / "missing.env"))
    monkeypatch.delenv("NICRRON_API_KEY", raising=False)
    monkeypatch.setenv("NICRRON_MAX_RETRIES", "0")

    def guard(request):
        raise AssertionError(f"unexpected live Nicrron request to {request.url}")

    monkeypatch.setattr(nicrron_client, "_transport", httpx.MockTransport(guard))


class NicrronMock:
    """Mocked Nicrron chat-completions endpoint (OpenAI-compatible response body)."""

    def __init__(self):
        self.calls: list[httpx.Request] = []
        self.status = 200
        self.content = json.dumps({"overrides": {}, "clarification_questions": [],
                                   "unsupported_requirements": [], "interpretation_notes": []})
        self.body = None
        self.headers = {}
        self.exc = None
        self.model = "anthropic/claude-sonnet-5-5"

    def reply(self, content=None, **kw):
        if content is not None:
            self.content = content if isinstance(content, str) else json.dumps(content)
        for k, v in kw.items():
            setattr(self, k, v)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        if self.exc is not None:
            raise self.exc(request)
        body = self.body if self.body is not None else {
            "id": "chatcmpl-test", "object": "chat.completion", "created": 1760000000, "model": self.model,
            "choices": [{"index": 0, "finish_reason": "stop",
                         "message": {"role": "assistant", "content": self.content}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
        }
        return httpx.Response(self.status, json=body, headers=self.headers)


@pytest.fixture
def nicrron(monkeypatch):
    from backend import nicrron_client

    mock = NicrronMock()
    monkeypatch.setenv("NICRRON_API_KEY", FAKE_KEY)
    monkeypatch.setattr(nicrron_client, "_transport", httpx.MockTransport(mock.handler))
    return mock


@pytest.fixture
def contract():
    return copy.deepcopy(CONTRACT)


@pytest.fixture
def approved(contract):
    contract["approval_status"] = "APPROVED"
    return contract


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIT_DIR", str(tmp_path / "audit"))
    from fastapi.testclient import TestClient

    from backend.main import app, reset_state

    reset_state()
    with TestClient(app) as c:
        yield c
    reset_state()
