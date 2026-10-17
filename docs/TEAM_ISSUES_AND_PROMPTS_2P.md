# TradeAgent AI — 2-person team issues and copy-ready prompts
**Hard deadline: 5 hours.** The data contract is already frozen in `contracts/strategy.example.json` and `PRD.md` section 8. **Do not spend 30 minutes designing it again.** Spend 5 minutes reading it, then start parallel work. No new endpoints, field names or risk rules without notifying the team. Branches merge via PR; prefer working demo to extra features.

## Timeline
| Time | Owner A (frontend) | Owner B (backend + engine) |
|---|---|---|
| 0:00–0:05 | Read contract | Read contract |
| 0:05–2:45 | Wizard/dashboard with typed mocks | FastAPI + preset + deterministic two-loss fixture |
| 2:45–3:45 | Connect API | Complete endpoints + audit smoke test |
| 3:45–4:15 | UX fixes | Risk and integration fixes |
| 4:15–5:00 | Rehearse demo | Rehearse demo |


## Shared acceptance / non-negotiables
- Local demo works without external AI or PRISM keys.
- The third otherwise-valid entry after two completed losses is BLOCKED and audited.
- AI generates proposed rules only; deterministic Python enforces trading.
- Simulated scenarios are not historical backtests. No invented win rate.
- `contracts/strategy.example.json` is canonical. Use only the API routes in PRD section 8.
- Demo NG tick assumptions, cutoff, no fees/slippage, and simulation-only label are visible.

## GitHub Issue A — Frontend (P0)
**Owner:** A. **Done when:** full wizard → approval → simulation → audit flow works.
```text
You are the frontend owner of TradeAgent AI. First read README.md, PRD.md section 8, and contracts/strategy.example.json. This is a 5-hour hackathon MVP. Use React + TypeScript + Tailwind, frontend port 5173, API base http://localhost:8000. Build a single-screen guided wizard + strategy approval + hypothetical scenario summary + paper trading dashboard. Exact flow: preset NG_SIM → generate via POST /api/strategies/generate → review rule card → approve via POST /api/strategies/approve → scenario via POST /api/scenarios/generate → start via POST /api/simulations/start with fixture two-loss-lock → GET /api/simulations/{id}, /events, /report. Implement a typed mock adapter using the SAME response shapes so UI works before backend integration; swap to fetch when backend ready. Display lock reason and BLOCK_ENTRY event, accuracy numerator/denominator, LOCAL_ONLY status. Show 4 ticks not 4 points; 1m disabled. Clear labels: hypothetical simulation, not historical backtest; demo only, no real trades. Add loading/error handling. Do not invent endpoint names. Deliver working frontend and README run command; prioritize functioning flow over styling.
```

## GitHub Issue B — Backend + deterministic engine (P0)
**Owner:** B. **Done when:** all routes, preset fallback, approval, 2-loss fixture and audit work locally.
```text
You are the full Python backend owner (AI strategy service AND deterministic paper trading engine) of TradeAgent AI. Read README.md, PRD.md sections 4, 8 and 9, and contracts/strategy.example.json. Do not redesign API endpoints or JSON keys. In one FastAPI application on port 8000 implement health, generate, approve, scenarios, start simulation, simulation status/events/report exactly as PRD section 8. Prioritize a built-in preset fallback, not external LLM. Validate strategy and immutable approval. Include pure Python seeded engine with two-loss-lock deterministic fixture: two completed losing positions followed by an otherwise-eligible third entry, blocked by the same real risk gate used in ordinary simulation. Audit expected/actual actions, compliance, lock reason and no new position. Implement long-only, stop required, 2 contracts, partial exit at 1.2R, session cutoff, daily max 3, tick units, reproducibility. Clearly label synthetic scenarios, never invent historical metrics. Return LOCAL_ONLY audit unless verified PRISM integration is actually connected. Add CORS, smoke tests and a short run command. If pressed for time, defer Nicrron, PRISM, advanced charting, 1m and sophisticated candle signals; never defer approval, two-loss lock or audit. Deliver end-to-end runnable backend within 5 hours.
```

## Scope cuts for two-person team
Do **not** build separate services, advanced indicators, actual PRISM integration without ready credentials, Nicrron without ready API access, chart polish, 1m refinement or historical-data backtests. Mock AI fallback is acceptable if explicitly disclosed; a fully functioning rule engine and honest audit are not optional.

## Integration order
B starts `/api/health` and `/api/strategies/generate` first; A switches to live calls when available. B completes approval, simulation and audit; A connects dashboard. Both freeze features at 4:15 and rehearse.
