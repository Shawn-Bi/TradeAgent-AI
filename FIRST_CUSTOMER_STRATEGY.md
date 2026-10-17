# TradeAgent AI — First Customer Strategy & Acceptance Test

**Purpose:** Shared product demo fixture for frontend A and backend B. **Simulation only; not financial advice.** This is not a historical backtest and contains no real market performance claims.

## 1. Source strategy (from the user's two Chinese reference images)
- Trade only one familiar instrument, follow the trend, do not average down or chase losses; prefer a small number of high-quality trades.
- 15-minute chart determines direction, 5-minute chart determines entries, optional 1-minute chart refines timing. On the 15-minute chart, look for bullish direction; on the 5-minute chart, look for a pullback that holds a moving average and stabilizes. The image describes 15m bullish / 5m bearish pullback / 5m bullish stabilization as a pattern.
- Stop below a recent swing low, described in the image as approximately 3–5 *points* (unit not defined); profit target approximately 1–1.5x risk; at the first target, take partial profits; leave a runner if conditions permit.
- 2–3 trades maximum per day, stop after two consecutive losing trades; stand aside in choppy conditions, avoid emotional trading and news-driven impulse trades; no overnight position.

## 2. Frozen MVP interpretation (implementation assumptions, not claims from the images)
- Mock symbol `NG_SIM`, simulated venue `TradeAgent Paper Exchange`, demo account `DEMO-NG-001`.
- Long-only. 15m SMA20: close above a rising SMA20; 5m SMA20: pullback touches SMA within 3 ticks and closes bullish above SMA. 1m confirmation deferred.
- Entry requires closed bars; no lookahead. Stop is below the minimum low of previous five completed 5m bars by **4 ticks**. **Four ticks is a demo substitution, NOT a conversion of the image's undefined “4 points.”** NG_SIM tick size = 0.001; demo tick value = $10 per contract, as defined in the existing v3 contract.
- Two simulated contracts per position. At 1.2R, close one contract; remaining contract exits on stop or session cutoff. For speed, do not implement trailing stops.
- Max three completed positions per demo session; two consecutive losing **fully closed positions** lock new entries for the remainder of that session. A partially closed position is not yet a completed position. P&L of both legs determines the position outcome; a zero-P&L completed position resets the consecutive-loss counter (documented MVP convention).
- Flat at 16:00 America/New_York **for demo purposes only** (not a statement of real NG market hours). Synthetic scenarios, no fees or slippage in MVP; never display hypothetical figures as historical results.

## 3. Required demo walkthrough
1. A displays the first-customer preset and editable inputs.
2. User clicks **Generate Strategy**. B returns a validated proposed strategy (Nicrron when available; labeled local fallback otherwise).
3. A shows readable conditions, explicit `4 ticks` units and **Approve Strategy**.
4. A shows a **Hypothetical Scenario Simulation** (not historical backtest).
5. User starts **Two-Loss Lock Test**. The same engine risk gate processes all candidate entries.
6. Two completed positions close at a loss. A third otherwise-valid entry is **BLOCKED** with `TWO_CONSECUTIVE_LOSSES`.
7. A displays compliance ratio, events, session lock, and `PRISM_CONNECTED` only if real integration is verified; otherwise `LOCAL_ONLY`.

## 4. Acceptance conditions
- Reject missing stops, unapproved strategies, inconsistent price units and negative risk distance.
- No short positions; no overnight positions; do not exceed max completed trades.
- A third eligible signal after two consecutive losses cannot open a position, even if the UI tries again.
- Display both numerator and denominator for compliance, and audit each attempted decision (including blocked entries).
- Results must be deterministic for the same fixture and seed; the two-loss scenario is a test fixture, not a performance forecast.

## 5. Canonical contract and API
Do not rename any fields. Use `../contracts/strategy.example.json` from v3 as the canonical StrategySpec and the routes in `PRD.md` section 8. Do not create a separate incompatible schema. This folder adds demo fixtures and UI copy only.
