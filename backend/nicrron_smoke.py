"""One real end-to-end Nicrron generation through the backend pipeline.

    .venv/Scripts/python.exe -m backend.nicrron_smoke ["customer rules text"]

Exits 2 without any network request when NICRRON_API_KEY is not configured.
Prints the generate response (never the key). Writes to the normal local audit log.
"""
from __future__ import annotations

import json
import sys

from . import nicrron_client
from .schemas import GenerateRequest
from .strategy_service import strategies

SAMPLE = ("Long only natural gas. Trade with the 15 minute trend above its 20 SMA, enter on a 5 minute "
          "pullback that holds the 20 SMA within 2 ticks. Stop 5 ticks below the swing low of the last 5 bars. "
          "Take half off at 1.5R and leave the rest at the original stop. Max 2 trades a day and stop after "
          "2 losses in a row. Flat by 15:30.")


def main() -> int:
    if not nicrron_client.get_api_key():
        print(f"NICRRON_API_KEY not configured; no request sent. {nicrron_client.KEY_HELP}")
        return 2
    text = sys.argv[1] if len(sys.argv) > 1 else SAMPLE
    print(f"Calling Nicrron model {nicrron_client.config()['model']} ...", flush=True)
    resp = strategies.generate(GenerateRequest(free_text=text))
    print(json.dumps(resp, indent=2))
    ok = resp["nicrron"]["status"] == "SUCCESS"
    print("\nRESULT:", "REAL_API_VERIFIED" if ok else f"FAILED ({resp['nicrron']['error_code']})")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
