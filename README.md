# TradeAgent AI

### Your Personal Quant Trading Agent in 3 Minutes

**Turn trading discipline into testable automation—no coding required.** Select your trading rules, review an AI-generated strategy, explore clearly labeled hypothetical scenarios, and watch a paper-trading agent execute those rules. Understand *why* it acted—and whether it followed your plan.

> **Demo only.** TradeAgent AI does not provide financial advice, verified historical backtests, live brokerage access, or real-money trading.

## The problem
Traders often have good written rules but no simple way to translate them into executable logic, test edge cases, or prove that automation respected their risk limits. Writing a trading bot from scratch is time-consuming, and black-box AI decisions are difficult to trust.

## Our solution
**Configure → Generate → Review → Simulate → Audit.** A no-code strategy builder converts your instructions into structured rules. A deterministic paper-trading engine applies those rules to synthetic market data. An audit trail shows every entry, rejection, stop and circuit-breaker decision. AI helps interpret the rules; it does **not** have unrestricted authority to trade.

## Demo strategy: US Natural Gas futures
- **Market:** NYMEX Henry Hub Natural Gas (NG), simulated only; fictional `TradeAgent Paper Exchange` and `DEMO-NG-001` account.
- **Timeframes:** 15m trend, 5m entry, optional 1m refinement.
- **Direction:** long-only; trade with the prevailing trend.
- **Entry:** bullish 15m trend plus 5m moving-average pullback, hold and confirmation.
- **Stop:** below recent swing low with a user-confirmed buffer; clarify **ticks vs price points**.
- **Profit target:** example 1.2R; close half at first target with two mock contracts.
- **Discipline:** max 3 trades/session, no overnight positions, and **stop new entries for the session after two consecutive completed losing trades**.

All numerical defaults are editable demo assumptions, not recommendations.

## What the MVP includes
| Feature | Behavior |
|---|---|
| No-code wizard | Guided presets and optional free text |
| AI strategy builder | Validated JSON and readable strategy card |
| Approval gate | No paper execution before confirmation |
| Lightweight scenario analysis | Synthetic “what-if” cases, not actual historical backtesting |
| Paper-trading simulator | Reproducible mock candles and virtual account |
| Risk guardrails | Mandatory stop, long-only, daily cap, cutoff, two-loss circuit breaker |
| PRISM observability | Planned integration; validate SDK and credentials before claiming connected |
| Dashboard | Signals, decisions, virtual equity, conformance and risk events |

## How it works
```text
Trading rules / checkboxes
       ↓
AI interpretation + schema validation
       ↓
Human-readable review + approval
       ↓
Synthetic scenarios + deterministic paper execution
       ↓
Risk checks + decision traces
       ↓
Dashboard + optional PRISM monitoring
```

**Execution accuracy** is measured by comparing the simulator's actions against an independent expected-action rule oracle. This measures *rule compliance*, **not** trading win rate or profitability.

## Tech stack (proposed)
- **Frontend:** React + Tailwind CSS; chart library selected by frontend owner.
- **Backend:** Python + FastAPI; Pydantic for strategy schemas.
- **AI:** Nicrron model API if access is confirmed; offline preset fallback for reliable demos.
- **Simulator:** seeded synthetic OHLCV generator, deterministic signal/risk engine and in-memory paper ledger.
- **Observability:** structured local JSON traces; PRISM adapter if documented integration is available.
- **Persistence:** local JSON or SQLite for hackathon; no personal financial data required.

## Team responsibilities
| Owner | Module | Primary deliverables |
|---|---|---|
| A | Frontend & UX | Wizard, review/approval, dashboard, risk alerts |
| B | AI & strategy API | Prompting, JSON validation, conflict handling, scenario narrative |
| C | Simulation & reliability | Mock candles, rule engine, paper ledger, tests, PRISM adapter |

See [PRD.md](./PRD.md) for detailed user stories, example strategy JSON, API contracts, acceptance tests and demo script.

## Quick start
**Repository status: specification-first.** The following is the intended developer workflow **after** implementation; commands are not yet verified against an existing codebase.

```bash
# Proposed layout
frontend/          # React app — Owner A
backend/           # FastAPI and strategy services — Owner B
simulator/         # Engine, mock data and observability — Owner C
tests/             # Golden risk and conformance tests
PRD.md
README.md
.env.example       # To be created; never commit secrets
```

**Implementation checklist:** create scaffold and dependency files; add API endpoints from PRD; create seeded test scenarios; add UI; configure optional provider keys via environment variables; run risk test suite; connect PRISM only after checking organizer documentation. Avoid copying invented install commands or unverified API/SDK names into production.

## Must-pass demo tests
1. A missing stop prevents execution.
2. Long-only strategy rejects a short order.
3. Two consecutive completed losing trades trigger a session-long entry lock.
4. Risk-reducing exits still work while entry is locked.
5. Same scenario seed + same approved rules produce identical actions.
6. A displayed synthetic performance curve is clearly marked hypothetical.
7. Every trade decision has a timestamp, strategy version and reason.

## Hackathon
Built for **AI x Fintech Hackathon — Money Talks 2**. Primary track: **Trust & Risk**; secondary relevance: **Money Intelligence**. Event: https://luma.com/aq51ak1d?tk=AdbcKb . The public listing encourages connecting builds to **PRISM**; detailed integration/submission requirements must be confirmed through event resources.

## Roadmap
**Now:** no-code strategy + hypothetical scenario exploration + simulated execution + audit. **Next:** licensed historical-data backtests with realistic costs and reproducible statistics. **Later:** regulated/authorized broker sandbox and separately reviewed live integrations.

## Disclaimer
TradeAgent AI is a fictional, educational simulation. It is not a financial advisor, broker, exchange, or trading service. AI-generated scenarios are not historical market evidence and cannot establish expected returns. No live orders or real-money transactions are supported. Futures trading carries substantial risk.

## License
TBD by the team. No open-source license is granted solely by publishing this repository.
