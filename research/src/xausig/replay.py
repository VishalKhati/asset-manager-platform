"""Bar-by-bar replay: the same processing order as the live engine.

For every incoming M1 bar ``b``:
  1. close any M15/M5 bucket that ended at or before ``b.t`` and evaluate each new M5 close;
  2. advance every open signal with ``b``;
  3. add ``b`` to the buckets;
  4. close any bucket that ends at ``b.t + 60`` (``b`` was its last minute) and evaluate.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable

from .bars import M1, M5, M15, Aggregator, Bar
from .indicators import Atr, Ema, Stoch
from .params import Params
from .strategy import Context, decide
from .tracker import Signal, advance, new_signal


class Replay:
    def __init__(self, p: Params, news: list[int] | None = None, record_decisions: bool = False,
                 max_bars: int = 2000):
        self.p = p
        self.news = sorted(news or [])
        self.record_decisions = record_decisions
        self.max_bars = max_bars
        self.agg5 = Aggregator(M5)
        self.agg15 = Aggregator(M15)
        self.m5: list[Bar] = []
        self.m15: list[Bar] = []
        self._e5f, self._e5s = Ema(p.emaFast), Ema(p.emaSlow)
        self._atr = Atr(p.atrPeriod)
        self._stoch = Stoch(p.stochK, p.stochSmooth, p.stochD)
        self._e15f, self._e15s, self._e15t = Ema(p.emaFast), Ema(p.emaSlow), Ema(p.emaTrend)
        self.open: list[Signal] = []
        self.closed: list[Signal] = []
        self.cooldown_until = 0
        self.reasons: Counter[str] = Counter()
        self.decisions: list[dict] = []
        self._next_id = 1
        self._m5_count = 0
        self._m15_count = 0

    # -- bar closes -------------------------------------------------------
    def _on_m15(self, b: Bar) -> None:
        b.ema_fast = self._e15f.update(b.c)
        b.ema_slow = self._e15s.update(b.c)
        b.ema_trend = self._e15t.update(b.c)
        self.m15.append(b)
        self._m15_count += 1
        if len(self.m15) > self.max_bars:
            del self.m15[: len(self.m15) - self.max_bars]

    def _on_m5(self, b: Bar) -> None:
        b.ema_fast = self._e5f.update(b.c)
        b.ema_slow = self._e5s.update(b.c)
        b.atr = self._atr.update(b.h, b.l, b.c)
        b.k, b.d = self._stoch.update(b.h, b.l, b.c)
        self.m5.append(b)
        self._m5_count += 1
        if len(self.m5) > self.max_bars:
            del self.m5[: len(self.m5) - self.max_bars]
        self._evaluate(b.t + M5)

    def _close_buckets(self, now: int) -> None:
        h = self.agg15.close_if_done(now)
        if h is not None:
            self._on_m15(h)
        b = self.agg5.close_if_done(now)
        if b is not None:
            self._on_m5(b)

    def _evaluate(self, t_close: int) -> None:
        p = self.p
        # Warm-up counts every bar seen, not just the trimmed window.
        if self._m5_count < max(p.warmupM5, 3) or self._m15_count < p.warmupM15:
            reason, plan = "warmup", None
        else:
            ctx = Context(open_count=len(self.open), cooldown_until=self.cooldown_until, news=self.news)
            reason, plan = decide(self.m5, self.m15, t_close, ctx, p)
        self.reasons[reason] += 1
        if self.record_decisions:
            self.decisions.append({"t": t_close, "reason": reason})
        if plan is not None:
            self.open.append(new_signal(self._next_id, t_close, plan, p))
            self._next_id += 1

    # -- main loop --------------------------------------------------------
    def on_m1(self, b: Bar) -> None:
        self._close_buckets(b.t)
        if self.open:
            still_open = []
            for s in self.open:
                if b.t >= s.t:
                    advance(s, b, self.p)
                if s.is_open:
                    still_open.append(s)
                else:
                    self.closed.append(s)
                    if s.outcome in ("sl", "time_exit") and s.r_net < 0:
                        self.cooldown_until = max(
                            self.cooldown_until, s.closed_t + self.p.cooldownAfterLossMin * 60
                        )
            self.open = still_open
        self.agg15.push(b)
        self.agg5.push(b)
        self._close_buckets(b.t + M1)

    def run(self, bars: Iterable[Bar]) -> Replay:
        for b in bars:
            self.on_m1(b)
        return self

    @property
    def signals(self) -> list[Signal]:
        return sorted(self.closed + self.open, key=lambda s: s.id)


def bars_from_arrays(t, o, h, low, c, spread) -> Iterable[Bar]:
    for i in range(len(t)):
        yield Bar(int(t[i]), float(o[i]), float(h[i]), float(low[i]), float(c[i]), float(spread[i]))
