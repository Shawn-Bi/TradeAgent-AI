"""Synthetic NG_SIM 1-minute candles.

Everything here is MOCK data generated in code. Nothing is historical market data.
Prices are built in integer ticks (demo tick 0.001) and exported as floats.

Two kinds of data:
* Crafted fixtures (two-loss-lock, winning-reset, cutoff, ambiguous-bar, trend-fail):
  fixed deterministic paths that exercise one rule each. The seed is recorded but
  does not alter these candles.
* Seeded profiles (standard, trend, range, adverse): random walks from
  ``random.Random(seed)``. Same seed -> identical candles -> identical audit.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from fractions import Fraction
from zoneinfo import ZoneInfo

DATA_SOURCE = "MOCK"
WARMUP_START = time(4, 0)  # synthetic warmup so 22x15m / 20x5m SMA history exists by 09:30
BASE_PRICE_TICKS = 3000  # 3.000 USD/MMBtu demo level
TICK_SIZE = Decimal("0.001")


class FixtureError(ValueError):
    pass


class BuilderError(RuntimeError):
    """A crafted fixture produced an unintended 5m entry signal."""


@dataclass(frozen=True)
class Bar:
    start: datetime
    open: int
    high: int
    low: int
    close: int
    volume: int = 100


@dataclass(frozen=True)
class SignalPlan:
    entry: int
    stop: int
    target: int


def bars_to_candles(bars: list[Bar]) -> list[dict]:
    return [
        {
            "timestamp": b.start.isoformat(),
            "open": float(b.open * TICK_SIZE),
            "high": float(b.high * TICK_SIZE),
            "low": float(b.low * TICK_SIZE),
            "close": float(b.close * TICK_SIZE),
            "volume": b.volume,
        }
        for b in bars
    ]


class SessionBuilder:
    """Builds continuous 1m bars in whole 5m blocks.

    Tracks completed 5m closes/lows so crafted segments can be placed relative to the
    5m SMA using the same formula as the engine. Every block is checked so that a
    crafted fixture never contains an accidental entry signal.
    """

    def __init__(
        self,
        day: date,
        tz: str,
        *,
        price: int = BASE_PRICE_TICKS,
        ma_period: int = 20,
        tolerance_ticks: int = 3,
        lookback: int = 5,
        buffer_ticks: int = 4,
        target_r: Decimal = Decimal("1.2"),
    ):
        self.t = datetime.combine(day, WARMUP_START, tzinfo=ZoneInfo(tz))
        self.price = price
        self.bars: list[Bar] = []
        self.closes5: list[int] = []
        self.lows5: list[int] = []
        self.ma_period = ma_period
        self.tolerance = tolerance_ticks
        self.lookback = lookback
        self.buffer = buffer_ticks
        self.target_r = target_r

    # ---- primitives -------------------------------------------------------
    def _sma_with(self, close: int) -> Fraction:
        window = self.closes5[-(self.ma_period - 1):] + [close]
        return Fraction(sum(window), len(window))

    def block(self, path: list, *, allow_signal: bool = False) -> None:
        """Append one 5m block. ``path`` holds five items: close or (close, low, high)."""
        assert len(path) == 5
        block_open = self.price
        lows = []
        for item in path:
            close, low, high = item if isinstance(item, tuple) else (item, None, None)
            o = self.price
            low = min(o, close) if low is None else low
            high = max(o, close) if high is None else high
            assert low <= min(o, close) and high >= max(o, close), (o, close, low, high)
            self.bars.append(Bar(self.t, o, high, low, close))
            lows.append(low)
            self.t += timedelta(minutes=1)
            self.price = close
        block_close = self.price
        block_low = min(lows)
        if not allow_signal and len(self.closes5) >= self.ma_period - 1:
            ma = self._sma_with(block_close)
            if (
                ma - self.tolerance <= block_low <= ma + self.tolerance
                and block_close > block_open
                and block_close > ma
            ):
                raise BuilderError(f"unintended 5m signal at block ending {self.t.isoformat()}")
        self.closes5.append(block_close)
        self.lows5.append(block_low)

    def _line(self, close: int, wick: int = 1, **kw) -> None:
        """Linear 5m block from current price to ``close`` with small wicks."""
        o = self.price
        path = []
        for k in range(1, 6):
            c = o + round((close - o) * k / 5)
            prev = o + round((close - o) * (k - 1) / 5)
            path.append((c, min(prev, c) - wick, max(prev, c) + wick))
        self.block(path, **kw)

    # ---- segments ---------------------------------------------------------
    def trend(self, n_blocks: int, step: int) -> None:
        for _ in range(n_blocks):
            self._line(self.price + step)

    def trend_until(self, until: time, step: int) -> None:
        while self.t.time() < until:
            self._line(self.price + step)

    def hold_until(self, until: time) -> None:
        """Flat blocks (5m close == open): never bullish, so never a signal."""
        while self.t.time() < until:
            p = self.price
            self.block([(p + 1, p, p + 1), (p, p, p + 1), (p + 1, p, p + 1), (p, p, p + 1), (p, p, p)])

    def pullback_and_signal(self, step: int = 8, gap: int = 2, close_offset: int = 5) -> SignalPlan:
        """Bearish pullback toward the 5m SMA, then one qualifying bullish signal block."""
        for _ in range(20):
            nxt = self.price - step
            if nxt - self._sma_with(nxt) > gap + step:
                self._line(nxt)
            else:
                break
        # Final pullback close c is chosen so that c sits `gap` ticks above the SMA of the
        # *signal* block window: SMA_sig = (S_{P-2} + c + (c + offset)) / P.
        p = self.ma_period
        s_prev = sum(self.closes5[-(p - 2):])
        c = math.ceil(Fraction(p * gap + s_prev + close_offset, p - 2))
        if c >= self.price:
            c = self.price - 1
        self._line(c)  # final pullback block: bearish, so never a signal itself

        o = self.price
        close = o + close_offset
        ma = self._sma_with(close)
        low = math.floor(ma) - 1  # dips <= 2 ticks below SMA (inside the 3-tick tolerance)
        if not low < o - 1:
            raise BuilderError("pullback did not reach the SMA band; adjust fixture segments")
        mid = (o + low) // 2
        self.block(
            [
                (mid, mid, o),
                (low + 1, low, mid),
                (low + 3, low + 1, low + 3),
                (close - 1, low + 3, close - 1),
                (close, close - 1, close),
            ],
            allow_signal=True,
        )
        swing_low = min(self.lows5[-self.lookback:])
        stop = swing_low - self.buffer
        risk = close - stop
        target = close + math.ceil(self.target_r * risk)
        return SignalPlan(entry=close, stop=stop, target=target)

    def stop_out(self, plan: SignalPlan, below: int = 6) -> None:
        """Two bearish blocks from entry through the stop; target never touched."""
        dest = plan.stop - below
        self._line((plan.entry + dest) // 2)
        self._line(dest)

    def target_then_stop(self, plan: SignalPlan) -> None:
        """One bearish 5m block: target hit in minute 2, stop hit later (separate 1m bars)."""
        e, t, s = plan.entry, plan.target, plan.stop
        up = (e + t) // 2
        down = (t + s) // 2
        self.block(
            [
                (up, e, up),
                (t + 1, up, t + 1),
                (down, down, t + 1),
                (s + 2, s + 2, down),
                (s - 3, s - 3, s + 2),
            ]
        )

    def ambiguous(self, plan: SignalPlan, below: int = 6) -> None:
        """First 1m bar after entry spans both stop and target (stop-first convention)."""
        e, t, s = plan.entry, plan.target, plan.stop
        dest = s - below
        self.block(
            [
                (e - 2, s - 1, t + 1),
                (s + 1, s + 1, e - 2),
                (s - 1, s - 1, s + 1),
                (dest + 2, dest + 2, s - 1),
                (dest, dest, dest + 2),
            ]
        )

    def recover(self, above: int = 14) -> None:
        """Strong bullish block from below the SMA (low outside tolerance) back above it."""
        s19 = sum(self.closes5[-(self.ma_period - 1):])
        target = math.ceil(Fraction(20 * above + s19, self.ma_period - 1))
        self._line(max(target, self.price + 1))


# ---- crafted fixtures -------------------------------------------------------

def _builder(day: date, tz: str) -> SessionBuilder:
    b = SessionBuilder(day, tz)
    b.trend(66, 5)  # 04:00 -> 09:30 synthetic warmup (indicator history only)
    return b


def _two_loss_lock(day: date, tz: str) -> list[Bar]:
    b = _builder(day, tz)
    b.trend(6, 5)
    b.stop_out(b.pullback_and_signal())  # P1 loss
    b.recover()
    b.trend(6, 5)
    b.stop_out(b.pullback_and_signal())  # P2 loss -> lock
    b.recover()
    b.trend(6, 5)
    b.pullback_and_signal()  # third otherwise-eligible entry -> must be BLOCKED
    b.recover(above=16)
    b.trend_until(time(16, 0), 3)
    return b.bars


def _winning_reset(day: date, tz: str) -> list[Bar]:
    b = _builder(day, tz)
    b.trend(6, 5)
    b.stop_out(b.pullback_and_signal())  # P1 loss (streak 1)
    b.recover()
    b.trend(6, 5)
    b.target_then_stop(b.pullback_and_signal())  # P2 partial at 1.2R + stop = net win (streak 0)
    b.recover()
    b.trend(6, 5)
    b.stop_out(b.pullback_and_signal())  # P3 loss (streak 1, completed 3)
    b.recover()
    b.trend(6, 5)
    b.pullback_and_signal()  # fourth candidate -> BLOCKED by MAX_TRADES
    b.recover(above=16)
    b.trend_until(time(16, 0), 3)
    return b.bars


def _cutoff(day: date, tz: str) -> list[Bar]:
    b = _builder(day, tz)
    b.trend_until(time(15, 15), 5)
    b.pullback_and_signal()  # late entry; position still open at 16:00
    b.hold_until(time(16, 0))
    return b.bars


def _ambiguous_bar(day: date, tz: str) -> list[Bar]:
    b = _builder(day, tz)
    b.trend(6, 5)
    b.ambiguous(b.pullback_and_signal())
    b.recover()
    b.trend_until(time(16, 0), 3)
    return b.bars


def _trend_fail(day: date, tz: str) -> list[Bar]:
    b = SessionBuilder(day, tz, price=BASE_PRICE_TICKS + 400)
    while b.t.time() < time(16, 0):
        b._line(b.price - 5)  # steady downtrend: 15m close below falling SMA20
    return b.bars


# ---- seeded profiles --------------------------------------------------------

_PROFILES = {
    # drift ticks/min, noise sd, swing amplitude ticks, (switch time, drift after)
    "standard": (0.5, 1.6, 22, None),
    "trend": (0.7, 1.4, 18, None),
    "range": (0.0, 1.6, 20, None),
    "adverse": (0.6, 1.6, 20, (time(11, 0), -1.0)),
}


def _seeded(profile: str, seed: int, day: date, tz: str) -> list[Bar]:
    drift, sd, amp, switch = _PROFILES[profile]
    rng = random.Random(f"{profile}:{seed}")
    period = rng.uniform(55, 85)
    phase = rng.uniform(0, 2 * math.pi)
    t = datetime.combine(day, WARMUP_START, tzinfo=ZoneInfo(tz))
    end = datetime.combine(day, time(16, 0), tzinfo=ZoneInfo(tz))
    level = float(BASE_PRICE_TICKS)
    walk = 0.0
    price = BASE_PRICE_TICKS
    bars = []
    k = 0
    while t < end:
        d = drift
        if switch and t.time() >= switch[0]:
            d = switch[1]
        level += d
        walk += rng.gauss(0, sd)
        target = level + walk + amp * math.sin(2 * math.pi * k / period + phase)
        close = int(round(target))
        o = price
        high = max(o, close) + rng.randint(0, 2)
        low = min(o, close) - rng.randint(0, 2)
        bars.append(Bar(t, o, high, low, close, volume=rng.randint(50, 400)))
        price = close
        t += timedelta(minutes=1)
        k += 1
    return bars


_CRAFTED = {
    "two-loss-lock": (_two_loss_lock, "Crafted path: two losing positions, then a third otherwise-eligible entry"),
    "winning-reset": (_winning_reset, "Crafted path: loss, win (1.2R partial), loss, then a fourth candidate"),
    "cutoff": (_cutoff, "Crafted path: late entry still open at the 16:00 demo cutoff"),
    "ambiguous-bar": (_ambiguous_bar, "Crafted path: one 1m bar touches both stop and target"),
    "trend-fail": (_trend_fail, "Crafted path: steady downtrend, 15m trend gate never passes"),
}

_SEEDED_DESC = {
    "standard": "Seeded synthetic random walk with mild upward drift",
    "trend": "Seeded synthetic uptrend with oscillating pullbacks",
    "range": "Seeded synthetic sideways range, no drift",
    "adverse": "Seeded synthetic uptrend that reverses to a downtrend at 11:00",
}

FIXTURES = sorted([*_CRAFTED, *_SEEDED_DESC])


def get_fixture(name: str, seed: int, day: date, tz: str) -> dict:
    if name in _CRAFTED:
        fn, desc = _CRAFTED[name]
        bars = fn(day, tz)
        seeded = False
    elif name in _SEEDED_DESC:
        bars = _seeded(name, seed, day, tz)
        desc = _SEEDED_DESC[name]
        seeded = True
    else:
        raise FixtureError(f"Unknown fixture '{name}'. Allowed: {', '.join(FIXTURES)}")
    return {
        "fixture": name,
        "description": desc,
        "seed": seed,
        "seed_affects_candles": seeded,
        "data_source": DATA_SOURCE,
        "synthetic": True,
        "candles": bars_to_candles(bars),
    }
