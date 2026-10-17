# TradeAgent AI
**Your personal no-code quant trading agent in ~3 minutes.**

Turn intraday trading rules into an understandable, testable and auditable **mock** trading agent without coding. Choose timeframes, entry signals, stop-loss and risk lock; AI generates a reviewable strategy, shows clearly labeled hypothetical scenarios, and a deterministic paper engine records whether it follows the rules.

**Hackathon track:** Money Intelligence (supporting Trust & Risk / Money Operations). **Status:** hackathon prototype specification; do not claim completed integrations until verified.

## What the first user can do
1. Select fictional `NG_SIM` natural gas futures account.
2. Configure 15m trend + 5m pullback, long only, explicit stop ticks, 1.2R target, partial exit and 2-loss lock.
3. Generate and approve strategy rules (AI adapter optional; built-in preset fallback).
4. View *synthetic scenario reasoning*, not a historical backtest.
5. Run deterministic paper simulation; see third entry blocked after two completed losses.
6. Inspect local decision audit and, if connected, PRISM traces.

## Frozen StrategySpec v1 — decisions made in advance
`contracts/strategy.example.json` is the **single source of truth**. All members must copy the exact names and nested types. These are **editable demo assumptions**, not trading recommendations or confirmed user preferences.

- Instrument `NG_SIM`, fictional TradeAgent Paper Exchange and account `DEMO-NG-001`; price quoted USD/MMBtu. **DEMO-ONLY** tick size `0.001`, demo tick value `$10` per contract; no claim of verified exchange specifications.
- Long only. Trend 15-minute SMA(20), slope rising over 2 bars and close above SMA; entry 5-minute SMA(20), pullback within 3 ticks, bullish confirmation defined `close > open AND close > MA`. 1-minute refinement **disabled** for five-hour MVP.
- Stop below minimum low of previous 5 completed 5m candles by **4 ticks** (NOT “4 points”; source wording ambiguous). User must see and approve tick units. Entry risk = entry minus stop; reject nonpositive risk.
- Two mock contracts; profit target at `entry + 1.2 × initial risk`, exit one contract at target; second contract exits only at protective stop or session cutoff (no trailing stop in MVP). Conservative intrabar tie: if both stop and target hit in same bar, assume stop first. Fills at trigger price; fees and slippage zero for MVP and explicitly disclosed.
- Up to 3 **completed positions** per simulated session; two consecutive *completed losing positions* lock new entries until next session. Sum all partial exits to determine each position's realized P&L. A winning/breakeven completed position resets consecutive-loss count. Risk-reducing exits always allowed. Flat by demo cutoff `16:00 America/New_York` (not a claim about NG exchange hours). Same seeded candle fixture must reproduce output.
- `approval_status` starts `DRAFT`; server stores `APPROVED` version; any edits invalidate approval. No real broker connection, no actual historical market data.
- Synthetic scenarios are **hypothetical**, not historical backtests. Show no win rate, maximum drawdown, or profit figure unless computed from deterministic simulated candles; label synthetic prominently.
- Conformance = compliant eligible rule decisions / all eligible rule decisions; include veto events, return N/A when denominator zero. PRISM SDK optional pending verified docs; local audit mandatory.


## Shared integration contract
Read `contracts/strategy.example.json` before writing code. **Do not rename fields or API routes.** All API endpoints and response examples are frozen in `PRD.md` section 8. Backend routes: `POST /api/strategies/generate`, `POST /api/strategies/approve`, `POST /api/scenarios/generate`, `POST /api/simulations/start`, `GET /api/simulations/{simulation_id}`, `/events`, `/report`, and `GET /api/health`.

## Planned repo layout
```text
TradeAgent-AI/
├── README.md
├── PRD.md
├── TEAM_ISSUES_AND_PROMPTS_3P.md
├── TEAM_ISSUES_AND_PROMPTS_2P.md
├── contracts/strategy.example.json
├── frontend/           # React + TypeScript
├── backend/            # FastAPI routes and strategy generation
├── simulation/         # Python deterministic engine
└── tests/              # shared fixtures and acceptance tests
```

## Running the MVP
This repository's documentation does **not** imply code is already implemented. Team must add `frontend/`, `backend/`, `simulation/` and runnable commands. Recommended local defaults: frontend port `5173`, backend `8000`, `VITE_API_BASE_URL=http://localhost:8000`. Use `NICRRON_API_KEY` only if API access is confirmed; otherwise fallback preset. PRISM optional with local audit always available. Never commit `.env` or secrets.

## Demo proof
`two-loss-lock` deterministic fixture → two completed losing positions → third entry refused (`BLOCK_ENTRY`) → audit shows expected and actual actions → no order opened. PRISM status must reflect reality (`LOCAL_ONLY` when disconnected).

## Limitations
No real market data, real historical backtesting, live exchange connection, bank account, or financial advice. Demo tick value, price increment, cutoff, fills and fees are assumptions. Synthetic scenario results are not evidence of expected profitability.

## Team execution
For **3 members** use `TEAM_ISSUES_AND_PROMPTS_3P.md`; for **2 members** use `TEAM_ISSUES_AND_PROMPTS_2P.md`. Both target **five hours total**, including integration and demo rehearsal. Contract is already decided—no 30-minute schema meeting required, just a five-minute review.
