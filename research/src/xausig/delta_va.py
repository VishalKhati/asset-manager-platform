"""Hypothesis v3, `delta_va_fade`: delta divergence at the previous session's value-area edges.

Implements research/HYPOTHESIS_V3.md. Reuses the v1 tracker, costs and filters.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass

from .bars import M1, M5, Aggregator, Bar
from .indicators import Atr
from .params import Params
from .strategy import Plan, news_within
from .timeutil import after_friday_cutoff, in_sessions
from .tracker import Signal, advance, new_signal

STRATEGY_ID = "delta_va_fade"


@dataclass(frozen=True)
class DvaConfig:
    windowMin: int = 30
    stopBuffer: float = 0.10

    def to_json(self) -> dict:
        return {"windowMin": self.windowMin, "stopBuffer": self.stopBuffer}


@dataclass
class FlowBar:
    """An M1 bar with order flow and its gold-session id (-1 outside sessions)."""

    bar: Bar
    buy: float
    sell: float
    session: int


class _M5:
    __slots__ = ("t", "h", "l", "c", "cvd", "session", "atr")

    def __init__(self, t, h, low, c, cvd, session, atr):
        self.t, self.h, self.l, self.c, self.cvd, self.session, self.atr = t, h, low, c, cvd, session, atr


class DeltaVaReplay:
    def __init__(self, p: Params, cfg: DvaConfig, value_areas: dict[int, tuple[float, float, float]], news: list[int] | None = None):
        self.p = p.replace(tp1R=1.0, tp1Fraction=0.5, validMin=30, entryToleranceR=0.25, maxHoldMin=240)
        self.cfg = cfg
        self.va = value_areas
        self.sessions_sorted = sorted(value_areas)
        self.news = sorted(news or [])
        self.agg5 = Aggregator(M5)
        self.atr = Atr(self.p.atrPeriod)
        self.m5: list[_M5] = []
        self.cvd = 0.0
        self.cur_session = -1
        self.bucket_session = -1
        self.open: list[Signal] = []
        self.closed: list[Signal] = []
        self.cooldown_until = 0
        self.reasons: Counter[str] = Counter()
        self._next_id = 1
        self.agg_spread = 0.0

    def _prev_session_va(self, sid: int):
        import bisect

        i = bisect.bisect_left(self.sessions_sorted, sid)
        if i == 0:
            return None
        return self.va[self.sessions_sorted[i - 1]]

    def _close_bucket(self, now: int) -> None:
        b = self.agg5.close_if_done(now)
        if b is None:
            return
        atr = self.atr.update(b.h, b.l, b.c)
        self.m5.append(_M5(b.t, b.h, b.l, b.c, self.cvd, self.bucket_session, atr))
        if len(self.m5) > 200:
            del self.m5[:100]
        self._evaluate(b.t + M5)

    def _evaluate(self, T: int) -> None:
        p, cfg = self.p, self.cfg
        last = self.m5[-1]
        sid = last.session
        if sid < 0 or math.isnan(last.atr):
            self.reasons["no_session" if sid < 0 else "warmup"] += 1
            return
        va = self._prev_session_va(sid)
        if va is None:
            self.reasons["no_prev_session"] += 1
            return
        poc, vah, val = va
        W = cfg.windowMin * 60
        a = [x for x in self.m5 if T - 2 * W <= x.t < T - W and x.session == sid]
        bwin = [x for x in self.m5 if T - W <= x.t < T and x.session == sid]
        if not a or not bwin:
            self.reasons["window"] += 1
            return
        hA = max(a, key=lambda x: x.h)
        hB = max(bwin, key=lambda x: x.h)
        lA = min(a, key=lambda x: x.l)
        lB = min(bwin, key=lambda x: x.l)
        direction = 0
        if hB.h > hA.h and hB.h > vah and hB.cvd < hA.cvd and last.c < vah:
            direction = -1
        elif lB.l < lA.l and lB.l < val and lB.cvd > lA.cvd and last.c > val:
            direction = 1
        if direction == 0:
            self.reasons["no_setup"] += 1
            return
        # Filters (same as v1).
        if not in_sessions(T, p.sessions):
            self.reasons["session"] += 1
            return
        if after_friday_cutoff(T, p.fridayCutoffUtc):
            self.reasons["friday_cutoff"] += 1
            return
        if p.newsBlackoutMin > 0 and news_within(self.news, T, p.newsBlackoutMin * 60):
            self.reasons["news"] += 1
            return
        if self.open:
            self.reasons["one_open"] += 1
            return
        if T < self.cooldown_until:
            self.reasons["cooldown"] += 1
            return
        spread = self.agg_spread
        atr = last.atr
        if spread > p.maxSpread or spread > p.maxSpreadAtrFrac * atr:
            self.reasons["spread"] += 1
            return
        bps = atr / last.c * 10_000.0
        if bps < p.atrMinBps or bps > p.atrMaxBps:
            self.reasons["atr_range"] += 1
            return
        if direction == -1:
            entry = last.c
            sl_struct = hB.h + cfg.stopBuffer * atr + spread
            dist = max(sl_struct - entry, 0.5 * atr)
        else:
            entry = last.c + spread
            sl_struct = lB.l - cfg.stopBuffer * atr
            dist = max(entry - sl_struct, 0.5 * atr)
        room = (poc - entry) * direction
        if room < 1.5 * dist:
            self.reasons["no_room"] += 1
            return
        plan = Plan(direction, entry, entry - direction * dist, entry + direction * dist, poc, dist, atr, spread)
        self.open.append(new_signal(self._next_id, T, plan, self.p))
        self._next_id += 1
        self.reasons["signal"] += 1

    def on_m1(self, fb: FlowBar) -> None:
        b = fb.bar
        self._close_bucket(b.t)
        if self.open:
            still = []
            for s in self.open:
                if b.t >= s.t:
                    advance(s, b, self.p)
                if s.is_open:
                    still.append(s)
                else:
                    self.closed.append(s)
                    if s.outcome in ("sl", "time_exit") and s.r_net < 0:
                        self.cooldown_until = max(self.cooldown_until, s.closed_t + self.p.cooldownAfterLossMin * 60)
            self.open = still
        if fb.session != self.cur_session:
            if fb.session >= 0:
                self.cvd = 0.0  # CVD resets at each session start
            self.cur_session = fb.session
        if fb.session >= 0:
            self.cvd += fb.buy - fb.sell
        self.bucket_session = fb.session  # an M5 bar takes the session of its last minute
        self.agg_spread = b.spread
        self.agg5.push(b)
        self._close_bucket(b.t + M1)

    def run(self, bars) -> DeltaVaReplay:
        for fb in bars:
            self.on_m1(fb)
        return self

    @property
    def signals(self) -> list[Signal]:
        return sorted(self.closed + self.open, key=lambda s: s.id)
