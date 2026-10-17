# TradeAgent AI — 3-person team issues and copy-ready prompts
**Hard deadline: 5 hours.** The data contract is already frozen in `contracts/strategy.example.json` and `PRD.md` section 8. **Do not spend 30 minutes designing it again.** Spend 5 minutes reading it, then start parallel work. No new endpoints, field names or risk rules without notifying the team. Branches merge via PR; prefer working demo to extra features.

## Timeline
| Time | Owner A (UI) | Owner B (API/AI) | Owner C (engine/audit) |
|---|---|---|---|
| 0:00–0:05 | Read frozen contract | Read contract | Read contract |
| 0:05–2:30 | UI with typed mock adapter | FastAPI + preset fallback + approvals | deterministic engine + fixture + tests |
| 2:30–3:30 | Connect real API | Import C engine, smoke test | Fix risk and audit issues |
| 3:30–4:15 | Full UX and errors | Scenario + report consistency | PRISM only if verified/ready |
| 4:15–5:00 | Demo rehearsal + fixes | Demo rehearsal + fixes | Demo rehearsal + fixes |


## Shared acceptance / non-negotiables
- Local demo works without external AI or PRISM keys.
- The third otherwise-valid entry after two completed losses is BLOCKED and audited.
- AI generates proposed rules only; deterministic Python enforces trading.
- Simulated scenarios are not historical backtests. No invented win rate.
- `contracts/strategy.example.json` is canonical. Use only the API routes in PRD section 8.
- Demo NG tick assumptions, cutoff, no fees/slippage, and simulation-only label are visible.

## GitHub Issue A — Frontend (P0)
**Owner:** A. **Done when:** full no-code flow works, mock adapter can be replaced, blocked third order and audit visible.
```text
You are the frontend owner of TradeAgent AI. First read README.md, PRD.md section 8, and contracts/strategy.example.json. This is a 5-hour hackathon MVP. Use React + TypeScript + Tailwind, frontend port 5173, API base http://localhost:8000. Build a single-screen guided wizard + strategy approval + hypothetical scenario summary + paper trading dashboard. Exact flow: preset NG_SIM → generate via POST /api/strategies/generate → review rule card → approve via POST /api/strategies/approve → scenario via POST /api/scenarios/generate → start via POST /api/simulations/start with fixture two-loss-lock → GET /api/simulations/{id}, /events, /report. Implement a typed mock adapter using the SAME response shapes so UI works before backend integration; swap to fetch when backend ready. Display lock reason and BLOCK_ENTRY event, accuracy numerator/denominator, LOCAL_ONLY status. Show 4 ticks not 4 points; 1m disabled. Clear labels: hypothetical simulation, not historical backtest; demo only, no real trades. Add loading/error handling. Do not invent endpoint names. Deliver working frontend and README run command; prioritize functioning flow over styling.
```

## GitHub Issue B — API + AI (P0)
**Owner:** B. **Done when:** all routes work with preset fallback, approval gate works, and C engine is imported.
```text
You are the FastAPI/AI owner of TradeAgent AI. First read PRD.md section 8 and contracts/strategy.example.json. Do NOT redesign JSON field names or endpoints. Implement FastAPI port 8000 with CORS for localhost:5173. Provide GET /api/health; POST /api/strategies/generate; POST /api/strategies/approve; POST /api/scenarios/generate; POST /api/simulations/start; GET /api/simulations/{id}, /events, /report. Use Pydantic schema aligned EXACTLY to contract fixture. Generate via a reliable built-in preset fallback first, optional Nicrron adapter behind env vars only after docs verified. Unclear 'points' and contradictory free text must yield clarification_questions; never silently interpret as ticks. Store approved immutable versions; reject unapproved simulations. Scenario narrative must be labeled synthetic; numeric results only if returned by deterministic simulator. Integrate C's Python callable engine, no second HTTP service. Supply tests and curl smoke script. Work within 5 hours and prioritize fully functioning API over provider integration.
```

## GitHub Issue C — Simulation + audit (P0)
**Owner:** C. **Done when:** deterministic two-loss test passes, third entry blocked and event log accurate.
```text
You are the deterministic simulation/risk owner of TradeAgent AI. First read PRD.md sections 4, 8, 9 and contracts/strategy.example.json. Implement pure Python callable run_simulation(strategy, seed=42, fixture='two-loss-lock') returning exact simulation state/events/report shapes from PRD. No HTTP server; B owns FastAPI routes. Use seeded reproducible mock bars and transparent demo assumptions: NG_SIM tick_size .001 and demo tick_value_usd 10, 15m SMA20 rising, 5m pullback bullish confirmation, swing low minus 4 ticks, 2 contracts, 1.2R target exits one contract, remainder stop or cutoff, zero fees/slippage, 3 completed positions max, long-only, approved strategy required. Implement hard stop and session cutoff; after two consecutive completed losing positions block third otherwise-eligible opening attempt. Count loss only on full position closure; record rule_id, expected_action, actual_action, compliant, reason for every decision. Include deterministic two-loss-lock fixture even if natural signals cannot be guaranteed with random bars; fixture must exercise actual risk decision path, not fake a green success log. Include unit tests for two-loss lock, exits, unapproved, same seed. Provide local audit adapter; PRISM only if verified docs/key and time remains.
```

## Integration order
1. B confirms `/api/health` and generation/approval with A.
2. C sends B importable Python function + exact fixture output.
3. B wires simulator routes and shares one `simulation_id`.
4. A switches from typed mocks to backend fetch.
5. All run acceptance test and freeze at 4:15.
