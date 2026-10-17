# TradeAgent AI — First Customer Executable Strategy v5

**Status:** IMPLEMENTABLE DEMO SPEC, customer-confirmed four options; other demo assumptions remain. **Scope:** simulated NG_SIM futures only; no real orders or investment advice. This v5 file **replaces** the older `demo_strategy/FIRST_CUSTOMER_STRATEGY.md`; keep the reference screenshots separately. Use the existing `contracts/strategy.example.json` as the shared field contract; do not create an incompatible schema.

## A. What the screenshots actually say
- Trade **one familiar instrument**, focus on following the trend, avoid guessing tops/bottoms, averaging down and countertrend entries.
- Three timeframes: **15m direction, 5m entry, 1m precise refinement**. The image explicitly says **15m bullish + 5m bearish pullback → 5m bullish stabilization** for a long; the opposite for shorts, but this customer MVP chooses long-only.
- Entry is valid when both (a) 15m price above its moving average and trending up, and (b) 5m pullback does not break its moving average and stabilizes; avoid entry if price falls below the average / previous high is not passed (as described in image).
- Stop ~3–5 *points* below a recent low (undefined units). Target 1–1.5× initial stop distance; first target exits half. Favor modest gains over chasing large moves.
- 2–3 trades/day maximum; two consecutive losses → stop trading; avoid choppy conditions, news spikes and emotional trading; do not hold overnight.

## B. Frozen DEMO parameters (our engineering choices, not in screenshots)
| Item | Demo rule | Rationale |
|---|---|---|
| Instrument | `NG_SIM`, paper account `DEMO-NG-001` | Mock only |
| Trade side | LONG_ONLY | Simplifies demo; no shorts |
| Tick size/value | 0.001 price units; $10 per contract per tick | Simulation assumptions |
| Quantity | 2 contracts per position | Enables exact half-exit |
| Trend | 15m SMA(20), 2-bar rising slope | Makes “uptrend” measurable |
| Entry | 5m SMA(20), tolerance 3 ticks, bullish closed bar | Makes “pullback/stabilize” measurable |
| 1m | Display-only / optional; **not an execution gate** | Time limit; image suggests refinement |
| Stop | min low of last 5 completed 5m bars − 4 ticks | **Customer selected 4 ticks for the demo; this is a simulation-specific interpretation, not a general equivalence to points** |
| Target | 1.2R, close 1 of 2 contracts | In the screenshot's 1–1.5R band |
| Remainder | Stop or demo 16:00 NY cutoff | Customer confirmed original stop; no breakeven/trailing adjustment |
| Max completed trades | 3 per simulated session | Image suggests 2–3 |
| Loss lock | 2 consecutive fully closed net-losing positions | Hard risk gate |
| Fees/slippage | Zero in demo; labeled | Not representative of live trading |

## C. Exact decision algorithm (all timestamps are simulated)
1. **Data integrity:** read timestamped 1m mock OHLCV bars. Aggregate into completed 5m and 15m bars using the same session boundary; NEVER read unfinished or future bars. Require at least 22 completed 15m bars and 20 completed 5m bars. No data → `WAIT_INSUFFICIENT_HISTORY`.
2. **Trend gate at each completed 5m bar:** let `M15(t)` = mean(close of last 20 completed 15m bars), and `M15_prev2` = SMA20 two completed 15m bars earlier. Latest completed 15m close `C15 > M15(t)` AND `M15(t) > M15_prev2`. Else `NO_TRADE_TREND`.
3. **Pullback gate:** `M5` = SMA20 of the last 20 completed 5m closes. On the latest completed 5m bar, `low >= M5 - 0.003` and `low <= M5 + 0.003`, `close > open`, `close > M5`. For a strict “not break MA” option, require `low >= M5`; **customer confirmed 3-tick tolerance**. Customer selected the tolerance version. No match → `NO_TRADE_ENTRY`.
4. **Signal timing:** when both gates pass at the close of a completed 5m bar, place a *candidate* buy at the **next** 1m bar open (never the same bar close). One entry per unique 5m signal. If next bar unavailable → `WAIT_NEXT_BAR`.
5. **Hard pre-trade gates in order:** strategy approved; session not locked; before 16:00 cutoff; position flat (no pyramiding); completed trades < 3; valid stop below entry; sufficient mock cash/margin (demo account can set fixed margin reserve). Reject with distinct reason code and audit the rejection.
6. **Stop:** `swing_low = min(low of last 5 completed 5m bars, including the signal bar)`. `stop = floor_to_tick(swing_low - 0.004)`. Entry is next bar open rounded to tick. `R = entry - stop`; if `R <= 0`, reject `INVALID_RISK`.
7. **Target:** `target = ceil_to_tick(entry + 1.2 * R)`. At first touch, close 1 contract. Remaining 1 contract stays open until stop or cutoff. **No new entries while any part remains open.**
8. **Intrabar execution ambiguity:** if both stop and target fall inside the same OHLC bar, conservatively execute stop first (for all remaining contracts), and log `AMBIGUOUS_BAR_STOP_FIRST`. No claim that this replicates real fill order.
9. **Position P&L:** sum each leg's `(exit_price - entry_price) / 0.001 * $10 * contracts`, less assumed costs (zero for demo). A position is `CLOSED` only after both contracts exit. Count one completed trade per fully closed position, not per leg. Net P&L < 0 increments consecutive losses; >= 0 resets count to zero (demo convention).
10. **Circuit breaker:** immediately after second consecutive net-losing **completed position**, set `session_locked=true`, `lock_reason=TWO_CONSECUTIVE_LOSSES`. All subsequent candidate entries are audited as `BLOCKED`, even if trend/entry pass. Lock clears only on explicit **new simulated session**, never on a UI toggle or page refresh.
11. **Session cutoff:** at 16:00 New York simulated time, close all remaining mock contracts at the first available cutoff price, block new entries, and mark `SESSION_CLOSED`. This is a **demo-only cutoff**, not real NG trading hours.
12. **Chop/news gates:** image requests avoiding sideways markets and news spikes but gives no quantitative thresholds. **Do not claim these are automated in MVP.** UI shows `NOT_IMPLEMENTED`; customer can manually pause before events. Never silently invent a news feed.

## D. State machine and event codes
`DRAFT → APPROVED → READY → (WAITING_SIGNAL → CANDIDATE → OPEN → PARTIAL → CLOSED)* → LOCKED | SESSION_CLOSED`.

Every evaluation logs: `timestamp`, `strategy_id`, `signal_bar_id`, `trend_ok`, `entry_ok`, `candidate_action`, `risk_gate_result`, `executed_action`, `reason_code`, `position_id`, `session_locked`, `pnl_usd`, `data_source=MOCK`. Keep `PRISM_CONNECTED` only when verified; otherwise `LOCAL_ONLY`.

## E. Mandatory deterministic test cases
| ID | Given | Expected |
|---|---|---|
| T01 | Completed 15m close above rising SMA20 + qualifying 5m pullback | Candidate long at next 1m open |
| T02 | 15m close below SMA20 | No order (`NO_TRADE_TREND`) |
| T03 | 5m bar not bullish / too far from SMA | No order (`NO_TRADE_ENTRY`) |
| T04 | Valid signal but strategy DRAFT | `BLOCKED_UNAPPROVED` |
| T05 | Entry <= stop or stop missing | `INVALID_RISK` / `MISSING_STOP` |
| T06 | Target 1.2R touched, 2 contracts open | Close exactly 1; one remains |
| T07 | Two net-losing completed positions, then valid third candidate | `BLOCKED:TWO_CONSECUTIVE_LOSSES`; **zero** new fills |
| T08 | 3 completed trades | Further candidates blocked `MAX_TRADES` |
| T09 | Cutoff with open position | Flatten and close session |
| T10 | Same mock seed and fixture | Identical audit and P&L |
| T11 | Stop and target within same 1m bar | Stop first; ambiguity logged |
| T12 | User presses resume after lock | Remains locked until next session |

**T07 demo sequence:** initialize approved strategy with two synthetic losing completed positions (`trade_1=-$80`, `trade_2=-$60`, exact amounts are fixture-only), assert `consecutive_losses=2`, then submit a third otherwise valid signal; engine rejects order and audit contains `TWO_CONSECUTIVE_LOSSES`. This tests the risk gate, **not historical profitability**.

## F. A/B integration contract
- Canonical config: `../contracts/strategy.example.json` (`schema_version=1.0.0`). Do not change its keys without both teammates agreeing. This file specifies evaluation semantics for those fields.
- A displays this preset and explicitly labels all engineering assumptions, especially **4 ticks** and **16:00 demo cutoff**.
- B accepts user inputs → Nicrron converts to structured config → Pydantic validates → A displays for approval → only approved config reaches deterministic simulator.
- Expose agreed v3 endpoints (`POST /api/strategy/generate`, `POST /api/strategy/approve`, `POST /api/simulation/run`, `GET /api/simulation/status`, `GET /api/audit`). Return mock fixture fallback when model/API unavailable, visibly labeled.
- **Accuracy metric:** `compliant_decisions / evaluated_decisions`; denominator includes rejected entry candidates; show raw counts. This is **rule-following accuracy**, not win rate or predictive accuracy.
- “Lightweight generative backtest” means scenario narration and mock outcome simulation; **never call it verified historical backtest** or fabricate win rate.

## G. Four customer-confirmed decisions (2026-10-17)
1. **Moving-average tolerance:** 5m candle low may dip at most **3 ticks** below SMA20; candle must still close bullish and above SMA20.
2. **Stop buffer:** **4 ticks** below the lowest low of the previous 5 completed 5m candles, including the signal candle. With mock `tick_size=0.001`, buffer = `0.004` simulated price units.
3. **Remaining contract:** after the 1.2R partial exit, keep the **original stop unchanged**; exit remaining contract only at original stop or session cutoff.
4. **Direction:** **LONG_ONLY**. No short orders or reversal trades.

These choices are confirmed; other numerical choices in section B are hackathon demo assumptions, not customer-confirmed trading preferences.
