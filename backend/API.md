# TradeAgent AI backend API (v1.0.0) — integration guide for teammate A

Base URL `http://localhost:8000` (`VITE_API_BASE_URL`). All JSON. Routes and field names are the frozen
ones from `docs/PRD.md` §8. Fields marked *additive* are extras the backend also returns; the frozen sample
fields are always present, so a typed mock written from PRD §8 keeps working.

**Simulation only:** synthetic MOCK candles, no broker, no real orders. `prism_status` is `CONNECTED` only when PRISM accepted the trace of the Nicrron call that wrote the simulated version (see *PRISM tracing* below); otherwise `LOCAL_ONLY`.

## Demo flow (exact call order)

| # | Call | Body | Use from response |
|---|---|---|---|
| 1 | `GET /api/health` | – | `ok` |
| 2 | `POST /api/strategies/generate` | `{"template_id":"ng-long-pullback-v1","overrides":{},"free_text":""}` | `strategy.strategy_id`, `strategy.version`, `clarification_questions`, `strategy_summary` |
| 3 | `POST /api/strategies/approve` | `{"strategy_id":"ng-demo-v1","version":1}` | `approval_status` = `APPROVED` |
| 4 | `POST /api/scenarios/generate` | `{"strategy_id":"ng-demo-v1","version":1,"seed":42}` | `scenarios[]` |
| 5 | `POST /api/simulations/start` | `{"strategy_id":"ng-demo-v1","version":1,"seed":42,"fixture":"two-loss-lock"}` | `simulation_id` |
| 6 | `GET /api/simulations/{simulation_id}` | – | account, trades, lock status |
| 7 | `GET /api/simulations/{simulation_id}/events` | – | audit table |
| 8 | `GET /api/simulations/{simulation_id}/report` | – | conformance numerator/denominator |

Always send the `version` returned by step 2 (do not hard-code `1`): an identical preset request
returns the same version, but any edit, any Nicrron result and any failed free-text attempt creates its own
version, so the preset is not guaranteed to be version 1.
State is in memory: after a backend restart, repeat steps 2–3.

## Remote access (public demo tunnel)

When B exposes the backend through a Cloudflare Quick Tunnel, the base URL is a temporary
`https://<random>.trycloudflare.com` (it changes every time the tunnel restarts) and a demo token is on:

- Send `X-Demo-Token: <token>` on **every** request except `GET /api/health`. B sends you the token
  privately; never commit it. Missing or wrong token → `401 {"error":{"code":"UNAUTHORIZED",
  "message":"Missing or invalid X-Demo-Token header","field":"X-Demo-Token"}}`.
- CORS allows exactly the origin `http://localhost:5173` (open the app at that URL, not `127.0.0.1:5173`)
  and only the request headers `Content-Type` and `X-Demo-Token`.
- `/docs`, `/redoc` and `/openapi.json` return 404 while the token is on.
- Paid Nicrron calls are capped (default 20 per hour, 1 at a time). Over the cap, generate returns the
  labeled fallback with `nicrron.error_code` `NICRRON_BUDGET_EXCEEDED` (with `retry_after` seconds) or
  `NICRRON_BUSY`; nothing else changes.

Frontend setup (Vite), in A's local, git-ignored `.env.local`:
```bash
VITE_API_BASE_URL=https://<random>.trycloudflare.com
VITE_DEMO_TOKEN=<token from B>
```
and in the single fetch helper: `headers: {"Content-Type": "application/json", "X-Demo-Token": import.meta.env.VITE_DEMO_TOKEN}`.
With the token off (local development), the header is simply ignored.

## Errors (all routes)

```json
{"error": {"code": "STRATEGY_NOT_APPROVED", "message": "Strategy ng-demo-v1 v1 is DRAFT; approve it before running", "field": "version"}}
```

| HTTP | code | When |
|---|---|---|
| 400 | `UNKNOWN_TEMPLATE`, `OVERRIDE_NOT_ALLOWED`, `UNKNOWN_FIXTURE` | bad template / protected override / bad fixture |
| 401 | `UNAUTHORIZED` | demo token on and `X-Demo-Token` missing or wrong |
| 404 | `STRATEGY_NOT_FOUND`, `SIMULATION_NOT_FOUND`, `NOT_FOUND` | unknown id or route |
| 409 | `STRATEGY_NOT_APPROVED` | start/scenarios on a DRAFT version |
| 409 | `CLARIFICATION_REQUIRED` | approve a version that still has clarification questions |
| 422 | `INVALID_STRATEGY`, `MISSING_STOP`, `VALIDATION_ERROR` | override fails schema / request body invalid (`field` = dotted path, e.g. `exit.target_r`) |

## 1. `GET /api/health`
```json
{"ok": true, "contract_version": "1.0.0"}
```

## 2. `POST /api/strategies/generate`
Request (all fields optional): `template_id` (only `ng-long-pullback-v1`), `overrides` (partial StrategySpec,
deep-merged, e.g. `{"stop":{"buffer_ticks":5}}`), `free_text` (plain English).

Protected (400 if overridden): `schema_version, strategy_id, version, approval_status, simulation_only,
account_id, instrument, direction`.

With `free_text`, the backend calls Nicrron (`nicrron/auto`, OpenAI-compatible chat completions,
server-side key). **This can take several seconds (timeout 60 s)**, so show a loading state and do not
abort the fetch early. Nicrron only proposes a DRAFT; approval and the risk-gated engine are unchanged.

Response when Nicrron succeeded:
```json
{
  "strategy": { "...exact contracts/strategy.example.json shape...": "", "version": 3, "approval_status": "DRAFT",
                "stop": {"type": "SWING_LOW_BUFFER", "lookback_5m_bars": 5, "buffer_ticks": 5},
                "exit": {"target_r": 1.5, "first_target_close_contracts": 1, "remaining_contracts_exit": "STOP_OR_SESSION_CUTOFF"} },
  "clarification_questions": [],
  "warnings": ["Nicrron: 'Stop 5 ticks below' -> stop.buffer_ticks=5"],
  "strategy_summary": "LONG_ONLY NG_SIM (demo, simulation only). IF 15m close > SMA20 AND ... Stop: 5 ticks (0.005) below ...",
  "generator": "NICRRON",
  "approvable": true,
  "nicrron": {"status": "SUCCESS", "model_requested": "nicrron/auto", "model_used": "anthropic/claude-sonnet-5-5",
              "cached": false, "latency_ms": 2140, "error_code": null, "error_message": null,
              "http_status": null, "retry_after": null},
  "interpreted_fields": ["exit.target_r", "stop.buffer_ticks"],
  "unsupported_requirements": []
}
```
All fields after `strategy_summary` are *additive*:

| Field | Meaning / how to display |
|---|---|
| `generator` | `NICRRON` = proposal produced by Nicrron. `PRESET_FALLBACK` = built-in demo preset (no free text, or Nicrron failed). Never label a `PRESET_FALLBACK` result as AI-generated. |
| `approvable` | `false` while `clarification_questions` is non-empty: disable Approve (the server returns 409 anyway). |
| `nicrron.status` | `SUCCESS`, `FAILED`, `NOT_CONFIGURED` (no key on the server) or `NOT_REQUESTED` (no free text). |
| `nicrron.error_code` / `error_message` | Show on failure. Codes: `NICRRON_NOT_CONFIGURED`, `NICRRON_AUTH_FAILED`, `NICRRON_RATE_LIMITED` (+ `retry_after` seconds), `NICRRON_TIMEOUT`, `NICRRON_CONNECTION_ERROR`, `NICRRON_MODEL_UNAVAILABLE`, `NICRRON_BAD_REQUEST`, `NICRRON_UPSTREAM_ERROR`, `NICRRON_HTTP_ERROR`, `NICRRON_INVALID_JSON`, `NICRRON_INVALID_OUTPUT`, `NICRRON_BUDGET_EXCEEDED` (demo spend cap, + `retry_after`), `NICRRON_BUSY` (another generation in flight). |
| `interpreted_fields` | Dotted paths whose values came from the customer's text; all other values are demo defaults. Highlight these in the rule card. |
| `unsupported_requirements` | Customer instructions StrategySpec v1 cannot express (e.g. trailing stop). Each one also appears as a clarification question. |
| `warnings` | `Nicrron: ...` interpretation notes, `RISK_LOOSENED: ...` (a looser max-trades / loss-lock / contracts / cutoff than the customer-confirmed preset), feature notes. |

**Nicrron failure** still returns HTTP 200: `generator: "PRESET_FALLBACK"`, `nicrron.status` `FAILED` or
`NOT_CONFIGURED`, the unmodified preset in `strategy`, and a first clarification question that starts
"Nicrron did not interpret your text (...)". It is **not approvable**, so the demo preset can never stand in
for the customer's written rules. To run the demo preset, generate again with empty `free_text`.

**Safety rules applied to Nicrron output:** values StrategySpec v1 rejects (e.g. `trend.ma_type: "EMA"`, unknown
keys, `stop_required: false`), attempts to change protected fields (`direction`, `instrument`, …) and unsupported
instructions are **not applied**. Each one becomes a clarification question, so that version cannot be approved.
Explicit `overrides` from the UI win over Nicrron values. Deterministic keyword checks always run on the text too:
`points` → clarification (must use ticks); shorting / trailing stop / overnight hold / averaging down →
clarification ("no shorts" style negations are fine); 1m / news / chop → warning.

## 3. `POST /api/strategies/approve`
```json
{"strategy_id": "ng-demo-v1", "version": 1, "approval_status": "APPROVED", "approved_at": "2026-10-17T16:23:23Z"}
```
Idempotent. Approved versions are immutable.

## 4. `POST /api/scenarios/generate` (requires APPROVED)
```json
{
  "synthetic": true, "method": "RULE_BASED_SYNTHETIC_REPLAY", "seed": 42,
  "scenarios": [
    {"name": "trend", "assumptions": ["synthetic candles: ...", "Fills at trigger price; fees and slippage assumed zero", "..."],
     "narrative": "Synthetic uptrend ... Hypothetical illustration only, not a historical backtest or a forecast.",
     "computed_pnl_usd": 1430.0, "completed_trades": 1, "entries": 1, "blocked_entries": 1,
     "entry_locked": false, "lock_reason": null}
  ],
  "disclaimer": "Hypothetical synthetic scenarios, not historical backtests; no win rate is implied."
}
```
Scenarios: `trend`, `range`, `adverse`. `computed_pnl_usd` is computed by the engine on seeded synthetic
candles — label it "hypothetical", never "backtest" or "expected return".

## 5. `POST /api/simulations/start` (requires APPROVED; synchronous)
Request: `strategy_id`, `version`, `seed` (default 42), `fixture` (default `standard`).
```json
{"simulation_id": "sim-42-two-loss-lock-v1", "status": "COMPLETED", "seed": 42,
 "fixture": "two-loss-lock", "strategy_id": "ng-demo-v1", "version": 1}
```
`simulation_id` is deterministic (`sim-{seed}-{fixture}-v{version}`); rerunning replaces it with an identical result.

| fixture | What it shows |
|---|---|
| `two-loss-lock` | **Main demo**: P1 loss, P2 loss → lock → third otherwise-valid entry `BLOCK_ENTRY` |
| `winning-reset` | loss, win (1.2R partial + stop), loss → streak reset; 4th candidate blocked `MAX_TRADES` |
| `cutoff` | late entry flattened at 16:00 demo cutoff |
| `ambiguous-bar` | stop and target in one 1m bar → stop-first, logged `AMBIGUOUS_BAR_STOP_FIRST` |
| `trend-fail` | downtrend: every bar `NO_TRADE_TREND`, zero orders |
| `standard`, `trend`, `range`, `adverse` | seeded random walks (seed changes candles) |

Crafted fixtures ignore the seed (`seed_affects_candles: false`).

## 6. `GET /api/simulations/{simulation_id}`
```json
{
  "simulation_id": "sim-42-two-loss-lock-v1", "status": "COMPLETED", "account_id": "DEMO-NG-001",
  "equity_usd": 99480.0, "positions": [],
  "completed_trades": [
    {"position_id": "P1", "status": "CLOSED", "signal_bar_id": "5m-2026-10-17T10:20:00-04:00",
     "entry_time": "2026-10-17T10:25:00-04:00", "entry_price": 3.336, "stop_price": 3.323, "target_price": 3.352,
     "initial_risk_ticks": 13, "quantity_contracts": 2, "open_contracts": 0,
     "legs": [{"exit_time": "2026-10-17T10:30:00-04:00", "contracts": 2, "exit_price": 3.323,
               "exit_reason": "STOP_HIT", "pnl_usd": -260.0}],
     "realized_pnl_usd": -260.0, "result": "LOSS"}
  ],
  "consecutive_losses": 2, "entry_locked": true, "lock_reason": "TWO_CONSECUTIVE_LOSSES", "prism_status": "LOCAL_ONLY",
  "strategy_id": "ng-demo-v1", "version": 1, "seed": 42, "fixture": "two-loss-lock",
  "fixture_description": "Crafted path: two losing positions, then a third otherwise-eligible entry",
  "seed_affects_candles": false, "synthetic": true, "data_source": "MOCK", "session_status": "SESSION_CLOSED",
  "starting_equity_usd": 100000.0, "realized_pnl_usd": -520.0, "completed_trade_count": 2, "blocked_entry_count": 1,
  "candle_count": 720,
  "fills": [{"fill_id": "fill-1", "timestamp": "2026-10-17T10:25:00-04:00", "position_id": "P1", "side": "BUY",
             "contracts": 2, "price": 3.336, "action": "OPEN_LONG", "decision_ref": "evt-13"}],
  "assumptions": ["Synthetic MOCK candles generated in code; not historical market data", "..."]
}
```
Everything after `prism_status` is *additive*. `lock_reason`: `TWO_CONSECUTIVE_LOSSES`, `MAX_TRADES` or `null`.
`fills` is the paper ledger. `legs[].exit_reason`: `TARGET_PARTIAL_EXIT`, `STOP_HIT`, `AMBIGUOUS_BAR_STOP_FIRST`, `CUTOFF_EXIT`.
Account summary = `account_id`, `starting_equity_usd`, `equity_usd`, `realized_pnl_usd`; trade history = `completed_trades`.

## 7. `GET /api/simulations/{simulation_id}/events`
Ordered by `seq`. The BLOCK event to highlight in the demo:
```json
{"events": [
  {"event_id": "evt-43", "seq": 43, "timestamp": "2026-10-17T12:30:00-04:00", "rule_id": "RISK_TWO_LOSSES",
   "expected_action": "BLOCK_ENTRY", "actual_action": "BLOCK_ENTRY", "compliant": true,
   "reason": "Two completed losing trades: entries locked until next session (consecutive_losses=2)",
   "reason_code": "TWO_CONSECUTIVE_LOSSES", "category": "RISK_GATE", "eligible": true,
   "strategy_id": "ng-demo-v1", "version": 1, "signal_bar_id": "5m-2026-10-17T12:25:00-04:00",
   "trend_ok": true, "entry_ok": true, "candidate_action": "BUY_2",
   "risk_gate_result": "BLOCKED:TWO_CONSECUTIVE_LOSSES", "position_id": null, "session_locked": true,
   "price": 3.379, "pnl_usd": null, "data_source": "MOCK",
   "details": {"c15": 3.379, "sma15": 3.328, "sma15_prev": 3.3095, "bar5_open": 3.374, "bar5_low": 3.37,
               "bar5_close": 3.379, "sma5": 3.3714, "tolerance_ticks": 3}}
]}
```
First 8 fields are frozen; the rest are *additive*. Useful filters for the UI:

- `category`: `DATA`, `SIGNAL` (NO_TRADE evaluations, ~75 per session), `RISK_GATE` (BLOCK_ENTRY), `EXECUTION` (fills), `RISK` (position closed), `RISK_LOCK`, `SESSION`. Hiding `SIGNAL` leaves a short demo list.
- `expected_action` / `actual_action`: `WAIT`, `NO_TRADE`, `OPEN_LONG`, `BLOCK_ENTRY`, `EXIT_PARTIAL`, `EXIT_STOP`, `EXIT_CUTOFF`, `COUNT_LOSS`, `RESET_STREAK`, `LOCK_ENTRIES`, `CLOSE_SESSION`.
- `reason_code`: `WAIT_INSUFFICIENT_HISTORY`, `NO_TRADE_TREND`, `NO_TRADE_ENTRY`, `WAIT_NEXT_BAR`, `ENTRY_FILLED`, `BLOCKED_UNAPPROVED`, `TWO_CONSECUTIVE_LOSSES`, `SESSION_CUTOFF`, `POSITION_NOT_FLAT`, `MAX_TRADES`, `MISSING_STOP`, `INVALID_RISK`, `INSUFFICIENT_MARGIN`, `TARGET_PARTIAL_EXIT`, `STOP_HIT`, `AMBIGUOUS_BAR_STOP_FIRST`, `CUTOFF_EXIT`, `POSITION_CLOSED`, `SESSION_CLOSED`, `DATA_END_BEFORE_CUTOFF`.

`actual_action` is **not copied** from `expected_action`: after the run, the backend reconciles each
decision against the paper ledger (`fills`). For example, a BUY fill after `LOCK_ENTRIES` would set
`actual_action: "ENTRY_AFTER_LOCK"` and `compliant: false`.

## 8. `GET /api/simulations/{simulation_id}/report`
```json
{"simulation_id": "sim-42-two-loss-lock-v1", "synthetic": true, "eligible_decisions": 84, "compliant_decisions": 84,
 "execution_conformance": 1.0, "violations": 0, "disclaimer": "Synthetic demo, not historical backtest",
 "metric": "Rule-following accuracy = compliant / eligible decisions (not win rate)",
 "blocked_entries": 1, "completed_trades": 2, "realized_pnl_usd": -520.0, "data_source": "MOCK", "prism_status": "LOCAL_ONLY"}
```
Show `compliant_decisions / eligible_decisions`. `execution_conformance` is `null` when there are no eligible
decisions: render "N/A".

## PRISM tracing

Configured with `PRISMTRACE_HOST`, `PRISMTRACE_PROJECT_ID` and `PRISMTRACE_API_KEY` in `backend/.env`. Each Nicrron call
in `/api/strategies/generate` (successful or failed) is sent as one trace to `POST {host}/api/traces` with
`agent_id: "tradeagent-strategy-translator"`, the prompt and trader text as `input_messages`, Nicrron's raw JSON (or
`[NICRRON ERROR <code>] ...`) as `output_message`, and metadata (`prompt_version`, `strategy_version`, `generator`,
`interpreted_fields`, clarification count, `approvable`). The preset path makes no model call and sends nothing.
Tracing never blocks: a PRISM error is reported and the request still succeeds. Each PRISM call (KB search, trace, span) times out after `PRISM_TIMEOUT_SECONDS` (default 5, allowed 0.5–30; invalid values use 5).

- `generate` request, *additive*: optional `session_id` (`[A-Za-z0-9._:-]`, max 128). Send the same value for every draft
  of one conversation; without it each call gets its own `draft-…` session.
- `generate` response, *additive*: `"prism": {"status": "SENT" | "FAILED" | "NOT_CONFIGURED" | "NOT_REQUESTED",
  "trace_id", "error", "session_id", "agent_id"}`. Reuse the returned `session_id` for follow-up drafts.
- simulation state, *additive*: `prism_trace_id`, `prism_session_id`, `prism_scope: "STRATEGY_GENERATION"`. Engine
  decisions stay in the local audit; they are deterministic, not agent output.

## Knowledge Base retrieval and prompt versions

`PROMPT_VERSION` in `backend/.env` (or the environment) picks the translator prompt; it is re-read on every request.

- `v2` (default): before the Nicrron call the backend runs `POST https://api.prism.blockconvey.com/api/knowledge-base/search`
  with `{project_id, agent_id: "tradeagent-strategy-translator", query: <free_text>, limit: 3}`. The snippets go into the
  system prompt as cited context (`[S1] source: NG_SIM_UNITS.md ...`), together with an explicit unit table and
  "never invent a value; ask". The search is also attached to the PRISM trace as a `knowledge_base_search` span so
  evaluators see it as `{context}`, next to an `llm` span and a root span that carry the reply as `{output}` (`prism.context_span`: `SENT` / `FAILED`). The sources are `docs/kb/*.md`, uploaded
  in PRISM and assigned to the agent.
- `v1`: the original prompt, no retrieval. Kept as the baseline for the v1 vs v2 evaluation.

A failed or empty search never blocks drafting: Nicrron is called without context.

- `generate` response, *additive*: `nicrron.prompt_version` (`v1`/`v2`, `null` without free text) and
  ```json
  "knowledge_base": {"status": "USED", "sources_used": ["NG_SIM_UNITS.md", "STRATEGYSPEC_FIELD_GUIDE.md"], "error": null,
                     "snippets": [{"source": "NG_SIM_UNITS.md", "score": 0.07, "excerpt": "# NG_SIM units: ticks, not points ..."}]}
  ```
  `status`: `USED`, `NO_MATCH`, `FAILED` (see `error`), `NOT_CONFIGURED` (no PRISM credentials) or `NOT_REQUESTED`
  (no free text, or prompt `v1`). Show `sources_used` as "Sources used" on the Generate step.
- trace metadata, *additive*: `kb_status`, `kb_sources`.

## Aliases
`POST /api/strategy/generate` and `POST /api/strategy/approve` are aliases of the canonical routes
(docs/FIRST_CUSTOMER_STRATEGY.md §F naming). Use the canonical `/api/strategies/...` routes in the frontend.
