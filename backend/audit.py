"""Local append-only audit log (JSONL). Always on; PRISM is not integrated."""
from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("tradeagent.audit")
_lock = threading.Lock()
REPO_ROOT = Path(__file__).resolve().parent.parent


def audit_dir() -> Path:
    return Path(os.getenv("AUDIT_DIR", REPO_ROOT / "data" / "audit"))


def _append(path: Path, rows: list[dict]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with _lock, path.open("a", encoding="utf-8") as fh:
            for row in rows:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    except OSError as exc:  # audit write failure must be visible but not crash the demo
        log.error("audit write failed for %s: %s", path, exc)


def record(action: str, **fields) -> None:
    row = {"logged_at": datetime.now(timezone.utc).isoformat(), "action": action, **fields}
    _append(audit_dir() / "app_audit.jsonl", [row])


def record_simulation_events(simulation_id: str, events: list[dict]) -> None:
    path = audit_dir() / f"{simulation_id}.events.jsonl"
    try:
        if path.exists():
            path.unlink()  # same id = same deterministic replay; keep one copy
    except OSError:
        pass
    _append(path, events)
