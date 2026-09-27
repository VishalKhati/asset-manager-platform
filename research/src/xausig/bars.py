"""Bars and M1 → M5/M15 aggregation.

Prices are bid prices. ``spread`` is ask - bid at the bar close, in price units.
A higher-timeframe bar takes the spread of its last M1 bar.
"""

from __future__ import annotations

import math

M1 = 60
M5 = 300
M15 = 900


class Bar:
    __slots__ = ("t", "o", "h", "l", "c", "spread", "ema_fast", "ema_slow", "ema_trend", "atr", "k", "d")

    def __init__(self, t: int, o: float, h: float, low: float, c: float, spread: float):
        self.t = t
        self.o = o
        self.h = h
        self.l = low
        self.c = c
        self.spread = spread
        self.ema_fast = math.nan
        self.ema_slow = math.nan
        self.ema_trend = math.nan
        self.atr = math.nan
        self.k = math.nan
        self.d = math.nan

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Bar(t={self.t}, o={self.o}, h={self.h}, l={self.l}, c={self.c}, s={self.spread})"


class Aggregator:
    """Builds ``tf``-second bars from M1 bars. Buckets are aligned to multiples of ``tf``."""

    __slots__ = ("tf", "cur")

    def __init__(self, tf: int):
        self.tf = tf
        self.cur: Bar | None = None

    def push(self, b: Bar) -> None:
        start = b.t - b.t % self.tf
        cur = self.cur
        if cur is None:
            self.cur = Bar(start, b.o, b.h, b.l, b.c, b.spread)
            return
        if start != cur.t:
            raise ValueError("push() into a bucket that was not closed first")
        if b.h > cur.h:
            cur.h = b.h
        if b.l < cur.l:
            cur.l = b.l
        cur.c = b.c
        cur.spread = b.spread

    def close_if_done(self, now: int) -> Bar | None:
        """Close and return the current bucket if it ends at or before ``now``."""
        cur = self.cur
        if cur is not None and cur.t + self.tf <= now:
            self.cur = None
            return cur
        return None
