"""PRISM (Block Convey) trace adapter over the documented HTTP path.

Verified against https://blockconvey.com/docs (read 2026-10-17):
* ``POST {PRISMTRACE_HOST}/api/traces`` with header ``X-PRISMtrace-Key``; body carries ``project_id``,
  ``model``, ``input_messages``, ``output_message``, ``latency_ms``, ``session_id``, ``agent_id``.
  A 200 returns the stored trace, including its ``id``.
* ``GET {PRISMTRACE_HOST}/api/setup-doctor?project_id=...`` reports ``live_connected`` / ``blocked_step``.
* ``POST {PRISMTRACE_HOST}/api/spans/ingest`` with ``{trace_id, project_id, session_id, spans[]}``. Evaluators read
  ``{context}`` from a trace's retrieval and tool steps, so the Knowledge Base search is sent as a ``tool`` span
  (the span vocabulary of the official prismtrace-sdk 0.5.3 records retrieval as ``tool``).

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


def transport_kwargs() -> dict:
    return {"transport": _transport} if _transport is not None else {}


def _client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT_S, **transport_kwargs())


def send_trace(*, session_id: str, model: str | None, input_messages: list[dict], output_message: str,
               latency_ms: int | None, metadata: dict, retrieval: dict | None = None) -> dict:
    """Send one trace. Returns {status, trace_id, error}; status is SENT, FAILED or NOT_CONFIGURED.

    ``retrieval`` ({query, context, sources, started_at, ended_at, latency_ms}) is attached to the stored trace as
    a span so evaluators see it as ``{context}``; the result then also carries ``context_span`` (SENT/FAILED).
    """
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
        data = resp.json()
    except ValueError:
        data = None
    # A 200 whose body is not a JSON object (e.g. ``[]``) still counts as sent, just without an id.
    trace_id = data.get("id") if isinstance(data, dict) else None
    result = {"status": "SENT", "trace_id": trace_id, "error": None,
              "send_ms": int((time.monotonic() - started) * 1000)}
    if retrieval is not None:
        result["context_span"] = _send_retrieval_span(cfg, trace_id, session_id, retrieval)
    return result


def _send_retrieval_span(cfg: dict, trace_id: str | None, session_id: str, retrieval: dict) -> str:
    if not trace_id:
        return "FAILED"
    span = {
        "span_id": f"{trace_id}-kb",
        "name": "knowledge_base_search",
        "span_type": "tool",
        "input_text": retrieval["query"],
        "output_text": retrieval["context"] or "No Knowledge Base snippets matched this request.",
        "start_time": retrieval["started_at"],
        "end_time": retrieval["ended_at"],
        "duration_ms": retrieval["latency_ms"] or 0,
        "status": "ok",
        "metadata": {"sources": retrieval["sources"], "agent_id": AGENT_ID},
    }
    try:
        with _client() as client:
            resp = client.post(f"{cfg['host']}/api/spans/ingest",
                               json={"trace_id": trace_id, "project_id": cfg["project_id"], "session_id": session_id,
                                     "spans": [span]},
                               headers={"X-PRISMtrace-Key": cfg["api_key"]})
    except httpx.HTTPError:
        return "FAILED"
    return "SENT" if resp.status_code in (200, 201, 202) else "FAILED"


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
