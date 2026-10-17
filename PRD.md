# TradeAgent AI — PRD
**Version 3.0 | Five-hour hackathon MVP | Primary track: Money Intelligence**

## 1. Product promise
**Your personal no-code quant trading agent in ~3 minutes.** Users select intraday rules, review AI-translated logic, approve a strategy, explore hypothetical simulated outcomes, run a mock paper session, and inspect rule execution accuracy. Three minutes is a usability goal for setup, not a guaranteed backtest time. No real money or brokerage integration.

**Problem:** Traders have discipline in notes/screenshots but cannot easily translate it into testable, consistent, auditable automation. **Success:** first-time user completes configuration → generation → approval → simulation → audit without coding.

## 2. Hackathon fit and scope
Primary **Money Intelligence** (AI interpretation of financial strategy); supporting Trust & Risk (guardrails/audit) and Money Operations (mock orders). Use organizer PRISM integration only if verified documentation and credentials are available. No scoring-first work.

## 3. Source rules vs implementation defaults
From customer screenshots and source DOCX: long-only, 15m direction / 5m entry / optional 1m refinement, trend-following MA pullback, swing-low stop with 3–5 “points” (companion DOCX says 4), 1–1.5R target (DOCX selects 1.2R), partial exit, 2–3 trades/day, stop after two consecutive losses, no overnight. Original material does **not** specify exact MA periods, what a “point” means for NG, candle formulas, fees, or cutoff time. Section 4 makes demo assumptions explicit; they are not presented as original customer instructions.

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


## 5. User journey and pages
1. Wizard: start with NG preset; checkbox/select inputs and optional free text; show demo-only banner, explicit tick units and editable defaults.
2. Generate: LLM (optional Nicrron adapter) or preset fallback converts input to validated StrategySpec; contradictory or ambiguous free text requires clarification, no silent execution.
3. Review/approve: display readable IF/THEN rules, stop units, partial exit, risk lock, synthetic disclaimer. Only approved immutable version may run.
4. Hypothetical scenario: simple synthetic trend/range/adverse cases, assumptions and explanation. A chart is optional. **Do not** call this real historical backtesting.
5. Run paper simulation: seeded replay, two completed losses fixture, attempted third entry blocked, paper ledger and audit event reasons.
6. Dashboard: status, virtual account, decisions, risk lock, accuracy numerator/denominator, PRISM status `CONNECTED` or `LOCAL_ONLY`.

## 6. Functional requirements / priorities
| ID | Priority | Acceptance |
|---|---|---|
| P0-1 | P0 | No-code wizard, user can review and approve exact StrategySpec. |
| P0-2 | P0 | Schema-valid strategy generation; preset fallback works without API key. |
| P0-3 | P0 | Approved-only seeded simulation; no short, missing stop, over-cap or overnight entry. |
| P0-4 | P0 | Deterministic two-loss fixture: third opening attempt BLOCKED, exits permitted. |
| P0-5 | P0 | Event audit with expected vs actual and reproducible conformance. |
| P0-6 | P0 | Clearly labeled hypothetical scenario narrative, not invented historical statistics. |
| P1-1 | P1 | Live PRISM adapter only with confirmed SDK/credentials. |
| P1-2 | P1 | More charts, exports, 1m refinement, custom indicators. |
| P2-1 | Out | Real historical backtest, live account opening, broker APIs, real trades. |

## 7. Architecture
`React + TypeScript frontend (A) → FastAPI gateway/AI (B) → Python deterministic simulator (C) → local audit (+ optional PRISM)`. In a **two-person team**, member B owns backend plus deterministic simulator, member A owns frontend/integration. The model never submits trades; all risk checks occur in deterministic code.

## Frozen API contract (v1, do not rename endpoints)
All requests/responses JSON. All errors: `{"error":{"code":"STRING","message":"Human-readable","field":null}}` with appropriate HTTP status. CORS allow local frontend. `strategy_id` + `version` identify immutable strategy; edits create a new DRAFT version.

1. `POST /api/strategies/generate` request `{"template_id":"ng-long-pullback-v1","overrides":{},"free_text":""}`; response `{"strategy": StrategySpec, "clarification_questions":[],"warnings":[],"strategy_summary":"..."}`. If ambiguity (e.g. '4 points') return clarification_questions and `approval_status=DRAFT`; cannot approve until resolved. Fallback uses preset when LLM credentials missing.
2. `POST /api/strategies/approve` request `{"strategy_id":"ng-demo-v1","version":1}`; response `{"strategy_id":"ng-demo-v1","version":1,"approval_status":"APPROVED"}`. Server validates complete strategy and refuses ambiguity.
3. `POST /api/scenarios/generate` request `{"strategy_id":"ng-demo-v1","version":1,"seed":42}`; response `{"synthetic":true,"method":"RULE_BASED_SYNTHETIC_REPLAY","seed":42,"scenarios":[{"name":"trend","assumptions":["synthetic candles"],"narrative":"...","computed_pnl_usd":0.0}]}`. Never fabricate historical metrics; P&L only from engine replay; if not wired, omit computed_pnl_usd and show narrative only.
4. `POST /api/simulations/start` request `{"strategy_id":"ng-demo-v1","version":1,"seed":42,"fixture":"two-loss-lock"}`; response `{"simulation_id":"sim-42","status":"COMPLETED","seed":42}`. `fixture` optional, default `standard`; synchronous complete is allowed for five-hour MVP.
5. `GET /api/simulations/{simulation_id}` response `{"simulation_id":"sim-42","status":"COMPLETED","account_id":"DEMO-NG-001","equity_usd":100000,"positions":[],"completed_trades":[],"consecutive_losses":2,"entry_locked":true,"lock_reason":"TWO_CONSECUTIVE_LOSSES","prism_status":"LOCAL_ONLY"}`. Values are illustrative schema samples, not measured results.
6. `GET /api/simulations/{simulation_id}/events` response `{"events":[{"event_id":"evt-1","seq":1,"timestamp":"2026-10-17T14:00:00-04:00","rule_id":"RISK_TWO_LOSSES","expected_action":"BLOCK_ENTRY","actual_action":"BLOCK_ENTRY","compliant":true,"reason":"Two completed losing trades"}]}`.
7. `GET /api/simulations/{simulation_id}/report` response `{"simulation_id":"sim-42","synthetic":true,"eligible_decisions":1,"compliant_decisions":1,"execution_conformance":1.0,"violations":0,"disclaimer":"Synthetic demo, not historical backtest"}`; if denominator 0 use `null` for conformance.

All responses use the same exact field names. Use `/api/health` → `{"ok":true,"contract_version":"1.0.0"}`. A uses typed mock API with these shapes, B owns routing, C exposes Python callable `run_simulation(strategy, seed, fixture)` and `get_report(...)` imported by B (no second server). 


## 9. Exact fixture and evaluation
Create seeded fixture `two-loss-lock` containing two complete losing positions followed by a third otherwise-eligible entry attempt. Assert completed position P&L negative for each, `consecutive_losses == 2`, `entry_locked == true`, third entry event `expected_action=BLOCK_ENTRY`, `actual_action=BLOCK_ENTRY`, `compliant=true`, and no new position. Test no-stop rejection, unapproved version, 15m trend failure, cutoff liquidation, same-seed reproducibility and winning trade resetting streak. Log all eligible decisions; denominator includes correct NO_TRADE and BLOCK_ENTRY actions. No events → accuracy N/A.

## 10. Five-hour definition of done
At 4:00 stop adding features. By 5:00 demo must run without paid keys or PRISM: preset → generate → approve → synthetic scenario explanation → deterministic fixture → third trade blocked → local audit. Include `.env.example`, installation/run commands, tests and honest limitation notice. Demo may use a synchronous accelerated replay, not a live market feed.

## 11. Risks and disclaimer
Synthetic candles cannot prove future profitability. Mock fills omit slippage/fees; demo tick and cutoff are assumptions. LLM may misinterpret rules, so schema validation and explicit approval are required. Futures involve substantial risk. Educational prototype only, not financial advice or live brokerage service.

## 12. Provenance and change notes
Based on two user screenshots and `产品信息总结.docx`; exact field names, formula defaults and five-hour scope are **new product decisions**. Compared with the prior uploaded document: removes fabricated AI 'expected win rate', makes 4 **ticks** explicit instead of undefined points, makes C's simulation deterministic, freezes API names, and adds two-person fallback and five-hour scope. Compared with v2: resolves conflicting endpoint names and adds canonical fixture + contract.
