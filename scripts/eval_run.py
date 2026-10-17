#!/usr/bin/env python3
"""Run the strategy-translator eval inputs through /api/strategies/generate and grade each result.

Every call is a real Nicrron call and a real PRISM trace (session ``eval-<version>-<tag>-<input id>``), so a v1
batch feeds PRISM Root Cause and a v2 batch on the same inputs feeds the v1 vs v2 evaluator.

By default the script starts its own backend (``uvicorn backend.main:app``) on a free port with
``PROMPT_VERSION`` set and ``NICRRON_MAX_CALLS_PER_HOUR`` raised for that process only. With ``--base-url`` it uses a
running backend instead and checks that the backend really used the requested prompt version.

    python scripts/eval_run.py --prompt-version v1                     # all inputs
    python scripts/eval_run.py --prompt-version v2 --ids clear-01,unit-01 --tag smoke
    python scripts/eval_run.py --compare tests/eval/results/v1-a.json tests/eval/results/v2-a.json

Grading (per input, see ``expect`` in tests/eval/inputs.jsonl):
  set             each path is an interpreted field with exactly this value
  set_or_clarify  either set to exactly this value, or left unset with a clarification question
  forbid          never an interpreted field (unit traps, approximated unsupported asks)
  allow           may be set, but only to this value
  (strict)        any other interpreted field is a value the trader never stated -> fail "invented"
  approvable      expected value of ``approvable`` (false = a clarification question must block approval)
  clarify_any     some clarification question mentions one of these words
  warn_any        some warning mentions one of these words (e.g. RISK_LOOSENED)
Infrastructure problems (spend cap, busy, network) are ``error``, not ``fail``. Invalid JSON from the model is a fail.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
INPUTS = ROOT / "tests" / "eval" / "inputs.jsonl"
RESULTS_DIR = ROOT / "tests" / "eval" / "results"
MODEL_FAILURES = {"NICRRON_INVALID_JSON", "NICRRON_INVALID_OUTPUT"}  # the agent's own fault, not infrastructure
_MISSING = object()


def load_inputs(path: Path = INPUTS) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def get_path(d, dotted: str):
    for k in dotted.split("."):
        if not isinstance(d, dict) or k not in d:
            return _MISSING
        d = d[k]
    return d


def _same(a, b) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) < 1e-9
    return a == b


def grade(expect: dict, body: dict) -> list[str]:
    """Failure reasons for one generate response (empty list = pass)."""
    reasons: list[str] = []
    nic = body.get("nicrron") or {}
    if body.get("generator") != "NICRRON":
        return [f"model_error:{nic.get('error_code')}"]
    interpreted = set(body.get("interpreted_fields") or [])
    strategy = body.get("strategy") or {}
    questions = [q.lower() for q in body.get("clarification_questions") or []]
    warnings = [w.lower() for w in body.get("warnings") or []]
    val = lambda p: get_path(strategy, p)  # noqa: E731

    for path, want in (expect.get("set") or {}).items():
        if path not in interpreted:
            reasons.append(f"missed:{path}")
        elif not _same(val(path), want):
            reasons.append(f"wrong:{path}={json.dumps(val(path))} (expected {json.dumps(want)})")
    for path, want in (expect.get("set_or_clarify") or {}).items():
        if path in interpreted:
            if not _same(val(path), want):
                reasons.append(f"wrong:{path}={json.dumps(val(path))} (expected {json.dumps(want)} or a question)")
        elif not questions:
            reasons.append(f"missed:{path} (neither set nor asked)")
    for path in expect.get("forbid") or []:
        if path in interpreted:
            reasons.append(f"forbidden:{path}={json.dumps(val(path))}")
    for path, want in (expect.get("allow") or {}).items():
        if path in interpreted and not _same(val(path), want):
            reasons.append(f"wrong:{path}={json.dumps(val(path))} (only {json.dumps(want)} allowed)")
    known = set(expect.get("set") or {}) | set(expect.get("set_or_clarify") or {}) | set(expect.get("allow") or {}) \
        | set(expect.get("forbid") or [])
    for path in sorted(interpreted - known):
        reasons.append(f"invented:{path}={json.dumps(val(path))}")

    if "approvable" in expect and body.get("approvable") is not expect["approvable"]:
        reasons.append("not_asked" if expect["approvable"] is False else "over_asked")
    kws = expect.get("clarify_any")
    if kws and not any(k.lower() in q for q in questions for k in kws):
        reasons.append(f"question_missing_topic:{'/'.join(kws)}")
    kws = expect.get("warn_any")
    if kws and not any(k.lower() in w for w in warnings for k in kws):
        reasons.append(f"warning_missing:{'/'.join(kws)}")
    return reasons


# ---- backend ----------------------------------------------------------------

def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_backend(prompt_version: str, max_calls: int) -> tuple[subprocess.Popen, str]:
    port = _free_port()
    env = {**os.environ, "PROMPT_VERSION": prompt_version, "NICRRON_MAX_CALLS_PER_HOUR": str(max_calls)}
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1",
                             "--port", str(port), "--log-level", "warning"], cwd=ROOT, env=env)
    base = f"http://127.0.0.1:{port}"
    for _ in range(60):
        try:
            if httpx.get(f"{base}/api/health", timeout=2).status_code == 200:
                return proc, base
        except httpx.HTTPError:
            pass
        if proc.poll() is not None:
            break
        time.sleep(0.5)
    proc.terminate()
    sys.exit("backend did not start")


def call_generate(client: httpx.Client, base: str, text: str, session_id: str) -> dict:
    for attempt in range(3):
        r = client.post(f"{base}/api/strategies/generate", json={"free_text": text, "session_id": session_id})
        r.raise_for_status()
        body = r.json()
        if (body.get("nicrron") or {}).get("error_code") != "NICRRON_BUSY":
            return body
        time.sleep(3 * (attempt + 1))
    return body


def run_one(client, base, item, version, tag) -> dict:
    session_id = f"eval-{version}-{tag}-{item['id']}"
    started = time.monotonic()
    try:
        body = call_generate(client, base, item["text"], session_id)
    except httpx.HTTPError as exc:
        return {"id": item["id"], "category": item["category"], "outcome": "error", "reasons": [f"http:{exc}"]}
    nic = body.get("nicrron") or {}
    code = nic.get("error_code")
    if body.get("generator") != "NICRRON" and code not in MODEL_FAILURES:
        outcome, reasons = "error", [f"infra:{code}"]
    else:
        reasons = grade(item["expect"], body)
        outcome = "fail" if reasons else "pass"
    return {
        "id": item["id"], "category": item["category"], "text": item["text"], "outcome": outcome, "reasons": reasons,
        "prompt_version_used": nic.get("prompt_version"), "interpreted_fields": body.get("interpreted_fields"),
        "values": {p: get_path(body.get("strategy") or {}, p) for p in body.get("interpreted_fields") or []},
        "approvable": body.get("approvable"), "clarification_questions": body.get("clarification_questions"),
        "unsupported_requirements": body.get("unsupported_requirements"),
        "warnings": [w for w in body.get("warnings") or [] if w.startswith(("Nicrron:", "RISK_LOOSENED"))],
        "kb_sources": (body.get("knowledge_base") or {}).get("sources_used"),
        "kb_status": (body.get("knowledge_base") or {}).get("status"),
        "model_used": nic.get("model_used"), "cached": nic.get("cached"), "latency_ms": nic.get("latency_ms"),
        "nicrron_error": code, "session_id": session_id, "prism_trace_id": (body.get("prism") or {}).get("trace_id"),
        "prism_status": (body.get("prism") or {}).get("status"), "wall_ms": int((time.monotonic() - started) * 1000),
    }


def summarize(results: list[dict]) -> dict:
    graded = [r for r in results if r["outcome"] != "error"]
    by_cat: dict[str, dict] = {}
    reasons: dict[str, int] = {}
    for r in results:
        c = by_cat.setdefault(r["category"], {"pass": 0, "fail": 0, "error": 0})
        c[r["outcome"]] += 1
        for reason in r["reasons"] if r["outcome"] == "fail" else []:
            key = reason.split("=")[0].split(" (")[0]  # e.g. forbidden:stop.buffer_ticks, not_asked
            reasons[key] = reasons.get(key, 0) + 1
    passed = sum(r["outcome"] == "pass" for r in results)
    return {"total": len(results), "passed": passed, "failed": sum(r["outcome"] == "fail" for r in results),
            "errors": len(results) - len(graded), "pass_rate": round(passed / len(graded), 3) if graded else None,
            "by_category": by_cat, "failure_reasons": dict(sorted(reasons.items(), key=lambda kv: -kv[1]))}


def compare(a_path: Path, b_path: Path) -> None:
    a, b = (json.loads(Path(p).read_text()) for p in (a_path, b_path))
    ra = {r["id"]: r for r in a["results"]}
    rb = {r["id"]: r for r in b["results"]}
    va, vb = a["run"]["prompt_version"], b["run"]["prompt_version"]
    print(f"{va}: {a['summary']['passed']}/{a['summary']['total']} pass   {vb}: {b['summary']['passed']}/"
          f"{b['summary']['total']} pass   (same inputs: {sorted(ra) == sorted(rb)})")
    for i in sorted(set(ra) & set(rb)):
        if ra[i]["outcome"] != rb[i]["outcome"]:
            print(f"  {i:10} {va}={ra[i]['outcome']:5} {vb}={rb[i]['outcome']:5}  {va} reasons: {ra[i]['reasons']}"
                  f"  {vb} reasons: {rb[i]['reasons']}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prompt-version", choices=("v1", "v2"))
    ap.add_argument("--inputs", type=Path, default=INPUTS)
    ap.add_argument("--ids", help="comma-separated input ids")
    ap.add_argument("--category")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--tag", default=datetime.now().strftime("%H%M%S"), help="groups this batch's PRISM sessions")
    ap.add_argument("--base-url", help="use a running backend instead of starting one")
    ap.add_argument("--max-calls", type=int, default=200, help="NICRRON_MAX_CALLS_PER_HOUR for the spawned backend")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--compare", nargs=2, type=Path, metavar=("A.json", "B.json"))
    args = ap.parse_args()
    if args.compare:
        return compare(*args.compare)
    if not args.prompt_version:
        ap.error("--prompt-version is required")

    items = load_inputs(args.inputs)
    if args.ids:
        wanted = args.ids.split(",")
        items = [i for i in items if i["id"] in wanted]
    if args.category:
        items = [i for i in items if i["category"] == args.category]
    items = items[: args.limit] if args.limit else items
    out = args.out or RESULTS_DIR / f"{args.prompt_version}-{args.tag}.json"

    proc = None
    base = args.base_url.rstrip("/") if args.base_url else None
    if not base:
        proc, base = start_backend(args.prompt_version, args.max_calls)
    from backend.config import setting  # same lookup as the backend: environment, then backend/.env
    token = setting("DEMO_ACCESS_TOKEN")
    headers = {"X-Demo-Token": token} if token else {}
    started_at = datetime.now(timezone.utc).isoformat()
    results: list[dict] = []
    try:
        with httpx.Client(timeout=120, headers=headers) as client:
            for n, item in enumerate(items, 1):
                r = run_one(client, base, item, args.prompt_version, args.tag)
                used = r.get("prompt_version_used")
                if used and used != args.prompt_version:
                    sys.exit(f"backend used prompt {used}, not {args.prompt_version}; set PROMPT_VERSION on that server")
                results.append(r)
                print(f"[{n}/{len(items)}] {r['id']:10} {r['outcome']:5} {'; '.join(r['reasons'])}", flush=True)
                if any(x.startswith("infra:NICRRON_BUDGET_EXCEEDED") for x in r["reasons"]):
                    print("spend cap reached; stopping", flush=True)
                    break
    finally:
        if proc:
            proc.terminate()
            proc.wait(timeout=10)
    report = {"run": {"prompt_version": args.prompt_version, "tag": args.tag, "started_at": started_at,
                      "finished_at": datetime.now(timezone.utc).isoformat(), "inputs": str(args.inputs.name),
                      "base_url": args.base_url or "spawned", "agent_id": "tradeagent-strategy-translator"},
              "summary": summarize(results), "results": results}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    s = report["summary"]
    print(f"\n{args.prompt_version}: {s['passed']} pass / {s['failed']} fail / {s['errors']} error "
          f"(pass rate {s['pass_rate']})  ->  {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}")
    print("failure reasons:", json.dumps(s["failure_reasons"]))


if __name__ == "__main__":
    main()
