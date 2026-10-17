# Knowledge Base sources for the strategy translator

These four files are in the PRISM Knowledge Base, assigned to agent `tradeagent-strategy-translator` (uploaded
2026-10-17 through the API, the same as uploading them in the Knowledge Base page). After editing one, delete the old
copy in PRISM and upload the new one, so retrieval never mixes versions:

| File | What the agent looks up |
|---|---|
| `STRATEGYSPEC_FIELD_GUIDE.md` | Each editable field, its unit, limits and default (mirrors `backend/schemas.py` and `EDITABLE_FIELDS`) |
| `NG_SIM_UNITS.md` | 1 tick = 0.001 = $10; points, pips, cents, dollars and percent are not ticks |
| `UNSUPPORTED_REQUESTS.md` | Shorts, trailing stops, time-of-day filters, EMA, averaging down and the rest |
| `CUSTOMER_CONFIRMED_RULES.md` | The first customer's confirmed rules and the demo defaults |

PRISM search is literal keyword overlap, not semantic search, so the files repeat the words traders actually use
("points", "pips", "take half off", "trailing"). Keep that in mind when editing them.

With prompt `v2` the backend searches these before every Nicrron call (see `backend/API.md`, *Knowledge Base
retrieval*). `EVALUATOR.md` is the evaluator rubric; do not upload it.
