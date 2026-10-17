# StrategySpec v1 field guide (editable fields)

The trader's words become a JSON patch ("overrides") on the frozen StrategySpec v1 preset. Only the
fields below can change. A field the trader did not state keeps its default; never fill it in.
Values outside the limits are rejected by the server and turned into a clarification question.

## Timeframes
- `timeframes.trend_minutes`: int, at most 60, must be a larger multiple of entry_minutes. Default 15
  (15-minute trend chart, "15m", "15 min").
- `timeframes.entry_minutes`: int. Default 5 (5-minute entry chart, "5m").
- 1-minute refinement is disabled; a "1m" or "1 minute" trigger cannot be set.

## Trend filter (15m)
- `trend.period`: int 2..200, SMA period on the trend timeframe. Default 20 ("20 SMA", "20-period moving average").
- `trend.slope_bars`: int 1..20, the SMA must be rising over this many bars. Default 2.
- `trend.require_close_above_ma`: bool, the trend close must be above the SMA. Default true.
- `trend.require_rising_ma`: bool, the SMA must be rising. Default true.

## Entry (5m pullback)
- `entry.ma_period`: int 2..200, SMA period on the entry timeframe. Default 20.
- `entry.tolerance_ticks`: int 0..50, how far in ticks the pullback low may dip below the SMA. Default 3.
- Fixed: the entry bar must close above its open and above the SMA. Moving average type is always SMA.

## Stop
- `stop.lookback_5m_bars`: int 1..50, swing low = lowest low of this many completed entry bars. Default 5.
- `stop.buffer_ticks`: int 0..100, stop = swing low minus this many ticks. Default 4. In ticks only.

## Exit and size
- `exit.target_r`: number greater than 0 and at most 10, profit target as a multiple of initial risk. Default 1.2.
- `exit.first_target_close_contracts`: int, at least 1 and less than quantity_contracts. Default 1.
  This is a contract count, never a percentage. "Take half off" with 4 contracts = 2 contracts; with
  2 contracts = 1. With an odd quantity (3, 5) "half" is not a whole number: ask.
- `quantity_contracts`: int 2..10. Default 2.
- Fixed: the remaining contracts exit only at the original stop or the session cutoff.

## Risk
- `risk.max_completed_trades_per_session`: int 1..20. Default 3 ("max 3 trades a day").
- `risk.consecutive_loss_lock`: int 1..10, lock new entries after this many consecutive losing trades.
  Default 2 ("stop after two losses in a row").
- Fixed: a stop is always required; no overnight positions.

## Session
- `session.cutoff_local`: "HH:MM" America/New_York, flat by then. Default "16:00".
  "Flat by 3:30 pm" = "15:30".

## Never set
schema_version, strategy_id, version, approval_status, simulation_only, account_id, instrument,
direction. Direction is always LONG_ONLY.

## Loosening risk
Raising max trades, the consecutive-loss lock, contracts or the cutoff time loosens the customer's
confirmed rules. Apply the stated value; the server flags it as RISK_LOOSENED for human review.
