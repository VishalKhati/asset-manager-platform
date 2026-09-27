"""Strategy and policy parameters.

JSON keys are camelCase and identical to ``StrategyParams`` in ``lib/strategy/src/params.ts``.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, fields


@dataclass(frozen=True)
class Session:
    tz: str
    start: str  # "HH:MM" local time, inclusive
    end: str  # "HH:MM" local time, exclusive

    def to_json(self) -> dict:
        return {"tz": self.tz, "start": self.start, "end": self.end}


def _default_sessions() -> tuple[Session, ...]:
    return (
        Session("Europe/London", "07:00", "16:00"),
        Session("America/New_York", "08:00", "16:00"),
    )


@dataclass(frozen=True)
class Params:
    # Trend bias (M15)
    emaFast: int = 20
    emaSlow: int = 50
    emaTrend: int = 200
    # Trigger (M5)
    stochK: int = 5
    stochSmooth: int = 3
    stochD: int = 3
    stochLow: float = 20.0
    stochHigh: float = 80.0
    pullbackBars: int = 3
    # Risk
    atrPeriod: int = 14
    slAtrMult: float = 1.5
    swingBars: int = 10
    swingBufferAtr: float = 0.1
    tp1R: float = 1.0
    tp2R: float = 2.0
    tp1Fraction: float = 0.5
    validMin: int = 30
    entryToleranceR: float = 0.25
    maxHoldMin: int = 240
    # Filters
    sessions: tuple[Session, ...] = field(default_factory=_default_sessions)
    fridayCutoffUtc: str = "20:00"
    fridayExitUtc: str = "20:45"
    newsBlackoutMin: int = 15
    maxSpread: float = 1.0
    maxSpreadAtrFrac: float = 0.25
    atrMinBps: float = 1.5
    atrMaxBps: float = 30.0
    cooldownAfterLossMin: int = 60
    # Costs, in price units per unit of the instrument (1 oz for XAUUSD)
    commission: float = 0.06
    slippage: float = 0.05
    # Warm-up: bars required before the first evaluation
    warmupM5: int = 150
    warmupM15: int = 600

    def to_json(self) -> dict:
        out = asdict(self)
        out["sessions"] = [s.to_json() for s in self.sessions]
        return out

    @classmethod
    def from_json(cls, data: dict) -> Params:
        known = {f.name for f in fields(cls)}
        unknown = set(data) - known
        if unknown:
            raise ValueError(f"unknown params: {sorted(unknown)}")
        kwargs = dict(data)
        if "sessions" in kwargs:
            kwargs["sessions"] = tuple(Session(**s) for s in kwargs["sessions"])
        return cls(**kwargs)

    def replace(self, **changes) -> Params:
        data = self.to_json()
        data.update(changes)
        if "sessions" in changes and changes["sessions"] and isinstance(changes["sessions"][0], Session):
            data["sessions"] = [s.to_json() for s in changes["sessions"]]
        return Params.from_json(data)


def hhmm_to_minutes(value: str) -> int:
    hours, minutes = value.split(":")
    return int(hours) * 60 + int(minutes)
