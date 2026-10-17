"""PRISM (Block Convey) trace adapter over the documented HTTP path.

Verified against https://blockconvey.com/docs (read 2026-10-17):
* ``POST {PRISMTRACE_HOST}/api/traces`` with header ``X-PRISMtrace-Key``; body carries ``project_id``,
  ``model``, ``input_messages``, ``output_message``, ``latency_ms``, ``session_id``, ``agent_id``.
  A 200 returns the stored trace, including its ``id``.
* ``GET {PRISMTRACE_HOST}/api/setup-doctor?project_id=...`` reports ``live_connected`` / ``blocked_step``.

One trace = one Nicrron strategy-translation call, the only LLM step in TradeAgent AI. Engine decisions
are not sent: they are deterministic, not agent output, and stay in the local audit.

Tracing never blocks or fails a request. Any PRISM problem is recorded as ``FAILED`` and the app carries
on with ``prism_status: LOCAL_ONLY``. Keys are read server-side and never returned.
"""
from __future__ import annotations

import time

import httpx

from .config import setting as _setting
from .nicrron_client import _redact

DEFAULT_HOST = "https://prism.blockconvey.com"
AGENT_ID = "tradeagent-strategy-translator"
TIMEOUT_S = 5.0

_transport: httpx.BaseTransport | None = None  # tests inject httpx.MockTransport here


def config() -> dict:
    return {
        "host": (_setting("PRISMTRACE_HOST", DEFAULT_HOST) or DEFAULT_HOST).rstrip("/"),
        "project_id": _setting("PRISMTRACE_PROJECT_ID"),
        "api_key": _setting("PRISMTRACE_API_KEY"),
    }


def status() -> str:
    cfg = config()
    return "CONFIGURED" if cfg["project_id"] and cfg["api_key"] else "NOT_CONFIGURED"


def _client() -> httpx.Client:
    kwargs = {"transport": _transport} if _transport is not None else {}
    return httpx.Client(timeout=TIMEOUT_S, **kwargs)


def send_trace(*, session_id: str, model: str | None, input_messages: list[dict], output_message: str,
               latency_ms: int | None, metadata: dict) -> dict:
    """Send one trace. Returns {status, trace_id, error}; status is SENT, FAILED or NOT_CONFIGURED."""
    cfg = config()
    if not (cfg["project_id"] and cfg["api_key"]):
        return {"status": "NOT_CONFIGURED", "trace_id": None, "error": None}
    body = {
        "project_id": cfg["project_id"],
        "model": model or "unknown",
        "input_messages": input_messages,
        "output_message": output_message,
        "latency_ms": latency_ms or 0,
        "session_id": session_id,
        "agent_id": AGENT_ID,
        "metadata": metadata,
    }
    started = time.monotonic()
    try:
        with _client() as client:
            resp = client.post(f"{cfg['host']}/api/traces", json=body,
                               headers={"X-PRISMtrace-Key": cfg["api_key"]})
    except httpx.HTTPError as exc:
        return {"status": "FAILED", "trace_id": None,
                "error": f"PRISM unreachable: {_redact(exc, cfg['api_key'])}"}
    if resp.status_code != 200:
        return {"status": "FAILED", "trace_id": None,
                "error": f"PRISM returned HTTP {resp.status_code}: {_redact(resp.text, cfg['api_key'])[:300]}"}
    try:
        trace_id = resp.json().get("id")
    except ValueError:
        trace_id = None
    return {"status": "SENT", "trace_id": trace_id, "error": None,
            "send_ms": int((time.monotonic() - started) * 1000)}


def setup_doctor() -> dict:
    """Read-only connection check (``live_connected``, ``blocked_step``)."""
    cfg = config()
    if not (cfg["project_id"] and cfg["api_key"]):
        return {"status": "NOT_CONFIGURED"}
    with _client() as client:
        resp = client.get(f"{cfg['host']}/api/setup-doctor", params={"project_id": cfg["project_id"]},
                          headers={"X-PRISMtrace-Key": cfg["api_key"]})
    resp.raise_for_status()
    return resp.json()
