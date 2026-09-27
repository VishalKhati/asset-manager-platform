"""Incremental indicators.

Each indicator is updated one bar at a time with plain float arithmetic in a fixed
order, so the TypeScript port (``lib/strategy/src/indicators.ts``) produces
bit-identical results. ``nan`` means "not enough bars yet".
"""

from __future__ import annotations

import math
from collections import deque

NAN = math.nan


class Ema:
    """EMA seeded with the SMA of the first ``n`` values, then alpha = 2 / (n + 1)."""

    __slots__ = ("n", "alpha", "count", "total", "value")

    def __init__(self, n: int):
        self.n = n
        self.alpha = 2.0 / (n + 1)
        self.count = 0
        self.total = 0.0
        self.value = NAN

    def update(self, x: float) -> float:
        self.count += 1
        if self.count < self.n:
            self.total += x
        elif self.count == self.n:
            self.total += x
            self.value = self.total / self.n
        else:
            self.value = self.alpha * x + (1.0 - self.alpha) * self.value
        return self.value


class Atr:
    """Wilder ATR. The first true range is high - low; the seed is the mean of the first ``n``."""

    __slots__ = ("n", "count", "total", "value", "prev_close")

    def __init__(self, n: int):
        self.n = n
        self.count = 0
        self.total = 0.0
        self.value = NAN
        self.prev_close: float | None = None

    def update(self, h: float, low: float, c: float) -> float:
        if self.prev_close is None:
            tr = h - low
        else:
            tr = max(h - low, abs(h - self.prev_close), abs(low - self.prev_close))
        self.prev_close = c
        self.count += 1
        if self.count < self.n:
            self.total += tr
        elif self.count == self.n:
            self.total += tr
            self.value = self.total / self.n
        else:
            self.value = (self.value * (self.n - 1) + tr) / self.n
        return self.value


def _mean(values) -> float:
    total = 0.0
    for v in values:
        total += v
    return total / len(values)


class Stoch:
    """Slow stochastic (k, smooth, d): raw %K over ``k`` bars, %K = SMA(smooth), %D = SMA(d) of %K."""

    __slots__ = ("highs", "lows", "raw", "slow", "k", "d")

    def __init__(self, k: int, smooth: int, d: int):
        self.highs: deque[float] = deque(maxlen=k)
        self.lows: deque[float] = deque(maxlen=k)
        self.raw: deque[float] = deque(maxlen=smooth)
        self.slow: deque[float] = deque(maxlen=d)
        self.k = NAN
        self.d = NAN

    def update(self, h: float, low: float, c: float) -> tuple[float, float]:
        self.highs.append(h)
        self.lows.append(low)
        if len(self.highs) < self.highs.maxlen:
            return self.k, self.d
        hh = max(self.highs)
        ll = min(self.lows)
        raw = 100.0 * (c - ll) / (hh - ll) if hh > ll else 50.0
        self.raw.append(raw)
        if len(self.raw) < self.raw.maxlen:
            return self.k, self.d
        self.k = _mean(self.raw)
        self.slow.append(self.k)
        if len(self.slow) == self.slow.maxlen:
            self.d = _mean(self.slow)
        return self.k, self.d
