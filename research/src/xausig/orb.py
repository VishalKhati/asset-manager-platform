"""Hypothesis v2, `london_orb`: London-open breakout of the Asian range.

Implements research/HYPOTHESIS_V2.md exactly. Reuses the v1 bar aggregation, fill model,
tracker and costs so the two strategies are judged by the same machinery.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from .bars import M1, M15, Aggregator, Bar
from .indicators import Ema
from .params import Params
from .strategy import Plan, news_within
from .tracker import Signal, advance, new_signal

STRATEGY_ID = "london_orb"
LONDON = ZoneInfo("Europe/London")
H1 = 3600

RANGE_END_MIN = 7 * 60  # 07:00
ENTRY_FIRST_CLOSE_MIN = 7 * 60 + 15  # 07:15
ENTRY_LAST_CLOSE_MIN = 10 * 60  # 10:00
EXIT_MIN = 16 * 60  # 16:00
MIN_RANGE_BARS = 300
MIN_WIDTH, MAX_WIDTH = 0.0010, 0.0080


@dataclass(frozen=True)
class OrbConfig:
    stop: str = "opposite"  # "opposite" | "mid"
    tp2R: float = 2.0
    trendFilter: bool = True

    def to_json(self) -> dict:
        return {"stop": self.stop, "tp2R": self.tp2R, "trendFilter": self.trendFilter}


class _LocalClock:
    """UTC epoch → (London date ordinal, weekday, minute of day), cached per UTC hour."""

    def __init__(self) -> None:
        self._cache: dict[int, tuple[int, int, int]] = {}

    def __call__(self, t: int) -> tuple[int, int, int]:
        hour = t // 3600
        hit = self._cache.get(hour)
        if hit is None:
            dt = datetime.fromtimestamp(hour * 3600, LONDON)
            hit = (dt.toordinal(), dt.weekday(), dt.hour * 60 + dt.minute)
            self._cache[hour] = hit
        day, weekday, start_min = hit
        return day, weekday, start_min + (t % 3600) // 60


class _Day:
    __slots__ = ("hi", "lo", "count", "last_close", "done")

    def __init__(self) -> None:
        self.hi = float("-inf")
        self.lo = float("inf")
        self.count = 0
        self.last_close = 0.0
        self.done = False


class OrbReplay:
    def __init__(self, p: Params, cfg: OrbConfig, news: list[int] | None = None):
        # Tracker settings from the pre-registration: TP1 1R with 50% partial, fill tolerance 0.25R, valid 30 min.
        self.p = p.replace(tp1R=1.0, tp2R=cfg.tp2R, tp1Fraction=0.5, validMin=30, entryToleranceR=0.25, maxHoldMin=24 * 60)
        self.cfg = cfg
        self.news = sorted(news or [])
        self.clock = _LocalClock()
        self.agg15 = Aggregator(M15)
        self.agg60 = Aggregator(H1)
        self.ema_h1 = Ema(200)
        self.ema_value = float("nan")
        self.days: dict[int, _Day] = {}
        self.open: list[Signal] = []
        self.closed: list[Signal] = []
        self.reasons: Counter[str] = Counter()
        self._next_id = 1
        self._exit_at: dict[int, int] = {}

    # -- helpers ----------------------------------------------------------
    def _day_exit_utc(self, t: int) -> int:
        day, _, minute = self.clock(t)
        return t + (EXIT_MIN - minute) * 60 - t % 60

    def _close_buckets(self, now: int) -> None:
        h = self.agg60.close_if_done(now)
        if h is not None:
            self.ema_value = self.ema_h1.update(h.c)
        b = self.agg15.close_if_done(now)
        if b is not None:
            self._evaluate(b, b.t + M15)

    def _evaluate(self, b: Bar, t_close: int) -> None:
        day, weekday, minute = self.clock(t_close)
        if weekday >= 5 or not (ENTRY_FIRST_CLOSE_MIN <= minute <= ENTRY_LAST_CLOSE_MIN):
            return
        d = self.days.get(day)
        if d is None or d.done:
            return
        if d.count < MIN_RANGE_BARS:
            d.done = True
            self.reasons["range_incomplete"] += 1
            return
        width = (d.hi - d.lo) / d.last_close
        if width < MIN_WIDTH or width > MAX_WIDTH:
            d.done = True
            self.reasons["range_width"] += 1
            return
        if b.c > d.hi:
            direction = 1
        elif b.c < d.lo:
            direction = -1
        else:
            return  # no breakout yet; keep watching this day
        d.done = True  # only the first breakout of the day counts
        if self.p.newsBlackoutMin > 0 and news_within(self.news, t_close, self.p.newsBlackoutMin * 60):
            self.reasons["news"] += 1
            return
        if self.cfg.trendFilter:
            if self.ema_value != self.ema_value:  # NaN: not warmed up
                self.reasons["warmup"] += 1
                return
            if (direction == 1 and b.c <= self.ema_value) or (direction == -1 and b.c >= self.ema_value):
                self.reasons["trend"] += 1
                return
        if self.open:
            self.reasons["one_open"] += 1
            return
        s = b.spread
        level = d.lo if self.cfg.stop == "opposite" else (d.hi + d.lo) / 2
        if self.cfg.stop == "opposite" and direction == -1:
            level = d.hi
        if direction == 1:
            entry = b.c + s
            sl = level - s
            dist = entry - sl
        else:
            entry = b.c
            sl = level + s + s  # mirrored in ask terms: ask level plus the spread buffer
            dist = sl - entry
        if not dist > 0:
            self.reasons["bad_stop"] += 1
            return
        plan = Plan(direction, entry, sl, entry + direction * dist, entry + direction * self.cfg.tp2R * dist, dist, 0.0, s)
        sig = new_signal(self._next_id, t_close, plan, self.p)
        self._next_id += 1
        self._exit_at[sig.id] = self._day_exit_utc(t_close)
        self.open.append(sig)
        self.reasons["signal"] += 1

    # -- main loop --------------------------------------------------------
    def on_m1(self, b: Bar) -> None:
        self._close_buckets(b.t)
        if self.open:
            still = []
            for s in self.open:
                if b.t >= s.t:
                    was_pending = s.state == "pending"
                    if was_pending and b.t < s.valid_until:
                        # Apply the 16:00 exit as soon as the position fills.
                        advance(s, b, self.p)
                        if s.fill_t and s.is_open:
                            s.deadline = min(s.deadline, self._exit_at[s.id])
                    else:
                        if s.state != "pending" and s.deadline > self._exit_at[s.id]:
                            s.deadline = self._exit_at[s.id]
                        advance(s, b, self.p)
                (still if s.is_open else self.closed).append(s)
            self.open = still
        # Asian range accumulation (00:00–07:00 London, weekdays).
        day, weekday, minute = self.clock(b.t)
        if weekday < 5 and minute < RANGE_END_MIN:
            d = self.days.get(day)
            if d is None:
                d = self.days[day] = _Day()
            if b.h > d.hi:
                d.hi = b.h
            if b.l < d.lo:
                d.lo = b.l
            d.count += 1
            d.last_close = b.c
        self.agg60.push(b)
        self.agg15.push(b)
        self._close_buckets(b.t + M1)

    def run(self, bars: Iterable[Bar]) -> OrbReplay:
        for b in bars:
            self.on_m1(b)
        return self

    @property
    def signals(self) -> list[Signal]:
        return sorted(self.closed + self.open, key=lambda s: s.id)
