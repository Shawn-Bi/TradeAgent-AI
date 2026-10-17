"""Settings: process environment first, then backend/.env, then repo-root .env.

``NICRRON_ENV_FILE`` (kept for compatibility) points at a single env file instead;
tests use it to make sure the real backend/.env is never read.
"""
from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
DEFAULT_ENV_FILES = (BACKEND_DIR / ".env", BACKEND_DIR.parent / ".env")


def env_files() -> tuple[Path, ...]:
    override = os.getenv("NICRRON_ENV_FILE")
    return (Path(override),) if override else DEFAULT_ENV_FILES


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError:
        return values
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip().removeprefix("export ").strip()
        val = val.strip()
        if val[:1] in ("'", '"') and val[-1:] == val[:1] and len(val) >= 2:
            val = val[1:-1]
        else:
            val = val.split(" #", 1)[0].strip()
        values[key] = val
    return values


def setting(name: str, default: str | None = None) -> str | None:
    val = os.getenv(name)
    if val:
        return val.strip()
    for path in env_files():
        val = read_env_file(path).get(name)
        if val:
            return val
    return default
