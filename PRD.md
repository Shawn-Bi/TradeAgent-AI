# TradeAgent AI — Product Requirements Document

**Version:** 1.0 | **Status:** Hackathon MVP specification | **Product language:** English (Chinese localization optional)

## 1. Product summary
TradeAgent AI turns a trader's natural-language discipline and no-code selections into a **reviewable, machine-readable strategy**, runs **clearly labeled hypothetical scenario simulations**, and checks whether a **paper-trading execution engine** obeys the strategy. It does not forecast profits, offer investment advice, connect to real funds, or place live trades in the MVP.

**North-star user outcome:** “I can describe my rules, understand exactly what the system will do, and verify it followed those rules without writing code.”

**Target user:** discretionary intraday trader who has written rules but struggles to translate them into consistent, auditable execution.

**First example instrument:** NYMEX Henry Hub Natural Gas futures (NG), *simulated only*. The account is `DEMO-NG-001` at fictional **TradeAgent Paper Exchange**. This is an explicitly fictional environment, not an affiliated brokerage, exchange, or real account. Price unit: USD per MMBtu; futures tick and contract specifications must be separately verified before any real-world implementation.

## 2. Hackathon context and fit
Event: **AI x Fintech Hackathon — Money Talks 2**. Public tracks: Money Intelligence, Money Operations, Trust & Risk. TradeAgent AI primarily fits **Trust & Risk**, with a secondary Money Intelligence component. Public event description calls for building a product, connecting to PRISM, improving it, and demonstrating it. Detailed challenge rubrics, PRISM API contracts and partner credentials are **not established** by the public event page; confirm them in organizer Discord/Builderbase.

## 3. Product principles
1. **No-code first:** checkbox presets + optional natural language + transparent defaults.
2. **Approval before execution:** AI proposes; the user reviews; deterministic software enforces.
3. **Safety over speed:** reject ambiguous orders and missing risk limits; no live-trading endpoint.
4. **Honest evidence:** AI-generated scenario analysis is not historical backtesting; never present invented win rates as observed results.
5. **Traceable actions:** every candidate signal, veto, fill, stop, partial exit, and circuit breaker has a reason and timestamp.

## 4. End-to-end user journey
1. **Configure (goal: ~3 minutes, not a guaranteed SLA):** choose instrument, direction, timeframes, entry, exits, limits, session; start with the Natural Gas template.
2. **Generate and clarify:** model converts selections and free text into validated `StrategySpec` JSON; contradictions and unknown units trigger clarifying questions.
3. **Review and approve:** show plain-English rule card and an exact machine-readable summary; no trading until approved.
4. **Explore scenarios:** generate labeled *hypothetical* trend, range, gap and adverse-move scenarios; use the same deterministic rule engine to evaluate them. Show decisions and risk outcomes, not fabricated predictive performance.
5. **Start paper simulation:** replay reproducible mock candles; execute approved strategy in a fake account; display logs and positions.
6. **Audit:** dashboard displays PRISM execution-conformance metric, rule violations, risk events and sample trace details. Allow pause/reset and export.

## 5. Example customer strategy — source images translated into executable requirements
### 5.1 Scope and instruments
- Instrument: US Natural Gas futures, mock NG; **long only**, no overnight positions.
- Multi-timeframe: 15-minute trend direction, 5-minute entry, 1-minute refinement (1m optional for MVP).
- 15m trend: price above selected moving average and MA sloping upward. Use **explicit configurable MA type/length**; defaults are illustrative only, not stated by customer.
- 5m entry: pullback to MA without a confirmed breakdown; subsequent bullish stabilization/reversal candle; prefer an entry with 5m reversal above the MA. Must specify exact pullback tolerance and confirmation candle definition.
- 1m: refine price only after 15m and 5m eligibility, never independently override them.
- Countertrend/short orders prohibited.

### 5.2 Entry and exit
- Candidate signal requires all configured trend and entry conditions; no chasing late moves.
- Stop: below recent 5m swing low by a **user-defined buffer**. Source images mention ~3–5 “points” while companion doc uses 4 points; **do not assume what a point means for NG**. MVP must ask for buffer in price increments or ticks, then convert consistently.
- Profit target: approximately 1–1.5R; first example template uses **1.2R**. User image mentions 1–1.5R; exact preset should be confirmed in UI.
- First target: close 50% of the position, then manage remainder under explicitly specified stop/trailing rules. A one-contract futures position cannot be half-closed; use 2 mock contracts or mock fractional units visibly marked as non-executable. MVP defaults to 2 mock contracts.
- Stop order must exist before simulated entry. Stop exits and session liquidation override entry signals.
- Day trading only: flatten all positions by a configured **session cutoff**; no overnight holdings. Do not assume a single fixed exchange closing time.

### 5.3 Behavioral controls
- Prefer 2–3 trades/day maximum; configurable daily cap of 3.
- **After two consecutive losing *completed trades*, disable all new entries for the remainder of the trading session.** Exits to reduce risk remain allowed. A partial exit is not a completed trade; count P&L on final position close.
- In poor conditions, abstain; avoid revenge trading and impulsive changes. News events may be flagged only if a real news/calendar feed is connected; otherwise do not claim news detection.
- Strategy changes while running require pause, user approval and a new version ID.

### 5.4 Unresolved configuration questions (must not silently invent)
Exact MA type/period, trend slope lookback, pullback tolerance, reversal candle definition, recent-low lookback, stop buffer unit, trailing-stop behavior, timezone/session cutoff, and treatment of slippage. Present reasonable **clearly marked editable demo defaults** and obtain user approval before simulation.

## 6. MVP functional requirements and acceptance criteria
| ID | Priority | Requirement | Testable acceptance |
|---|---|---|---|
| FR-01 | P0 | Guided strategy wizard and template | A novice can complete preset flow without writing code; all required risk fields visible. |
| FR-02 | P0 | Natural language → validated StrategySpec | Output passes JSON schema; contradictory or ambiguous conditions produce a clarification, not an executable order. |
| FR-03 | P0 | Review/approval gate | Simulator refuses unapproved or modified strategy versions. |
| FR-04 | P0 | Deterministic candle replay and paper ledger | Same seed and settings reproduce same candles, decisions, fills and P&L. |
| FR-05 | P0 | Risk engine | No order without stop; no short; daily cap; no overnight; after 2 losses no new entries. |
| FR-06 | P0 | Decision log and conformance score | Every evaluated signal records expected action, actual action, outcome and reason. |
| FR-07 | P0 | Lightweight AI scenario reasoning | Report is prominently labeled *synthetic/hypothetical*, includes assumptions and cannot claim observed win rate or validated historical performance. |
| FR-08 | P1 | PRISM trace adapter | When valid SDK/credentials are available, export structured traces; otherwise use local JSON trace viewer and label integration pending. |
| FR-09 | P1 | Dashboard | Show status, strategy summary, scenario paths, virtual equity, actions, risk locks and trace detail. |
| FR-10 | P1 | Export and reset | Export JSON report; reset demo account; display seed and strategy version. |
| FR-11 | P2 | Actual historical data backtest | Out of scope for hackathon MVP; future milestone requiring licensed time-series data, fees, slippage, session calendars and reproducible methodology. |
| FR-12 | P2 | Real broker account connection | Out of scope; show disabled “Coming later” only, never a deceptive live onboarding form. |

## 7. Architecture and ownership
```text
React/Tailwind Web UI (A)
   | wizard -> strategy preview -> approve -> scenario/dashboard
   v
FastAPI Strategy API (B)
   | validate input -> LLM (Nicrron if credentials available) -> schema validate
   | scenario narrative (AI) + scenario parameters (explicit assumptions)
   v
Deterministic Rule / Risk / Paper Execution Engine (C)
   | seeded mock candles -> signal checks -> risk veto -> paper ledger
   | decision events -> local audit log -> optional PRISM adapter
   v
Dashboard: compliance, trades, synthetic scenarios, error diagnostics
```
**Critical separation:** LLM never directly submits orders. Scenario performance numbers, if shown, must be **computed by deterministic replay** on disclosed synthetic candles, not invented by an LLM.

### Member A — Frontend
Deliver wizard, conflict-resolution prompts, review card, approval action, simulation controls, chart, event timeline and risk-lock banner. Use accessible plain English and clear fake-money labeling.

### Member B — Strategy generation
Deliver `POST /api/strategies/generate`, schema validation, clarification handling, `POST /api/scenarios/generate`, prompt/version records. Use environment variable for Nicrron key; implement a deterministic fallback preset when key is absent. API endpoint/model names must be verified with partner docs; don't assume availability of `nicrron/auto`.

### Member C — Execution and observability
Deliver seeded candle generator, 15m/5m aggregation, indicator calculation, risk engine, paper ledger, `/api/simulations` endpoints, rule-conformance tests and PRISM adapter. Do not assume a particular `prismtrace-sdk` package is valid until confirmed.

## 8. Proposed API contract
- `POST /api/strategies/generate` → `{strategy, clarification_questions, warnings, version}`
- `POST /api/strategies/approve` → `{strategy_id, version, approved: true}`
- `POST /api/scenarios/generate` → `{scenario_type, assumptions, seed, synthetic: true, narrative}`
- `POST /api/simulations/start` → `{simulation_id, strategy_id, seed, account_id}`
- `GET /api/simulations/{id}` → `{status, equity, positions, trades, lock_reason}`
- `GET /api/simulations/{id}/events` → ordered decision traces
- `GET /api/simulations/{id}/report` → scenario stats + conformance metrics + limitations
- `POST /api/simulations/{id}/pause` → stops new decisions; manages outstanding positions under predefined rules

### StrategySpec example (illustrative defaults, not user-confirmed)
```json
{
  "instrument": "NG_SIM", "account_id": "DEMO-NG-001",
  "side": "LONG_ONLY", "timeframes_minutes": [15, 5, 1],
  "trend": {"ma_type": "SMA", "period": 20, "require_rising": true},
  "entry": {"type": "PULLBACK_HOLD_AND_BULLISH_CONFIRMATION", "pullback_tolerance_ticks": 3},
  "stop": {"type": "BELOW_RECENT_SWING_LOW", "lookback_bars": 5, "buffer_ticks": 4},
  "take_profit": {"r_multiple": 1.2, "first_target_close_fraction": 0.5},
  "quantity_mock_contracts": 2,
  "risk": {"max_trades_per_session": 3, "consecutive_losses_lock": 2, "no_overnight": true, "require_stop": true},
  "session": {"timezone": "America/New_York", "cutoff_time": "16:00", "cutoff_is_demo_only": true},
  "simulation_only": true, "status": "DRAFT"
}
```
For NG, a 4-tick buffer is **not the same as 4 price points**. Clearly show conversion after instrument specifications are validated. Never present demo stop defaults as trading recommendations.

## 9. PRISM and execution accuracy
**Primary metric:** `execution_conformance = correct_engine_actions / eligible_decision_events`.

A correct action is one that matches an **independent rule-based oracle** for the approved StrategySpec, including **NO_TRADE** and risk vetoes. Record numerator, denominator, scenario ID, version and exceptions. If no eligible events occur, report `N/A`, not 100%.

Supporting metrics: false entries, missed eligible entries, missing-stop violations, trades attempted after circuit breaker, forced-liquidation failures, model parsing failures, and event-to-action latency. PRISM integration is an observability destination, not the sole source of truth. Capture redacted input/outputs and structured rule IDs; never transmit API keys or real account data.

## 10. Demo script (4–6 minutes)
1. Open demo account, choose NG template; see clear simulated-only badge.
2. Enter 15m/5m long-only pullback strategy; set stop and 1.2R target; select 2-loss lock.
3. Generate and inspect rule card; clarify a deliberately ambiguous “4 points” stop unit.
4. Approve strategy; run synthetic bullish and choppy scenarios; view assumptions.
5. Replay seeded session with two completed losing trades; show lock and rejected third entry.
6. Show trace where expected=BLOCK_ENTRY and actual=BLOCK_ENTRY, conformance score, and export report.

## 11. Quality gates / test matrix
| Case | Expected result |
|---|---|
| Trend fails | No new long entry |
| 15m trend passes, 5m confirmation absent | No entry |
| 1m signal conflicts with 15m | No entry |
| Stop not configured | Reject approval or start |
| Short signal | Block |
| First loss | May still enter if otherwise eligible |
| Second consecutive completed loss | Session lock; subsequent entries rejected |
| Winning completed trade between losses | Reset consecutive-loss count |
| Existing position after lock | Protective exits still execute |
| At cutoff | Flatten positions; block entries |
| Same seed and spec | Identical event stream |
| Ambiguous tick/point units | Request clarification |
| No scenario data | No invented backtest metrics |
| PRISM unavailable | Local traces work; honest pending status |

## 12. Success criteria
- First-time tester can build and approve a strategy in approximately 3 minutes in a usability test (measure, do not promise).
- 100% pass rate on critical safety test cases (missing stop, no short, cutoff, two-loss lock).
- 100% conformance on the deterministic seeded golden test set; display measured real run results, not an assumed score.
- All synthetic scenario charts explicitly labeled; user can explain why the agent entered or abstained.
- Demo works with zero real funds and with optional LLM/PRISM services disconnected.

## 13. Limitations and disclaimers
This is an educational, hypothetical paper-trading prototype, not a brokerage or investment adviser. Synthetic scenario analysis is **not** historical backtesting, does not establish predictive validity, and cannot estimate future profitability. No real funds, bank data, credentials, orders, or brokerage connections. Futures trading involves substantial risk; live execution would require separate market-data, broker, legal, compliance, testing and operational reviews.

## 14. Future roadmap
Historical OHLCV import with provenance → deterministic walk-forward backtesting with fees/slippage → broker sandbox integration → advanced alerts and explainable rule editor → separately evaluated live integration subject to compliance and explicit authorization.

## 15. Source notes
Based on the user's two uploaded Chinese trading-rule images, `产品信息总结.docx`, and the public event page: https://luma.com/aq51ak1d?tk=AdbcKb . Technical design choices and illustrative defaults in this PRD are **proposals**, not facts from the user materials or confirmed organizer requirements.
