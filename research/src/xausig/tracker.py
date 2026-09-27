"""Resolves a signal bar by bar on M1 data, with conservative intrabar ordering.

- Longs are filled on the ask and exit on the bid; shorts the other way round.
- If a bar touches both the stop and a target, the stop wins.
- After TP1 the stop moves to the fill price (breakeven). If the TP1 bar also
  touches breakeven, the rest closes at breakeven.
- Stop exits pay ``slippage``; limit exits (TP1, TP2) fill at the level.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .bars import Bar
from .params import Params
from .strategy import Plan
from .timeutil import friday_exit_for

OPEN_STATES = ("pending", "active", "be")


@dataclass
class Signal:
    id: int
    t: int  # decision time (M5 close)
    plan: Plan
    valid_until: int
    state: str = "pending"
    sl: float = 0.0
    fill: float = 0.0
    fill_t: int = 0
    deadline: int = 0
    remaining: float = 1.0
    realized: list[tuple[float, float]] = field(default_factory=list)  # (fraction, price)
    outcome: str = ""
    closed_t: int = 0
    r_gross: float = 0.0
    r_cost: float = 0.0
    r_net: float = 0.0
    events: list[tuple[str, int, float]] = field(default_factory=list)

    @property
    def is_open(self) -> bool:
        return self.state in OPEN_STATES

    def to_json(self) -> dict:
        p = self.plan
        return {
            "id": self.id,
            "t": self.t,
            "direction": "long" if p.direction == 1 else "short",
            "entryRef": p.entry_ref,
            "sl": p.sl,
            "tp1": p.tp1,
            "tp2": p.tp2,
            "risk": p.risk,
            "atr": p.atr,
            "spread": p.spread,
            "fill": self.fill,
            "fillT": self.fill_t,
            "outcome": self.outcome,
            "closedT": self.closed_t,
            "rGross": self.r_gross,
            "rCost": self.r_cost,
            "rNet": self.r_net,
            "events": [{"type": e[0], "t": e[1], "price": e[2]} for e in self.events],
        }


def new_signal(sig_id: int, t: int, plan: Plan, p: Params) -> Signal:
    s = Signal(id=sig_id, t=t, plan=plan, valid_until=t + p.validMin * 60)
    s.sl = plan.sl
    s.events.append(("created", t, plan.entry_ref))
    return s


def _close(s: Signal, outcome: str, t: int, p: Params) -> None:
    s.state = "closed" if outcome != "expired" else "expired"
    s.outcome = outcome
    s.closed_t = t
    if outcome == "expired":
        s.r_gross = s.r_cost = s.r_net = 0.0
    else:
        d = s.plan.direction
        gross = 0.0
        for fraction, price in s.realized:
            gross += fraction * (price - s.fill) * d
        s.r_gross = gross / s.plan.risk
        s.r_cost = p.commission / s.plan.risk
        s.r_net = s.r_gross - s.r_cost
    s.events.append((outcome, t, s.realized[-1][1] if s.realized else 0.0))


def _exit_all(s: Signal, price: float, outcome: str, t: int, p: Params) -> None:
    if s.remaining > 0:
        s.realized.append((s.remaining, price))
        s.remaining = 0.0
    _close(s, outcome, t, p)


def advance(s: Signal, b: Bar, p: Params) -> None:
    """Apply one M1 bar (``b.t >= s.t``) to an open signal."""
    d = s.plan.direction
    spread = b.spread

    if s.state == "pending":
        if b.t >= s.valid_until:
            _close(s, "expired", b.t, p)
            return
        fill = b.o + spread + p.slippage if d == 1 else b.o - p.slippage
        if abs(fill - s.plan.entry_ref) > p.entryToleranceR * s.plan.risk:
            _close(s, "expired", b.t, p)
            return
        s.fill = fill
        s.fill_t = b.t
        s.state = "active"
        deadline = b.t + p.maxHoldMin * 60
        friday_exit = friday_exit_for(b.t, p.fridayExitUtc)
        if friday_exit is not None and friday_exit > b.t:
            deadline = min(deadline, friday_exit)
        s.deadline = deadline
        s.events.append(("filled", b.t, fill))

    if b.t >= s.deadline:
        _exit_all(s, b.o if d == 1 else b.o + spread, "time_exit", b.t, p)
        return

    # Prices on the side this position exits on.
    if d == 1:
        o, hi, lo = b.o, b.h, b.l
    else:
        o, hi, lo = b.o + spread, b.h + spread, b.l + spread

    def adverse_open(level: float) -> bool:
        return o <= level if d == 1 else o >= level

    def adverse_touch(level: float) -> bool:
        return lo <= level if d == 1 else hi >= level

    def favorable_touch(level: float) -> bool:
        return hi >= level if d == 1 else lo <= level

    stop_outcome = "sl" if s.state == "active" else "tp1_be"
    if adverse_open(s.sl):
        _exit_all(s, o - d * p.slippage, stop_outcome, b.t, p)
        return
    if adverse_touch(s.sl):
        _exit_all(s, s.sl - d * p.slippage, stop_outcome, b.t, p)
        return

    if s.state == "active":
        if not favorable_touch(s.plan.tp1):
            return
        if p.tp1Fraction > 0:
            s.realized.append((p.tp1Fraction, s.plan.tp1))
            s.remaining = 1.0 - p.tp1Fraction
        s.state = "be"
        s.sl = s.fill
        s.events.append(("tp1", b.t, s.plan.tp1))
        # Same bar: breakeven first (conservative), then TP2.
        if adverse_touch(s.sl):
            _exit_all(s, s.sl - d * p.slippage, "tp1_be", b.t, p)
            return

    if favorable_touch(s.plan.tp2):
        _exit_all(s, s.plan.tp2, "tp2", b.t, p)
