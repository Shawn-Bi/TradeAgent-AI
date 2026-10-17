"""Strategy generation, versioning and approval (in-memory, immutable versions)."""
from __future__ import annotations

import copy
import hashlib
import json
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from pydantic import ValidationError

from . import audit, nicrron_client, prism_client
from .errors import ApiError
from .schemas import GenerateRequest, StrategySpec

REPO_ROOT = Path(__file__).resolve().parent.parent
PRESET_PATH = REPO_ROOT / "contracts" / "strategy.example.json"
TEMPLATES = {"ng-long-pullback-v1": PRESET_PATH}
PROTECTED_KEYS = {"schema_version", "strategy_id", "version", "approval_status", "simulation_only",
                  "account_id", "instrument", "direction"}

_NEG = r"\b(?:no|not|never|don'?t|do not|avoid|without)\s+(?:\w+\s+){0,3}"
_AMBIGUITY_RULES = [
    # (pattern, negatable, kind, tags already-covered-by-Nicrron, message)
    (r"\bpoints?\b", False, "question", ("point",),
     "Your text mentions 'points'. NG_SIM stops are measured in ticks (1 tick = 0.001 price units). "
     "Restate the stop buffer in ticks (demo default: 4 ticks = 0.004)."),
    (r"\bshort(?:s|ing)?\b|\bsell short\b", True, "question", ("short",),
     "This MVP is LONG_ONLY. Remove the short-selling instruction or confirm long-only."),
    (r"\btrail(?:ing)?\b", True, "question", ("trail",),
     "Trailing stops are not supported: the remaining contract keeps the original stop until stop or "
     "cutoff. Confirm this is acceptable."),
    (r"\b(?:hold|keep|carry)\w*\s+(?:\w+\s+){0,3}overnight\b", True, "question", ("overnight",),
     "Overnight holding is not allowed (flat by the 16:00 demo cutoff). Confirm no overnight positions."),
    (r"\baverag\w*\s+down\b|\bpyramid\w*\b", True, "question", ("averag", "pyramid"),
     "Averaging down / pyramiding is not allowed (one position at a time). Confirm."),
    (r"\b1m\b|\b1[- ]?min(?:ute)?\b|\bone[- ]minute\b", False, "warning", (),
     "1-minute refinement is disabled in this MVP (display only, not an execution gate)."),
    (r"\bnews\b|\bchop\w*\b|\bsideways\b", False, "warning", (),
     "Chop/news filters are NOT_IMPLEMENTED in this MVP; pause manually around events."),
]
RISK_GUARDRAILS = [  # (path, label) where a larger value relaxes the customer-confirmed rule
    (("risk", "max_completed_trades_per_session"), "max completed trades"),
    (("risk", "consecutive_loss_lock"), "consecutive-loss lock"),
    (("quantity_contracts",), "contracts per position"),
    (("session", "cutoff_local"), "session cutoff"),
]
_MISSING = object()


def check_free_text(text: str, covered: list[str] | None = None) -> tuple[list[str], list[str]]:
    """Deterministic keyword checks run on every free-text input (with or without an LLM).

    ``covered``: questions Nicrron already raised; a keyword question on the same topic is skipped.
    """
    covered_low = " ".join(covered or []).lower()
    questions, warnings = [], []
    low = text.lower()
    for pattern, negatable, kind, tags, msg in _AMBIGUITY_RULES:
        hits = list(re.finditer(pattern, low))
        if negatable:
            hits = [m for m in hits if not re.search(_NEG + r"$", low[: m.start()])]
        if hits and not (kind == "question" and any(t in covered_low for t in tags)):
            (questions if kind == "question" else warnings).append(msg)
    return questions, warnings


def _paths(d: dict, prefix: tuple = ()) -> list[tuple]:
    out = []
    for k, v in d.items():
        if isinstance(v, dict) and v:
            out += _paths(v, prefix + (k,))
        else:
            out.append(prefix + (k,))
    return out


def _get_path(d, path: tuple):
    for k in path:
        if not isinstance(d, dict) or k not in d:
            return _MISSING
        d = d[k]
    return d


def _covers(over: dict, path: tuple) -> bool:
    """True if ``over`` sets ``path`` or one of its parents to a non-dict value."""
    d = over
    for k in path:
        if not isinstance(d, dict) or k not in d:
            return False
        d = d[k]
        if not isinstance(d, dict):
            return True
    return True


def _pop_path(d: dict, path: tuple):
    if not path:
        return _MISSING
    parent = _get_path(d, path[:-1])
    if not isinstance(parent, dict) or path[-1] not in parent:
        return _MISSING
    value = parent.pop(path[-1])
    for i in range(len(path) - 1, 0, -1):  # prune empty parents
        p = _get_path(d, path[:i - 1]) if i > 1 else d
        if isinstance(p, dict) and p.get(path[i - 1]) == {}:
            p.pop(path[i - 1])
    return value


def _deep_merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def _validation_error(exc: ValidationError) -> ApiError:
    err = exc.errors()[0]
    field = ".".join(str(p) for p in err["loc"]) or None
    code = "MISSING_STOP" if field and field.split(".")[0] == "stop" and err["type"] in (
        "missing", "model_type", "dict_type") else "INVALID_STRATEGY"
    return ApiError(422, code, f"{field}: {err['msg']}" if field else err["msg"], field)


def _validate(spec: dict) -> dict:
    spec["approval_status"] = "DRAFT"
    try:
        StrategySpec.model_validate(spec)
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    return spec


def _drop_protected(base: dict, ai_over: dict) -> tuple[dict, list[str]]:
    """Nicrron may not touch protected fields; differing values become clarification questions."""
    over = copy.deepcopy(ai_over)
    questions = []
    for key in sorted(PROTECTED_KEYS & set(over)):
        value = over.pop(key)
        if value != base.get(key):
            questions.append(
                f"Nicrron mapped part of your text to '{key}' = {json.dumps(value)}, which this demo cannot change "
                f"(fixed value {json.dumps(base.get(key))}). It was NOT applied; remove that requirement or "
                "confirm the fixed value."
            )
    return over, questions


def _apply_ai_overrides(base: dict, ai_over: dict, explicit: dict) -> tuple[dict, dict, list[str]]:
    """Merge base <- Nicrron <- explicit overrides and validate.

    Every Nicrron value StrategySpec rejects is removed and turned into a clarification question
    (so the version cannot be approved). Invalid explicit overrides still raise 422.
    """
    over = copy.deepcopy(ai_over)
    questions: list[str] = []
    for _ in range(30):
        merged = _deep_merge(_deep_merge(base, over), explicit)
        merged["approval_status"] = "DRAFT"
        try:
            StrategySpec.model_validate(merged)
            return merged, over, questions
        except ValidationError as exc:
            err = exc.errors()[0]
            loc = tuple(str(p) for p in err["loc"])
            explicit_leaf = _get_path(explicit, loc)
            if loc and explicit_leaf is not _MISSING and not isinstance(explicit_leaf, dict):
                raise _validation_error(exc) from exc
            removed = {}
            probes = [loc[:i] for i in range(len(loc), 0, -1)] if loc else [
                ("exit", "first_target_close_contracts"), ("quantity_contracts",)]
            for probe in probes:
                value = _pop_path(over, probe)
                if value is not _MISSING:
                    removed[".".join(probe)] = value
                    if loc:
                        break
            if not removed:
                raise _validation_error(exc) from exc
            what = ", ".join(f"{p} = {json.dumps(v)}" for p, v in removed.items())
            questions.append(f"Nicrron proposed {what}, which StrategySpec v1 rejects ({err['msg']}). It was NOT "
                             "applied; restate that requirement with a supported value.")
    raise ApiError(502, "NICRRON_INVALID_OUTPUT", "Nicrron output could not be reconciled with StrategySpec v1")


def _risk_loosening(base: dict, merged: dict) -> list[str]:
    out = []
    for path, label in RISK_GUARDRAILS:
        old, new = _get_path(base, path), _get_path(merged, path)
        if path[-1] == "cutoff_local":
            relaxed = datetime.strptime(new, "%H:%M").time() > datetime.strptime(old, "%H:%M").time()
        else:
            relaxed = new > old
        if relaxed:
            out.append(f"RISK_LOOSENED: {label} {old} -> {new} relaxes the customer-confirmed rule; "
                       "review before approving.")
    return out


def summarize(s: dict) -> str:
    tick = s["instrument"]["tick_size"]
    t, e, st, ex, r, sess = s["trend"], s["entry"], s["stop"], s["exit"], s["risk"], s["session"]
    qty = s["quantity_contracts"]
    remain = qty - ex["first_target_close_contracts"]
    return (
        f"{s['direction']} {s['instrument']['symbol']} (demo, simulation only). "
        f"IF {s['timeframes']['trend_minutes']}m close > SMA{t['period']} AND SMA{t['period']} rising over "
        f"{t['slope_bars']} bars AND the latest {s['timeframes']['entry_minutes']}m bar low is within "
        f"{e['tolerance_ticks']} ticks of SMA{e['ma_period']} AND close > open AND close > SMA{e['ma_period']} "
        f"THEN paper-buy {qty} contracts at the next 1m open. "
        f"Stop: {st['buffer_ticks']} ticks ({st['buffer_ticks'] * tick:.3f}) below the lowest low of the last "
        f"{st['lookback_5m_bars']} completed 5m bars. Target: {ex['target_r']}R, close "
        f"{ex['first_target_close_contracts']} contract(s); remaining {remain} exit at the original stop or the "
        f"{sess['cutoff_local']} {sess['timezone']} demo cutoff. Max {r['max_completed_trades_per_session']} "
        f"completed trades; lock new entries after {r['consecutive_loss_lock']} consecutive losing positions. "
        f"Tick {tick} = ${s['instrument']['tick_value_usd']:.0f}/contract (demo assumption). "
        "Zero fees/slippage. 1m refinement disabled. Synthetic data only, not a historical backtest."
    )


class StrategyStore:
    def __init__(self):
        self._lock = threading.Lock()
        self._records: dict[tuple[str, int], dict] = {}

    def reset(self) -> None:
        with self._lock:
            self._records.clear()

    def get(self, strategy_id: str, version: int) -> dict:
        rec = self._records.get((strategy_id, version))
        if rec is None:
            raise ApiError(404, "STRATEGY_NOT_FOUND", f"Strategy {strategy_id} v{version} not found "
                           "(the in-memory store resets when the server restarts)", "version")
        return copy.deepcopy(rec)

    # ---- generate ---------------------------------------------------------
    def generate(self, req: GenerateRequest) -> dict:
        path = TEMPLATES.get(req.template_id)
        if path is None:
            raise ApiError(400, "UNKNOWN_TEMPLATE", f"Unknown template_id '{req.template_id}'", "template_id")
        base = json.loads(path.read_text(encoding="utf-8"))

        bad = sorted(PROTECTED_KEYS & set(req.overrides))
        if bad:
            raise ApiError(400, "OVERRIDE_NOT_ALLOWED", f"Cannot override protected field(s): {', '.join(bad)}",
                           f"overrides.{bad[0]}")

        explicit = req.overrides
        _validate(_deep_merge(base, explicit))  # explicit UI overrides must be valid on their own (422)

        questions: list[str] = []
        warnings: list[str] = []
        unsupported: list[str] = []
        ai_overrides: dict = {}
        raw_content = None
        generator = "PRESET_FALLBACK"
        meta = {"status": "NOT_REQUESTED", "model_requested": None, "model_used": None, "cached": False,
                "latency_ms": None, "error_code": None, "error_message": None, "http_status": None,
                "retry_after": None}
        text = req.free_text.strip()
        session_id = req.session_id or f"draft-{uuid.uuid4().hex[:12]}"
        trace_error = None
        if text:
            meta["model_requested"] = nicrron_client.config()["model"]
            try:
                ai = nicrron_client.translate(text, base)
            except nicrron_client.NicrronError as exc:
                trace_error = exc
                meta.update(status="NOT_CONFIGURED" if exc.code == "NICRRON_NOT_CONFIGURED" else "FAILED",
                            error_code=exc.code, error_message=exc.message, http_status=exc.http_status,
                            retry_after=exc.retry_after)
                questions.append(
                    f"Nicrron did not interpret your text ({exc.code}: {exc.message}). The strategy shown is the "
                    "unmodified demo preset" + (" plus your explicit overrides" if explicit else "")
                    + ", NOT your written requirements. Retry, or clear the free text to use the demo preset."
                )
                warnings.append("DEMO PRESET FALLBACK: this proposal was not generated by Nicrron.")
            else:
                generator = "NICRRON"
                meta.update(status="SUCCESS", **ai["meta"])
                raw_content = ai["raw_content"]
                ai_overrides, q = _drop_protected(base, ai["overrides"])
                questions += ai["clarification_questions"] + q
                unsupported = ai["unsupported_requirements"]
                questions += [f"Not supported in this MVP: \"{u}\". It was NOT applied; remove it from your rules "
                              "or confirm you accept the strategy without it." for u in unsupported]
                warnings += [f"Nicrron: {n}" for n in ai["interpretation_notes"]]
            q, w = check_free_text(text, covered=questions)
            questions += [x for x in q if x not in questions]
            warnings += w

        merged, ai_overrides, q = _apply_ai_overrides(base, ai_overrides, explicit)
        questions += q
        interpreted = [".".join(p) for p in _paths(ai_overrides) if not _covers(explicit, p)]
        warnings += _risk_loosening(base, merged)
        if generator == "NICRRON" and not interpreted and not questions:
            warnings.append("Nicrron recognised no strategy parameters in your text; every value is a demo default.")

        with self._lock:
            rec = self._store(merged, questions, warnings, generator)
        prism = {"status": "NOT_REQUESTED", "trace_id": None, "error": None}
        if text:  # one trace per model call; the preset path makes no model call
            prism = prism_client.send_trace(
                session_id=session_id,
                model=meta["model_used"] or meta["model_requested"],
                input_messages=nicrron_client.build_messages(text, base),
                output_message=raw_content if raw_content is not None
                else f"[NICRRON ERROR {trace_error.code}] {trace_error.message}",
                latency_ms=meta["latency_ms"],
                metadata={
                    "app": "tradeagent-ai", "prompt_version": nicrron_client.PROMPT_VERSION,
                    "strategy_id": rec["spec"]["strategy_id"], "strategy_version": rec["spec"]["version"],
                    "generator": generator, "nicrron_status": meta["status"], "nicrron_error": meta["error_code"],
                    "cached": meta["cached"], "interpreted_fields": sorted(interpreted),
                    "clarification_questions": len(rec["clarification_questions"]),
                    "unsupported_requirements": len(unsupported),
                    "approvable": not rec["clarification_questions"],
                },
            )
            with self._lock:
                stored = self._records[(rec["spec"]["strategy_id"], rec["spec"]["version"])]
                if prism["status"] == "SENT" or "prism" not in stored:
                    stored["prism"] = {**prism, "session_id": session_id}
        prism = {**prism, "session_id": session_id, "agent_id": prism_client.AGENT_ID}
        audit.record("STRATEGY_GENERATED", strategy_id=rec["spec"]["strategy_id"], version=rec["spec"]["version"],
                     generator=generator, nicrron_status=meta["status"], nicrron_error=meta["error_code"],
                     model_used=meta["model_used"], interpreted_fields=interpreted,
                     clarification_questions=len(rec["clarification_questions"]), free_text=text or None,
                     nicrron_raw_output=raw_content, prism_status=prism["status"], prism_trace_id=prism["trace_id"],
                     prism_error=prism["error"], session_id=session_id)
        return {**self._response(rec), "warnings": warnings, "nicrron": meta,
                "interpreted_fields": sorted(interpreted), "unsupported_requirements": unsupported,
                "prism": prism}

    def _store(self, spec: dict, questions, warnings, generator) -> dict:
        sid = spec["strategy_id"]
        content = {k: v for k, v in spec.items() if k not in ("version", "approval_status")}
        digest = hashlib.sha256(json.dumps([content, questions, generator], sort_keys=True).encode()).hexdigest()
        for (rid, _), rec in sorted(self._records.items()):
            if rid == sid and rec["hash"] == digest:
                return copy.deepcopy(rec)  # identical proposal -> same immutable version
        version = max((v for (rid, v) in self._records if rid == sid), default=0) + 1
        spec = {**spec, "version": version}
        rec = {
            "spec": spec,
            "clarification_questions": list(questions),
            "warnings": list(warnings),
            "generator": generator,
            "summary": summarize(spec),
            "hash": digest,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "approved_at": None,
        }
        self._records[(sid, version)] = rec
        return copy.deepcopy(rec)

    @staticmethod
    def _response(rec: dict) -> dict:
        return {
            "strategy": rec["spec"],
            "clarification_questions": rec["clarification_questions"],
            "warnings": rec["warnings"],
            "strategy_summary": rec["summary"],
            # additive
            "generator": rec["generator"],
            "approvable": not rec["clarification_questions"],
        }

    # ---- approve ----------------------------------------------------------
    def approve(self, strategy_id: str, version: int) -> dict:
        with self._lock:
            rec = self._records.get((strategy_id, version))
            if rec is None:
                raise ApiError(404, "STRATEGY_NOT_FOUND", f"Strategy {strategy_id} v{version} not found", "version")
            if rec["clarification_questions"]:
                raise ApiError(409, "CLARIFICATION_REQUIRED",
                               "Resolve clarification questions by generating a new version first",
                               "clarification_questions")
            try:
                StrategySpec.model_validate(rec["spec"])
            except ValidationError as exc:
                raise _validation_error(exc) from exc
            if rec["spec"]["approval_status"] != "APPROVED":
                rec["spec"]["approval_status"] = "APPROVED"
                rec["approved_at"] = datetime.now(timezone.utc).isoformat()
                audit.record("STRATEGY_APPROVED", strategy_id=strategy_id, version=version)
            return {"strategy_id": strategy_id, "version": version, "approval_status": "APPROVED",
                    "approved_at": rec["approved_at"]}

    def prism_trace(self, strategy_id: str, version: int) -> dict | None:
        """The PRISM trace of the model call that wrote this version, if PRISM accepted one."""
        rec = self._records.get((strategy_id, version)) or {}
        prism = rec.get("prism")
        return copy.deepcopy(prism) if prism and prism["status"] == "SENT" else None

    def approved_spec(self, strategy_id: str, version: int) -> dict:
        rec = self.get(strategy_id, version)
        if rec["spec"]["approval_status"] != "APPROVED":
            raise ApiError(409, "STRATEGY_NOT_APPROVED",
                           f"Strategy {strategy_id} v{version} is {rec['spec']['approval_status']}; "
                           "approve it before running", "version")
        return rec["spec"]


strategies = StrategyStore()
