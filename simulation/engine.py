"""Deterministic paper-trading engine for StrategySpec v1 (simulation only).

Public API (imported by the FastAPI backend, no second server):
    run_simulation(strategy, seed, fixture, candles=None) -> dict
    get_report(result) -> dict

Rules implemented exactly as docs/FIRST_CUSTOMER_STRATEGY.md section C. All
arithmetic is in integer ticks / exact fractions, so the same candles always produce
the same audit and P&L. No broker connection exists; "fills" are ledger rows.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_EVEN, Decimal
from fractions import Fraction
from zoneinfo import ZoneInfo

from .candles import DATA_SOURCE, get_fixture
from .risk import SessionRiskState, pre_trade_gates

STARTING_EQUITY_USD = 100_000.0
DEMO_MARGIN_PER_CONTRACT_USD = 5_000.0  # demo assumption, not an exchange margin figure
DISCLAIMER = "Synthetic demo, not historical backtest"
PRISM_STATUS = "LOCAL_ONLY"  # no verified PRISM integration
ORDER_ACTIONS = {"OPEN_LONG", "EXIT_PARTIAL", "EXIT_STOP", "EXIT_CUTOFF"}
ASSUMPTIONS = [
    "Synthetic MOCK candles generated in code; not historical market data",
    "Fills at trigger price; fees and slippage assumed zero",
    "Demo tick 0.001 = $10 per contract (DEMO_ASSUMPTION_NOT_LIVE)",
    "Demo session cutoff 16:00 America/New_York (not real NG exchange hours)",
    "Intrabar stop/target tie resolved stop-first (conservative)",
    "Chop/news filters NOT_IMPLEMENTED in MVP",
]


@dataclass(frozen=True)
class _Bar:
    start: datetime
    end: datetime
    open: int
    high: int
    low: int
    close: int


@dataclass(frozen=True)
class _Config:
    strategy_id: str
    version: int
    account_id: str
    approved: bool
    tick: Decimal
    tick_value: float
    tz: ZoneInfo
    day: date
    cutoff: datetime
    trend_minutes: int
    entry_minutes: int
    trend_period: int
    slope_bars: int
    require_close_above: bool
    require_rising: bool
    entry_period: int
    tolerance: int
    lookback: int
    buffer: int
    target_r: Decimal
    first_close: int
    quantity: int
    max_trades: int
    loss_lock: int

    @classmethod
    def from_strategy(cls, s: dict) -> "_Config":
        tz = ZoneInfo(s["session"]["timezone"])
        day = date.fromisoformat(s["session"]["demo_date"])
        hh, mm = (int(x) for x in s["session"]["cutoff_local"].split(":"))
        return cls(
            strategy_id=s["strategy_id"],
            version=int(s["version"]),
            account_id=s["account_id"],
            approved=s.get("approval_status") == "APPROVED",
            tick=Decimal(str(s["instrument"]["tick_size"])),
            tick_value=float(s["instrument"]["tick_value_usd"]),
            tz=tz,
            day=day,
            cutoff=datetime.combine(day, time(hh, mm), tzinfo=tz),
            trend_minutes=int(s["timeframes"]["trend_minutes"]),
            entry_minutes=int(s["timeframes"]["entry_minutes"]),
            trend_period=int(s["trend"]["period"]),
            slope_bars=int(s["trend"]["slope_bars"]),
            require_close_above=bool(s["trend"]["require_close_above_ma"]),
            require_rising=bool(s["trend"]["require_rising_ma"]),
            entry_period=int(s["entry"]["ma_period"]),
            tolerance=int(s["entry"]["tolerance_ticks"]),
            lookback=int(s["stop"]["lookback_5m_bars"]),
            buffer=int(s["stop"]["buffer_ticks"]),
            target_r=Decimal(str(s["exit"]["target_r"])),
            first_close=int(s["exit"]["first_target_close_contracts"]),
            quantity=int(s["quantity_contracts"]),
            max_trades=int(s["risk"]["max_completed_trades_per_session"]),
            loss_lock=int(s["risk"]["consecutive_loss_lock"]),
        )

    def px(self, ticks) -> float:
        """Ticks (int or Fraction) -> price float."""
        if isinstance(ticks, Fraction):
            return round(float(ticks) * float(self.tick), 4)
        return float(Decimal(ticks) * self.tick)


def _to_bars(candles: list[dict], cfg: _Config) -> list[_Bar]:
    bars = []
    prev = None
    for c in candles:
        start = datetime.fromisoformat(c["timestamp"])
        if start.tzinfo is None:
            raise ValueError("candle timestamps must include a UTC offset")
        start = start.astimezone(cfg.tz)
        if prev is not None and start <= prev:
            raise ValueError("candles must be strictly increasing in time")
        o, h, l, cl = (
            int((Decimal(str(c[k])) / cfg.tick).to_integral_value(ROUND_HALF_EVEN))
            for k in ("open", "high", "low", "close")
        )
        if not (l <= min(o, cl) and h >= max(o, cl)):
            raise ValueError(f"invalid OHLC at {c['timestamp']}")
        bars.append(_Bar(start, start + timedelta(minutes=1), o, h, l, cl))
        prev = start
    return bars


def _aggregate(bars: list[_Bar], minutes: int) -> list[_Bar]:
    out: list[_Bar] = []
    key = None
    group: list[_Bar] = []

    def flush():
        if group:
            midnight = group[0].start.replace(hour=0, minute=0, second=0, microsecond=0)
            start = midnight + timedelta(minutes=key[1] * minutes)
            out.append(_Bar(start, start + timedelta(minutes=minutes), group[0].open,
                            max(b.high for b in group), min(b.low for b in group), group[-1].close))

    for b in bars:
        k = (b.start.date(), (b.start.hour * 60 + b.start.minute) // minutes)
        if k != key:
            flush()
            key, group = k, []
        group.append(b)
    flush()
    return out


@dataclass
class _Position:
    position_id: str
    signal_bar_id: str
    entry_time: datetime
    entry: int
    stop: int
    target: int
    quantity: int
    open_contracts: int
    status: str = "OPEN"
    legs: list = field(default_factory=list)
    realized: float = 0.0
    result: str | None = None


class _Simulator:
    def __init__(self, cfg: _Config, bars: list[_Bar]):
        self.cfg = cfg
        self.bars = bars
        self.agg5 = _aggregate(bars, cfg.entry_minutes)
        self.agg15 = _aggregate(bars, cfg.trend_minutes)
        self.state = SessionRiskState(cfg.max_trades, cfg.loss_lock)
        self.events: list[dict] = []
        self.fills: list[dict] = []
        self.completed: list[_Position] = []
        self.position: _Position | None = None
        self.realized = 0.0
        self.n5 = 0
        self.n15 = 0
        self.wait_logged = False
        self.session_closed = False
        self.positions_opened = 0

    @property
    def equity(self) -> float:
        return STARTING_EQUITY_USD + self.realized

    # ---- audit helpers ----------------------------------------------------
    def _event(self, t: datetime, rule_id: str, expected: str, code: str, reason: str, *,
               category: str, eligible: bool = True, planned: tuple | None = None, **extra) -> dict:
        seq = len(self.events) + 1
        e = {
            "event_id": f"evt-{seq}",
            "seq": seq,
            "timestamp": t.isoformat(),
            "rule_id": rule_id,
            "expected_action": expected,
            "actual_action": None,
            "compliant": None,
            "reason": reason,
            "reason_code": code,
            "category": category,
            "eligible": eligible,
            "strategy_id": self.cfg.strategy_id,
            "version": self.cfg.version,
            "signal_bar_id": None,
            "trend_ok": None,
            "entry_ok": None,
            "candidate_action": None,
            "risk_gate_result": None,
            "position_id": None,
            "session_locked": self.state.entry_locked,
            "price": None,
            "pnl_usd": None,
            "data_source": DATA_SOURCE,
            "details": {},
        }
        e.update(extra)
        e["_planned"] = planned
        self.events.append(e)
        return e

    def _fill(self, evt: dict, t: datetime, pos_id: str, side: str, contracts: int, price: int) -> None:
        self.fills.append({
            "fill_id": f"fill-{len(self.fills) + 1}",
            "timestamp": t.isoformat(),
            "position_id": pos_id,
            "side": side,
            "contracts": contracts,
            "price_ticks": price,
            "action": evt["expected_action"],
            "decision_ref": evt["event_id"],
        })

    # ---- main loop --------------------------------------------------------
    def run(self) -> None:
        cfg = self.cfg
        if not self.bars:
            self._event(cfg.cutoff, "DATA_HISTORY", "WAIT", "WAIT_INSUFFICIENT_HISTORY",
                        "No candle data supplied", category="DATA", eligible=False)
            self._close_session(cfg.cutoff, None, "SESSION_CLOSED")
            return
        for i, bar in enumerate(self.bars):
            if bar.start >= cfg.cutoff:
                self._close_session(cfg.cutoff, self.bars[i - 1].close if i else bar.open, "SESSION_CLOSED")
                return
            self._boundary(bar.start, bar)
            self._process_exits(bar)
        last = self.bars[-1]
        if last.end >= cfg.cutoff:
            self._close_session(cfg.cutoff, last.close, "SESSION_CLOSED")
        else:
            self._boundary(last.end, None)
            self._close_session(last.end, last.close, "DATA_END_BEFORE_CUTOFF")

    def _boundary(self, t: datetime, next_bar: _Bar | None) -> None:
        while self.n15 < len(self.agg15) and self.agg15[self.n15].end <= t:
            self.n15 += 1
        while self.n5 < len(self.agg5) and self.agg5[self.n5].end <= t:
            self.n5 += 1
            self._evaluate(self.n5, t, next_bar)

    def _evaluate(self, n5: int, t: datetime, next_bar: _Bar | None) -> None:
        cfg = self.cfg
        bar5 = self.agg5[n5 - 1]
        sig_id = f"{cfg.entry_minutes}m-{bar5.start.isoformat()}"
        closes15 = [b.close for b in self.agg15[: self.n15]]
        need15 = cfg.trend_period + cfg.slope_bars
        if len(closes15) < need15 or n5 < cfg.entry_period:
            if not self.wait_logged:
                self._event(t, "DATA_HISTORY", "WAIT", "WAIT_INSUFFICIENT_HISTORY",
                            f"Need {need15} completed {cfg.trend_minutes}m and {cfg.entry_period} completed "
                            f"{cfg.entry_minutes}m bars; have {len(closes15)} and {n5} (synthetic warmup). "
                            "Repeated waits are not logged.",
                            category="DATA", eligible=False, signal_bar_id=sig_id)
                self.wait_logged = True
            return

        P, k = cfg.trend_period, cfg.slope_bars
        m15 = Fraction(sum(closes15[-P:]), P)
        m15_prev = Fraction(sum(closes15[-P - k:-k]), P)
        c15 = closes15[-1]
        close_above = c15 > m15
        rising = m15 > m15_prev
        trend_ok = (close_above or not cfg.require_close_above) and (rising or not cfg.require_rising)

        closes5 = [b.close for b in self.agg5[n5 - cfg.entry_period:n5]]
        m5 = Fraction(sum(closes5), cfg.entry_period)
        in_band = m5 - cfg.tolerance <= bar5.low <= m5 + cfg.tolerance
        bullish = bar5.close > bar5.open
        above = bar5.close > m5
        entry_ok = in_band and bullish and above

        details = {
            "c15": cfg.px(c15), "sma15": cfg.px(m15), "sma15_prev": cfg.px(m15_prev),
            "bar5_open": cfg.px(bar5.open), "bar5_low": cfg.px(bar5.low), "bar5_close": cfg.px(bar5.close),
            "sma5": cfg.px(m5), "tolerance_ticks": cfg.tolerance,
        }
        ctx = dict(signal_bar_id=sig_id, trend_ok=trend_ok, entry_ok=entry_ok, details=details)

        if not trend_ok:
            why = []
            if cfg.require_close_above and not close_above:
                why.append(f"15m close {cfg.px(c15)} <= SMA{P} {cfg.px(m15)}")
            if cfg.require_rising and not rising:
                why.append(f"15m SMA{P} not rising over {k} bars")
            self._event(t, "TREND_15M_SMA20", "NO_TRADE", "NO_TRADE_TREND", "; ".join(why),
                        category="SIGNAL", **ctx)
            return
        if not entry_ok:
            why = []
            if not in_band:
                why.append(f"5m low {cfg.px(bar5.low)} not within {cfg.tolerance} ticks of SMA{cfg.entry_period} {cfg.px(m5)}")
            if not bullish:
                why.append("5m bar not bullish (close <= open)")
            if not above:
                why.append("5m close not above SMA")
            self._event(t, "ENTRY_5M_PULLBACK", "NO_TRADE", "NO_TRADE_ENTRY", "; ".join(why),
                        category="SIGNAL", **ctx)
            return

        candidate = f"BUY_{cfg.quantity}"
        if next_bar is None:
            self._event(t, "ENTRY_5M_PULLBACK", "WAIT", "WAIT_NEXT_BAR",
                        "Signal passed but no next 1m bar is available", category="SIGNAL",
                        candidate_action=candidate, **ctx)
            return

        entry = next_bar.open
        lows = [b.low for b in self.agg5[max(0, n5 - cfg.lookback):n5]]
        stop = min(lows) - cfg.buffer if len(lows) == cfg.lookback else None
        gate = pre_trade_gates(
            approved=cfg.approved, state=self.state, entry_time=next_bar.start, cutoff=cfg.cutoff,
            position_open=self.position is not None, entry_ticks=entry, stop_ticks=stop,
            equity_usd=self.equity, quantity=cfg.quantity, margin_per_contract_usd=DEMO_MARGIN_PER_CONTRACT_USD,
        )
        if not gate.passed:
            self._event(t, gate.rule_id, "BLOCK_ENTRY", gate.reason_code, gate.message, category="RISK_GATE",
                        candidate_action=candidate, risk_gate_result=f"BLOCKED:{gate.reason_code}",
                        price=cfg.px(entry), **ctx)
            return
        self._open(next_bar.start, entry, stop, sig_id, candidate, ctx)

    def _open(self, t: datetime, entry: int, stop: int, sig_id: str, candidate: str, ctx: dict) -> None:
        cfg = self.cfg
        risk = entry - stop
        target = entry + math.ceil(cfg.target_r * risk)
        self.positions_opened += 1
        pos_id = f"P{self.positions_opened}"
        evt = self._event(
            t, "ENTRY_5M_PULLBACK", "OPEN_LONG", "ENTRY_FILLED",
            f"Paper buy {cfg.quantity} @ {cfg.px(entry)} (next 1m open); stop {cfg.px(stop)} = swing low - "
            f"{cfg.buffer} ticks, risk {risk} ticks; target {cfg.px(target)} = {cfg.target_r}R",
            category="EXECUTION", planned=("BUY", cfg.quantity, entry), position_id=pos_id,
            candidate_action=candidate, risk_gate_result="PASS", price=cfg.px(entry), **ctx,
        )
        self._fill(evt, t, pos_id, "BUY", cfg.quantity, entry)
        self.position = _Position(pos_id, sig_id, t, entry, stop, target, cfg.quantity, cfg.quantity)

    def _process_exits(self, bar: _Bar) -> None:
        p = self.position
        if p is None:
            return
        hit_stop = bar.low <= p.stop
        hit_target = p.status == "OPEN" and bar.high >= p.target
        if hit_stop and hit_target:
            self._exit(bar.start, p.open_contracts, p.stop, "EXIT_STOP", "EXIT_STOP", "AMBIGUOUS_BAR_STOP_FIRST",
                       "Stop and target inside the same 1m bar; conservative stop-first for all remaining contracts")
        elif hit_stop:
            self._exit(bar.start, p.open_contracts, p.stop, "EXIT_STOP", "EXIT_STOP", "STOP_HIT",
                       "Protective stop touched")
        elif hit_target:
            self._exit(bar.start, self.cfg.first_close, p.target, "EXIT_PARTIAL", "EXIT_TARGET",
                       "TARGET_PARTIAL_EXIT",
                       f"{self.cfg.target_r}R target touched; close {self.cfg.first_close} contract(s), "
                       "remainder keeps original stop")

    def _exit(self, t: datetime, contracts: int, price: int, action: str, rule_id: str, code: str, msg: str) -> None:
        cfg, p = self.cfg, self.position
        pnl = round((price - p.entry) * cfg.tick_value * contracts, 2)
        evt = self._event(t, rule_id, action, code, f"{msg}: sell {contracts} @ {cfg.px(price)}",
                          category="EXECUTION", planned=("SELL", contracts, price), position_id=p.position_id,
                          price=cfg.px(price), pnl_usd=pnl, signal_bar_id=p.signal_bar_id)
        self._fill(evt, t, p.position_id, "SELL", contracts, price)
        p.legs.append({"exit_time": t.isoformat(), "contracts": contracts, "exit_price": cfg.px(price),
                       "exit_reason": code, "pnl_usd": pnl})
        p.open_contracts -= contracts
        if p.open_contracts == 0:
            self._close_position(t)
        else:
            p.status = "PARTIAL"

    def _close_position(self, t: datetime) -> None:
        p = self.position
        p.realized = round(sum(leg["pnl_usd"] for leg in p.legs), 2)
        self.realized = round(self.realized + p.realized, 2)
        info = self.state.record_closed_position(p.realized)
        p.status, p.result = "CLOSED", info["result"]
        self.completed.append(p)
        self.position = None
        loss = p.realized < 0
        self._event(t, "RISK_LOSS_STREAK", "COUNT_LOSS" if loss else "RESET_STREAK", "POSITION_CLOSED",
                    f"{p.position_id} fully closed, net {p.realized:+.2f} USD ({p.result}); "
                    f"consecutive_losses={self.state.consecutive_losses}, "
                    f"completed_trades={self.state.completed_trades}/{self.cfg.max_trades}",
                    category="RISK", position_id=p.position_id, pnl_usd=p.realized,
                    details={"consecutive_losses": self.state.consecutive_losses,
                             "completed_trades": self.state.completed_trades})
        if info["newly_loss_locked"]:
            self._event(t, "RISK_TWO_LOSSES", "LOCK_ENTRIES", "TWO_CONSECUTIVE_LOSSES",
                        f"{self.cfg.loss_lock} consecutive completed losing positions; new entries locked "
                        "until the next simulated session", category="RISK_LOCK")
        if info["newly_max_trades"]:
            self._event(t, "RISK_MAX_TRADES", "LOCK_ENTRIES", "MAX_TRADES",
                        f"{self.cfg.max_trades} completed positions; no further entries this session",
                        category="RISK_LOCK")

    def _close_session(self, t: datetime, price: int | None, code: str) -> None:
        if self.position is not None and price is not None:
            self._exit(t, self.position.open_contracts, price, "EXIT_CUTOFF", "RISK_SESSION_CUTOFF", "CUTOFF_EXIT",
                       "Demo session cutoff: flatten remaining contracts")
        cutoff_txt = self.cfg.cutoff.strftime("%H:%M")
        self._event(t, "RISK_SESSION_CUTOFF", "CLOSE_SESSION", code,
                    f"Session closed ({cutoff_txt} {self.cfg.tz.key} demo cutoff): flat, no new entries",
                    category="SESSION")
        self.session_closed = True


def reconcile(events: list[dict], fills: list[dict]) -> int:
    """Fill actual_action/compliant by checking each decision against the paper ledger.

    Returns the number of orphan fills (ledger rows not linked to an order decision).
    """
    by_ref: dict[str, list[dict]] = defaultdict(list)
    for f in fills:
        by_ref[f["decision_ref"]].append(f)
    seq_of = {e["event_id"]: e["seq"] for e in events}
    order_ids = {e["event_id"] for e in events if e["expected_action"] in ORDER_ACTIONS}
    orphans = sum(1 for f in fills if f["decision_ref"] not in order_ids)

    def fill_seq(f):
        return seq_of.get(f["decision_ref"], 10**9)

    for e in events:
        exp = e["expected_action"]
        linked = by_ref.get(e["event_id"], [])
        if exp in ORDER_ACTIONS:
            side, qty, price = e["_planned"]
            ok = (len(linked) == 1 and linked[0]["side"] == side and linked[0]["contracts"] == qty
                  and linked[0]["price_ticks"] == price)
            actual = exp if ok else ("NO_ORDER" if not linked else "MISMATCHED_FILL")
        elif exp == "LOCK_ENTRIES":
            later = [f for f in fills if f["side"] == "BUY" and fill_seq(f) > e["seq"]]
            actual = "ENTRY_AFTER_LOCK" if later else exp
        elif exp == "CLOSE_SESSION":
            net = sum(f["contracts"] if f["side"] == "BUY" else -f["contracts"] for f in fills)
            later = [f for f in fills if fill_seq(f) > e["seq"]]
            actual = exp if net == 0 and not later else "NOT_FLAT_AFTER_CUTOFF"
        elif exp in ("COUNT_LOSS", "RESET_STREAK"):
            pos = [f for f in fills if f["position_id"] == e["position_id"]]
            ledger = sum((f["price_ticks"] if f["side"] == "SELL" else -f["price_ticks"]) * f["contracts"] for f in pos)
            actual = "COUNT_LOSS" if ledger < 0 else "RESET_STREAK"
        else:  # NO_TRADE / BLOCK_ENTRY / WAIT: no order may exist
            actual = "OPEN_LONG" if linked else exp
        e["actual_action"] = actual
        e["compliant"] = actual == exp
    return orphans


def _position_dict(p: _Position, cfg: _Config) -> dict:
    return {
        "position_id": p.position_id,
        "status": p.status,
        "signal_bar_id": p.signal_bar_id,
        "entry_time": p.entry_time.isoformat(),
        "entry_price": cfg.px(p.entry),
        "stop_price": cfg.px(p.stop),
        "target_price": cfg.px(p.target),
        "initial_risk_ticks": p.entry - p.stop,
        "quantity_contracts": p.quantity,
        "open_contracts": p.open_contracts,
        "legs": list(p.legs),
        "realized_pnl_usd": p.realized,
        "result": p.result,
    }


def run_simulation(strategy: dict, seed: int = 42, fixture: str = "standard",
                   candles: list[dict] | None = None, simulation_id: str | None = None) -> dict:
    cfg = _Config.from_strategy(strategy)
    if candles is None:
        fx = get_fixture(fixture, seed, cfg.day, cfg.tz.key)
        candles = fx["candles"]
        meta = {k: fx[k] for k in ("description", "seed_affects_candles")}
    else:
        meta = {"description": "Caller-supplied synthetic candles", "seed_affects_candles": False}
    sim = _Simulator(cfg, _to_bars(candles, cfg))
    sim.run()
    orphans = reconcile(sim.events, sim.fills)

    events = [{k: v for k, v in e.items() if k != "_planned"} for e in sim.events]
    fills = [{**{k: v for k, v in f.items() if k != "price_ticks"}, "price": cfg.px(f["price_ticks"])}
             for f in sim.fills]
    result = {
        "simulation_id": simulation_id or f"sim-{seed}-{fixture}-v{cfg.version}",
        "status": "COMPLETED",
        "account_id": cfg.account_id,
        "equity_usd": round(sim.equity, 2),
        "positions": [_position_dict(sim.position, cfg)] if sim.position else [],
        "completed_trades": [_position_dict(p, cfg) for p in sim.completed],
        "consecutive_losses": sim.state.consecutive_losses,
        "entry_locked": sim.state.entry_locked,
        "lock_reason": sim.state.lock_reason,
        "prism_status": PRISM_STATUS,
        # additive fields (not in the frozen sample, safe to ignore)
        "strategy_id": cfg.strategy_id,
        "version": cfg.version,
        "seed": seed,
        "fixture": fixture,
        "fixture_description": meta["description"],
        "seed_affects_candles": meta["seed_affects_candles"],
        "synthetic": True,
        "data_source": DATA_SOURCE,
        "session_status": "SESSION_CLOSED" if sim.session_closed else "OPEN",
        "starting_equity_usd": STARTING_EQUITY_USD,
        "realized_pnl_usd": sim.realized,
        "completed_trade_count": sim.state.completed_trades,
        "blocked_entry_count": sum(1 for e in events if e["expected_action"] == "BLOCK_ENTRY"),
        "candle_count": len(candles),
        "fills": fills,
        "assumptions": ASSUMPTIONS,
        "events": events,
        "orphan_fills": orphans,
    }
    return result


def get_report(result: dict) -> dict:
    eligible = [e for e in result["events"] if e["eligible"]]
    compliant = [e for e in eligible if e["compliant"]]
    conformance = round(len(compliant) / len(eligible), 4) if eligible else None
    return {
        "simulation_id": result["simulation_id"],
        "synthetic": True,
        "eligible_decisions": len(eligible),
        "compliant_decisions": len(compliant),
        "execution_conformance": conformance,
        "violations": len(eligible) - len(compliant) + result.get("orphan_fills", 0),
        "disclaimer": DISCLAIMER,
        # additive
        "metric": "Rule-following accuracy = compliant / eligible decisions (not win rate)",
        "blocked_entries": result["blocked_entry_count"],
        "completed_trades": result["completed_trade_count"],
        "realized_pnl_usd": result["realized_pnl_usd"],
        "data_source": DATA_SOURCE,
        "prism_status": result["prism_status"],
    }
