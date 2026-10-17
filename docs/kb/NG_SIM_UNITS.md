# NG_SIM units: ticks, not points

NG_SIM is the fictional natural-gas-style instrument of the TradeAgent AI simulation. It is a demo
assumption, not a live contract specification.

## Tick size and tick value

| Unit | Value |
|---|---|
| 1 tick | 0.001 price units |
| 1 tick per contract | $10 |
| 4 ticks | 0.004 price units = $40 per contract |
| 10 ticks | 0.010 price units = $100 per contract |

Every distance field in StrategySpec is in **ticks**: `stop.buffer_ticks` and `entry.tolerance_ticks`.
A trader who says "6 ticks", "6 tick", "six ticks" or "6t" means 6 ticks.

## Points, pips, cents and dollars are NOT ticks

- **Points:** "4 points" has no defined meaning for NG_SIM. A point is not a tick. Do not convert points
  to ticks, do not multiply by 10 or 1000. Leave the field unset and ask the trader to restate it in ticks.
- **Pips:** "40 pips" is a forex unit. It is not a tick. Ask in ticks.
- **Cents:** "half a cent" or "2 cents" are price amounts the trader may mean as 0.005 / 0.02 or as
  something else. Ask the trader to confirm in ticks rather than converting.
- **Dollars:** "$40 stop" or "risk $100" is a money amount per position, not a distance. The stop is
  a tick buffer below the swing low, so a dollar amount cannot be mapped to `stop.buffer_ticks`. Ask.
- **Percent:** "1% stop" is not a tick distance. Ask.
- **Bare numbers:** "stop 5 below the low" with no unit: ask whether 5 means 5 ticks.

## Price-unit decimals

A distance written as a price decimal with the tick size, such as "0.004 below the swing low", equals
4 ticks exactly (0.004 / 0.001). Only convert when the number is an exact multiple of 0.001; otherwise ask.

## R multiples

`exit.target_r` is a multiple of initial risk R, where R = entry price minus stop price.
"1.5R", "1.5 R", "1.5 times risk" and "one and a half times my stop" all mean target_r = 1.5.
"2 to 1", "2:1 reward to risk" means target_r = 2. "Target 15 ticks" is a tick distance, not an R
multiple, so it cannot be mapped to target_r: ask.
