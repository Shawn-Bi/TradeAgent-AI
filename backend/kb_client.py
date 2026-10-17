"""PRISM (Block Convey) Knowledge Base retrieval for the strategy translator.

Verified against https://blockconvey.com/docs and a live call (2026-10-17):
* ``POST https://api.prism.blockconvey.com/api/knowledge-base/search`` with header ``X-PRISMtrace-Key``
  and body ``{project_id, agent_id, query, limit}``; with ``agent_id`` only that agent's documents are searched.
* The response is ``{"results": [{"doc_name", "content", "relevance_score", "chunk_index", "doc_id", ...}],
  "method": "keyword_overlap", ...}``. Scores are literal word overlap, not semantic search.

The source documents live in ``docs/kb/`` and are uploaded in PRISM and assigned to the agent.
Retrieval never blocks drafting: any problem returns ``FAILED`` and the prompt simply has no KB context.
"""
from __future__ import annotations

import time

import httpx

from . import prism_client
from .config import setting as _setting
from .nicrron_client import _redact

DEFAULT_HOST = "https://api.prism.blockconvey.com"
LIMIT = 3
MAX_QUERY_CHARS = 1000
MAX_SNIPPET_CHARS = 2500


def search(query: str, *, limit: int = LIMIT) -> dict:
    """Return {status, sources, snippets, error, latency_ms}.

    status: USED (snippets found), NO_MATCH, FAILED or NOT_CONFIGURED.
    snippets: [{"source", "score", "text"}], best first; sources: their unique document names.
    """
    cfg = prism_client.config()
    out = {"status": "NOT_CONFIGURED", "sources": [], "snippets": [], "error": None, "latency_ms": None}
    if not (cfg["project_id"] and cfg["api_key"]):
        return out
    host = (_setting("PRISM_KB_HOST", DEFAULT_HOST) or DEFAULT_HOST).rstrip("/")
    body = {"project_id": cfg["project_id"], "agent_id": prism_client.AGENT_ID,
            "query": query[:MAX_QUERY_CHARS], "limit": limit}
    started = time.monotonic()
    try:
        # Same per-call limit as tracing (prism_client.timeout_s); a slow search falls back to no context.
        with httpx.Client(timeout=prism_client.timeout_s(), **prism_client.transport_kwargs()) as client:
            resp = client.post(f"{host}/api/knowledge-base/search", json=body,
                               headers={"X-PRISMtrace-Key": cfg["api_key"]})
        out["latency_ms"] = int((time.monotonic() - started) * 1000)
        if resp.status_code != 200:
            return {**out, "status": "FAILED",
                    "error": f"PRISM KB search returned HTTP {resp.status_code}: "
                             f"{_redact(resp.text, cfg['api_key'])[:300]}"}
        results = resp.json().get("results") or []
    except (httpx.HTTPError, ValueError, AttributeError) as exc:
        return {**out, "status": "FAILED", "error": f"PRISM KB search failed: {_redact(exc, cfg['api_key'])}"}
    snippets = []
    for r in results[:limit]:
        if not isinstance(r, dict) or not str(r.get("content") or "").strip():
            continue
        snippets.append({"source": str(r.get("doc_name") or r.get("doc_id") or "unknown"),
                         "score": r.get("relevance_score"),
                         "text": str(r["content"]).strip()[:MAX_SNIPPET_CHARS]})
    sources = list(dict.fromkeys(s["source"] for s in snippets))
    return {**out, "status": "USED" if snippets else "NO_MATCH", "sources": sources, "snippets": snippets}


def format_context(snippets: list[dict]) -> str:
    """Snippets as numbered, cited blocks; the same text goes into the prompt and the PRISM context span."""
    return "\n\n".join(f"[S{i}] source: {s['source']}\n{s['text']}" for i, s in enumerate(snippets, 1))
