"""The decision taken at each M5 close: filters first, then the strategy rules.

Reason codes, in the order they are checked (the first failing one is reported):

warmup, data_gap, session, friday_cutoff, news, one_open, cooldown,
bias_none, no_cross, no_pullback, spread, atr_range, signal
"""

from __future__ import annotations

import math
from bisect import bisect_left
from dataclasses import dataclass

from .bars import M5, M15, Bar
from .params import Params
from .timeutil import after_friday_cutoff, in_sessions

REASONS = (
    "warmup",
    "data_gap",
    "session",
    "friday_cutoff",
    "news",
    "one_open",
    "cooldown",
    "bias_none",
    "no_cross",
    "no_pullback",
    "spread",
    "atr_range",
    "signal",
)


@dataclass
class Plan:
    direction: int  # +1 long, -1 short
    entry_ref: float
    sl: float
    tp1: float
    tp2: float
    risk: float
    atr: float
    spread: float


@dataclass
class Context:
    open_count: int
    cooldown_until: int
    news: list[int]  # sorted UTC seconds of high-impact events


def news_within(news: list[int], t: int, window_s: int) -> bool:
    i = bisect_left(news, t - window_s)
    return i < len(news) and news[i] <= t + window_s


def decide(m5: list[Bar], m15: list[Bar], t_close: int, ctx: Context, p: Params) -> tuple[str, Plan | None]:
    """Decide at ``t_close``, the close time of ``m5[-1]``. Only closed bars are passed in."""
    if len(m5) < max(p.warmupM5, 3) or len(m15) < p.warmupM15:
        return "warmup", None

    b = m5[-1]
    b1 = m5[-2]
    b2 = m5[-3]
    if b.t - b1.t != M5 or b1.t - b2.t != M5:
        return "data_gap", None
    h = m15[-1]
    if t_close - (h.t + M15) >= M15:
        return "data_gap", None

    if not in_sessions(t_close, p.sessions):
        return "session", None
    if after_friday_cutoff(t_close, p.fridayCutoffUtc):
        return "friday_cutoff", None
    if p.newsBlackoutMin > 0 and news_within(ctx.news, t_close, p.newsBlackoutMin * 60):
        return "news", None
    if ctx.open_count > 0:
        return "one_open", None
    if t_close < ctx.cooldown_until:
        return "cooldown", None

    # Bias on the last closed M15 bar.
    if h.c > h.ema_trend and h.ema_fast > h.ema_slow:
        direction = 1
    elif h.c < h.ema_trend and h.ema_fast < h.ema_slow:
        direction = -1
    else:
        return "bias_none", None

    # Stochastic cross out of the extreme zone, with the trend.
    if direction == 1:
        crossed = b1.k <= b1.d and b.k > b.d and b1.k < p.stochLow
    else:
        crossed = b1.k >= b1.d and b.k < b.d and b1.k > p.stochHigh
    if not crossed:
        return "no_cross", None

    # Pullback into the EMA fast/slow zone within the last ``pullbackBars`` bars.
    touched = False
    for j in range(len(m5) - p.pullbackBars, len(m5)):
        x = m5[j]
        if direction == 1 and x.l <= max(x.ema_fast, x.ema_slow):
            touched = True
            break
        if direction == -1 and x.h >= min(x.ema_fast, x.ema_slow):
            touched = True
            break
    if direction == 1:
        holds = b.c >= min(b.ema_fast, b.ema_slow)
    else:
        holds = b.c <= max(b.ema_fast, b.ema_slow)
    if not (touched and holds):
        return "no_pullback", None

    atr = b.atr
    spread = b.spread
    if spread > p.maxSpread or spread > p.maxSpreadAtrFrac * atr:
        return "spread", None
    atr_bps = atr / b.c * 10_000.0
    if atr_bps < p.atrMinBps or atr_bps > p.atrMaxBps:
        return "atr_range", None

    swing = m5[len(m5) - p.swingBars :]
    if direction == 1:
        entry = b.c + spread
        swing_low = min(x.l for x in swing)
        dist = max(p.slAtrMult * atr, entry - (swing_low - p.swingBufferAtr * atr))
    else:
        entry = b.c
        swing_high = max(x.h for x in swing) + spread
        dist = max(p.slAtrMult * atr, (swing_high + p.swingBufferAtr * atr) - entry)
    if not (dist > 0 and math.isfinite(dist)):
        return "atr_range", None

    plan = Plan(
        direction=direction,
        entry_ref=entry,
        sl=entry - direction * dist,
        tp1=entry + direction * p.tp1R * dist,
        tp2=entry + direction * p.tp2R * dist,
        risk=dist,
        atr=atr,
        spread=spread,
    )
    return "signal", plan
