# First customer: confirmed rules and demo defaults

The demo preset (StrategySpec v1, strategy ng-demo-v1) encodes the first customer's NG_SIM long
pullback strategy. These are the defaults a trader's text is applied on top of.

## Customer-confirmed (2026-10-17)
1. **Moving-average tolerance:** the 5m pullback low may dip at most 3 ticks below the 5m SMA20; the
   candle must still close bullish (close above open) and above the SMA20. `entry.tolerance_ticks = 3`.
2. **Stop buffer:** 4 ticks below the lowest low of the previous 5 completed 5m candles.
   `stop.buffer_ticks = 4`, `stop.lookback_5m_bars = 5`. The customer's original screenshot said
   "3 to 5 points"; the customer chose 4 ticks for the demo. Points were never converted to ticks.
3. **Remaining contract:** after the first target, keep the original stop unchanged. No breakeven
   and no trailing stop.
4. **Direction:** LONG_ONLY. No short orders or reversal trades.

## Demo defaults (engineering choices, may be changed by the trader's stated values)
- Trend: 15m close above a rising SMA20 (rising over 2 bars).
- Size: 2 contracts. First target 1.2R closes 1 contract ("take half off" with 2 contracts).
- Max 3 completed trades per session; lock new entries after 2 consecutive losing trades.
- Flat by 16:00 America/New_York (demo cutoff, not real exchange hours).
- Zero fees and slippage. Synthetic data only, not a historical backtest.

## Safety rules that never change
The model only proposes a DRAFT. A human approves it; a deterministic engine runs it with the risk
gate on. The two-loss lock cannot be disabled ("ignore the loss limit" is not a supported value; the
lock is 1 to 10 losses). No real orders, no investment advice.
