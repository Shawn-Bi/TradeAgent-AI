# TradeAgent AI

TradeAgent AI is a paper-trading demo for the Money Talks 2 hackathon (October 17, 2026, Money Intelligence track). A trader describes intraday rules in plain English, Nicrron drafts a strategy and asks about anything unclear, the trader approves one exact version, and a deterministic engine replays synthetic sessions and records whether every decision followed the rules.

The model only proposes; the engine enforces. Nicrron never places an order, approves a strategy or loosens a risk rule.

https://github.com/user-attachments/assets/48948d3d-3acd-40f7-800c-7bad452f3bed

**Demo video (80 seconds):** the opening parodies AI-trading-bot ads with stock clips. Every app screen after it was captured from the real app running locally, with Nicrron and PRISM connected, on synthetic data. A copy is also in [`docs/media/tradeagent-demo.mp4`](docs/media/tradeagent-demo.mp4).  
**Source:** https://github.com/Shawn-Bi/TradeAgent-AI

## Demo flow

1. **Preset.** Start from the fictional `NG_SIM` natural gas futures account (`DEMO-NG-001`): 15-minute trend, 5-minute pullback entry, stop 4 ticks below the swing low, 1.2R target, two contracts, and a lock after two losses in a row. The risk per trade is shown in dollars before anything runs.
2. **Generate.** Change a rule in your own words, for example "Put the stop 4 points below the swing low." Nicrron notices that the engine counts ticks, not points, and asks instead of guessing. Answer "4 ticks" and generate again. The panel shows which fields Nicrron read, which Knowledge Base sources it used, and the PRISM trace.
3. **Approve.** Review the plain-English IF/THEN rules and approve one immutable version. A version with open questions cannot be approved, and any later edit starts a new draft.
4. **Scenario.** See clearly labeled hypothetical scenarios (trend, range, adverse), not a historical backtest.
5. **Simulate.** Run the `two-loss-lock` session. Two trades hit their stops (−$260 each), new entries lock, and the third otherwise valid entry is marked **BLOCKED** at 12:30.
6. **Audit.** Check expected against actual action for every decision (84 of 84 followed the rules), the blocked entry and its reason, the proposed vs approved strategy, and whether the Nicrron call behind the approved version was traced in PRISM.

Other sessions: `winning-reset`, `cutoff`, `ambiguous-bar`, `trend-fail`, and the seeded `standard`, `trend`, `range` and `adverse`.

## Nicrron and PRISM integration

`backend/nicrron_client.py` calls Nicrron (`https://api.nicrron.ai/v1`, model `nicrron/auto`, temperature 0) for one bounded task: turn the trader's words into a StrategySpec draft plus clarification questions.

- The backend validates every response. Unsupported, invalid or unsafe output becomes a clarification question, and the model can never set protected fields.
- Paid calls are capped per hour (`NICRRON_MAX_CALLS_PER_HOUR`, default 20) and run one at a time.
- Without a key, or when Nicrron fails, free text returns a labeled demo preset that cannot be approved. Empty free text uses the approvable demo preset.

Nicrron never decides whether a rule passes, places an order, approves a version or changes the engine's limits. Approval and the risk gate stay deterministic.

PRISM covers the agent quality loop the track asks for:

- **Tracing.** Every Nicrron call is one PRISM trace from agent `tradeagent-strategy-translator`, grouped by drafting session. Engine decisions stay in the local audit, because they are deterministic, not agent output.
- **Knowledge Base.** Prompt `v2` (the default) searches the PRISM Knowledge Base built from [`docs/kb/`](docs/kb/README.md) before each call and cites the snippets in the prompt; the search is attached to the trace. Prompt `v1` is the original baseline without retrieval.
- **Evaluation.** `scripts/eval_run.py` sends the 63 trader inputs in `tests/eval/inputs.jsonl` (clear rules, unit traps, fractions, unsupported asks, risk loosening, typos and vague text) through the real backend and grades each draft; the rubric is in [`docs/kb/EVALUATOR.md`](docs/kb/EVALUATOR.md). On October 17 we ran v1 and v2 on the same inputs (these 63 plus 38 harder ones: unit traps, ranges, cutoffs, unsupported limits), 404 runs in all, each a real Nicrron call and a PRISM trace:
  - `nicrron/auto` (routed to Claude Opus 5.5): v1 61/63 and v2 63/63 on the original set; v1 37/38 and v2 35/38 on the harder set. The remaining failures are later-cutoff requests where the model asks instead of applying.
  - `openai/gpt-4o-mini`, the same model for both versions: v1 59/101, v2 57/101. Runs that set a value the trader never stated fell from 11 to 2, and unit errors from 4 to 0. In exchange v2 asks more unnecessary questions (23 runs vs 15); an extra question blocks approval and does not apply a value.
  - Failure cluster (v1, gpt-4o-mini, 4 runs, one cause): non-tick units copied into tick fields. "2 points" became 2 ticks (`unit-05`, `mix-01`), a bare "5" became 5 ticks (`unit-06`), "2 cents" became 20 ticks (`unit-10`). v2's unit rules and Knowledge Base context removed all four.
  - PRISM evaluator limitation: in PRISM the v2 traces show the retrieved Knowledge Base context as the trace output instead of the model's reply, so the PRISM evaluator has not been run on v2 traces. The scores above come from the local harness.

PRISM never blocks a request: if it is down, drafting still works and the status says `FAILED`. The Audit step shows `CONNECTED` only when PRISM accepted the trace of the Nicrron call that wrote the approved version; otherwise `LOCAL_ONLY`.

## Run locally

Requirements:

- Python 3.13 and Node.js 22 or later (tested with Python 3.13.0 and Node.js 24)
- optional: a Nicrron key and PRISM project credentials

The app runs without any keys, using the demo preset and the local audit. To turn on Nicrron and PRISM, copy `backend/.env.example` to `backend/.env` (git-ignored) and fill in:

```bash
NICRRON_API_KEY=your_nicrron_key
PRISMTRACE_PROJECT_ID=your_prism_project_id
PRISMTRACE_API_KEY=your_prism_key
```

Start the backend from the repo root (on Windows use `.venv/Scripts/python.exe`):

```bash
python -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn backend.main:app --reload --port 8000
```

Start the frontend in a second terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` to port 8000, so development works like the single-origin deployment. API docs are at [http://localhost:8000/docs](http://localhost:8000/docs).

`.venv/bin/python -m backend.nicrron_smoke` makes one real Nicrron request and prints `RESULT: REAL_API_VERIFIED`, or exits without a request when the key is missing. For an offline backup with no backend, run `VITE_API_MODE=mock npm run dev` in `frontend/`; a permanent OFFLINE MOCK strip shows the mode.

**Deployment.** The `Dockerfile` builds the frontend and runs FastAPI, which serves `/api/*` and the frontend on one address, so no key or token reaches the browser. Keys are set as the host's environment variables. See [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Validate

```bash
.venv/bin/python -m pytest -q
cd frontend && npm run lint && npm run build
```

The backend tests cover the engine and risk gate, the two-loss lock fixture, strategy versions and approval, Nicrron output validation, PRISM tracing, Knowledge Base retrieval, security limits, the eval harness and frontend serving. They mock Nicrron and PRISM and never touch the network.

The evaluation makes real Nicrron calls and PRISM traces and starts its own backend:

```bash
.venv/bin/python scripts/eval_run.py --prompt-version v1
.venv/bin/python scripts/eval_run.py --prompt-version v2
.venv/bin/python scripts/eval_run.py --compare tests/eval/results/v1-<tag>.json tests/eval/results/v2-<tag>.json
```

## Safety and current limits

- Simulation only: no broker connection, no real orders, no real money, no financial advice.
- `NG_SIM` is a fictional instrument. The tick size (0.001), tick value ($10), 16:00 cutoff, fills at the trigger price and zero fees and slippage are demo assumptions, and they are disclosed in the app.
- All market data is synthetic. Scenarios are hypothetical, not historical backtests. The app shows no win rate, drawdown or expected return; rule-following is not profitability.
- Long only, one market, two contracts, at most three completed trades a session. Shorts, trailing stops, time-of-day filters and other unsupported asks become clarification questions.
- State is in memory: after a backend restart, generate and approve again.
- The P&L in the demo (−$260 per loss) comes from crafted synthetic candles. The illustrative −$80/−$100 values in `two_loss_lock.fixture.json` are replayed separately in the tests through the same risk gate.

## Project docs and history

- [`contracts/strategy.example.json`](contracts/strategy.example.json): the frozen StrategySpec v1 schema. Routes and fields are frozen in [`docs/PRD.md`](docs/PRD.md) §8; new response fields are additive.
- [`backend/API.md`](backend/API.md): every route, field and error.
- [`docs/FIRST_CUSTOMER_STRATEGY.md`](docs/FIRST_CUSTOMER_STRATEGY.md): the first customer's strategy and the demo assumptions.
- [`frontend/README.md`](frontend/README.md): frontend structure and styles.
- [`AGENTS.md`](AGENTS.md): working rules for people and AI agents in this repo.
- [`docs/TEAM_ISSUES_AND_PROMPTS_2P.md`](docs/TEAM_ISSUES_AND_PROMPTS_2P.md) and [`docs/FRONTEND_HANDOFF_A.md`](docs/FRONTEND_HANDOFF_A.md): the original five-hour build plan, kept for reference.

Built in one day at Money Talks 2 by a two-person team: frontend by [@antunishdPursuit](https://github.com/antunishdPursuit), backend and engine by [@Shawn-Bi](https://github.com/Shawn-Bi). Built with AI coding assistance.
