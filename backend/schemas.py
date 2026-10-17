"""Pydantic models mirroring contracts/strategy.example.json (StrategySpec v1).

Field names are frozen. ``extra="forbid"`` rejects unknown keys so no second schema can
creep in. Literal types encode the MVP invariants (long only, simulation only, 1m off).
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Instrument(_Strict):
    symbol: Literal["NG_SIM"]
    venue: str
    tick_size: float = Field(gt=0)
    tick_value_usd: float = Field(gt=0)
    currency: Literal["USD"]
    specification: Literal["DEMO_ASSUMPTION_NOT_LIVE"]


class Timeframes(_Strict):
    trend_minutes: int = Field(ge=1, le=60)
    entry_minutes: int = Field(ge=1, le=60)
    refine_minutes: None = Field(default=None, description="1m refinement disabled in MVP")

    @model_validator(mode="after")
    def _multiples(self):
        if self.trend_minutes <= self.entry_minutes or self.trend_minutes % self.entry_minutes:
            raise ValueError("trend_minutes must be a larger multiple of entry_minutes")
        return self


class Trend(_Strict):
    ma_type: Literal["SMA"]
    period: int = Field(ge=2, le=200)
    slope_bars: int = Field(ge=1, le=20)
    require_close_above_ma: bool
    require_rising_ma: bool


class Entry(_Strict):
    type: Literal["PULLBACK_HOLD_BULLISH"]
    ma_type: Literal["SMA"]
    ma_period: int = Field(ge=2, le=200)
    tolerance_ticks: int = Field(ge=0, le=50)
    confirmation: Literal["CLOSE_GT_OPEN_AND_CLOSE_GT_MA"]
    one_entry_per_signal: Literal[True]


class Stop(_Strict):
    type: Literal["SWING_LOW_BUFFER"]
    lookback_5m_bars: int = Field(ge=1, le=50)
    buffer_ticks: int = Field(ge=0, le=100)


class Exit(_Strict):
    target_r: float = Field(gt=0, le=10)
    first_target_close_contracts: int = Field(ge=1)
    remaining_contracts_exit: Literal["STOP_OR_SESSION_CUTOFF"]


class Risk(_Strict):
    max_completed_trades_per_session: int = Field(ge=1, le=20)
    consecutive_loss_lock: int = Field(ge=1, le=10)
    stop_required: Literal[True]
    no_overnight: Literal[True]


class Session(_Strict):
    timezone: str
    demo_date: str
    cutoff_local: str
    demo_only: Literal[True]

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v):
        ZoneInfo(v)
        return v

    @field_validator("demo_date")
    @classmethod
    def _date(cls, v):
        date.fromisoformat(v)
        return v

    @field_validator("cutoff_local")
    @classmethod
    def _cutoff(cls, v):
        datetime.strptime(v, "%H:%M")
        return v


class StrategySpec(_Strict):
    schema_version: Literal["1.0.0"]
    strategy_id: str = Field(min_length=1, max_length=64)
    version: int = Field(ge=1)
    instrument: Instrument
    account_id: str
    direction: Literal["LONG_ONLY"]
    timeframes: Timeframes
    trend: Trend
    entry: Entry
    stop: Stop
    exit: Exit
    quantity_contracts: int = Field(ge=2, le=10)
    risk: Risk
    session: Session
    approval_status: Literal["DRAFT", "APPROVED"]
    simulation_only: Literal[True]

    @model_validator(mode="after")
    def _partial_exit(self):
        if self.exit.first_target_close_contracts >= self.quantity_contracts:
            raise ValueError("exit.first_target_close_contracts must be less than quantity_contracts")
        return self


# ---- requests ---------------------------------------------------------------

class GenerateRequest(_Strict):
    template_id: str = "ng-long-pullback-v1"
    overrides: dict = Field(default_factory=dict)
    free_text: str = Field(default="", max_length=4000)


class StrategyRef(_Strict):
    strategy_id: str
    version: int = Field(ge=1)


class ScenarioRequest(StrategyRef):
    seed: int = 42


class SimulationStartRequest(StrategyRef):
    seed: int = 42
    fixture: str = "standard"
