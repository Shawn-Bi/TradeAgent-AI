# Handoff to teammate A (Frontend)

## What to build (5-hour, 2-person MVP)
1. A guided preset page labeled **First Customer: NG_SIM Natural Gas Futures (Mock)**.
2. Readable strategy review with 15m/5m, SMA20, long-only, stop buffer **4 ticks**, 1.2R target, two contracts, first-target partial exit, max three completed trades, two-loss lock, demo cutoff.
3. Buttons: **Generate Strategy**, **Approve Strategy**, **Run Hypothetical Scenario**, **Start Two-Loss Lock Test**.
4. Audit/dashboard: proposed vs approved, simulation-only badge, mock account, positions, ordered events, lock status and reason, compliance numerator/denominator, PRISM status (or LOCAL_ONLY).
5. Empty/loading/error states; no fake claim of live trading, real account, real historical returns, or PRISM connection.

## Integration contract
Use existing v3 `contracts/strategy.example.json` and `PRD.md` section 8 for API shapes/routes. The backend is owned by B. Start with typed mock responses matching those exact shapes, then switch to real API. Do not introduce a second schema or new endpoints.

## Most important acceptance demo
After two losing closed positions, display `BLOCK_ENTRY` and `TWO_CONSECUTIVE_LOSSES` on a third otherwise-valid entry, with zero new positions. The backend must enforce this; frontend is display only.

## Copy-ready frontend prompt
```text
Read PRD.md section 8, contracts/strategy.example.json, and FIRST_CUSTOMER_STRATEGY.md, two_loss_lock.fixture.json and FRONTEND_HANDOFF_A.md. Build the first-customer NG_SIM strategy wizard and dashboard for the five-hour, two-person TradeAgent AI demo. Use the exact canonical API routes and JSON fields; create typed mock adapters while backend B works. Show long-only 15m/5m SMA20 rules, 4-tick demo stop buffer, 1.2R target, 2 contracts, partial close, 2-loss session lock. Provide Generate → Review → Approve → Hypothetical Scenario → Two-Loss Test → Audit flow. Display the blocked third entry and the exact reason. Never label synthetic scenario output as historical backtesting. Do not imply real brokerage or real PRISM connection. Focus on runnable integration over UI polish.
```
