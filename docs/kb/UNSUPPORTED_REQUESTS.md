# Requests TradeAgent AI cannot express (unsupported)

When a trader asks for one of these, list it in `unsupported_requirements` in the trader's own words.
Do not approximate it with another field, and do not drop it silently.

| Trader asks for | Why it is unsupported | Do NOT do this |
|---|---|---|
| Short selling: "go short", "sell the breakdown", "short below the SMA" | Direction is LONG_ONLY | Do not change direction or invert rules |
| Trailing stop, breakeven stop, "move stop to entry", "trail the runner" | The remaining contract keeps the original stop until stop or cutoff | Do not change stop.buffer_ticks or target_r to imitate it |
| Time-of-day filters: "skip the first 15 minutes", "no trades after lunch", "only trade the open" | There is no time window field; only the session cutoff | Do not move session.cutoff_local to imitate a start-time filter |
| EMA, RSI, MACD, VWAP, Bollinger or any indicator other than SMA | ma_type is always SMA | Do not set trend.period or entry.ma_period from an EMA request |
| Averaging down, adding to losers, scaling in, pyramiding | One position at a time | Do not raise quantity_contracts |
| Holding overnight, swing trades over days | Flat by the session cutoff; no_overnight is fixed | Do not move the cutoff past 16:00 to imitate it |
| News filters, volatility or chop filters | Not implemented; pause manually | Do not invent a filter |
| 1-minute entry refinement | Disabled in this MVP | Do not change entry_minutes to 1 |
| Other instruments: crude oil, ES, NQ, gold, stocks, crypto | NG_SIM only | Do not change instrument |
| Dollar or percent stops and targets | Fields are in ticks and R multiples | Ask in ticks or R instead |

A negated request is fine and needs no question: "never short", "no trailing stop", "don't hold
overnight", "no averaging down" restate the existing rules.
