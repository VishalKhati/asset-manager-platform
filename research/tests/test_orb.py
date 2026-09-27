from datetime import UTC, datetime

import pytest

from xausig.bars import Bar
from xausig.orb import OrbConfig, OrbReplay
from xausig.params import Params

P = Params(commission=0.0, slippage=0.0)
# Tuesday 2024-01-09: London is on GMT, so London time == UTC.
DAY = int(datetime(2024, 1, 9, tzinfo=UTC).timestamp())


def minute(h: int, m: int) -> int:
    return DAY + h * 3600 + m * 60


def asian_range(lo=2000.0, hi=2005.0) -> list[Bar]:
    """00:00–07:00: oscillate between lo and hi."""
    bars = []
    for i in range(7 * 60):
        mid = lo + (hi - lo) * (0.5 + 0.45 * (1 if (i // 30) % 2 else -1))
        bars.append(Bar(DAY + i * 60, mid, min(hi, mid + 0.2), max(lo, mid - 0.2), mid, 0.3))
    return bars


def flat(h0: int, m0: int, h1: int, m1: int, price: float) -> list[Bar]:
    return [Bar(t, price, price + 0.1, price - 0.1, price, 0.3) for t in range(minute(h0, m0), minute(h1, m1), 60)]


NO_TREND = OrbConfig(trendFilter=False)


def run(bars, cfg=NO_TREND):
    return OrbReplay(P, cfg).run(bars)


def test_long_breakout_levels_and_tp2():
    bars = asian_range() + flat(7, 0, 7, 15, 2003) + flat(7, 15, 7, 30, 2006)  # M15 07:15–07:30 closes 2006 > 2005
    bars += [Bar(minute(7, 30), 2006.3, 2006.4, 2006.2, 2006.35, 0.3)]  # quiet fill bar
    bars += [Bar(t, 2010, 2030, 2009, 2029, 0.3) for t in range(minute(7, 31), minute(8, 0), 60)]
    r = run(bars)
    assert len(r.signals) == 1
    s = r.signals[0]
    p = s.plan
    assert p.direction == 1
    assert p.entry_ref == pytest.approx(2006.3)  # close + spread
    range_low = min(b.l for b in asian_range())
    assert p.sl == pytest.approx(range_low - 0.3)  # opposite side minus spread
    assert p.tp2 == pytest.approx(p.entry_ref + 2 * p.risk)
    assert s.outcome == "tp2"


def test_mid_stop_is_tighter():
    bars = asian_range() + flat(7, 0, 7, 15, 2003) + flat(7, 15, 7, 30, 2006) + flat(7, 30, 8, 0, 2006.2)
    opposite = run(bars).signals[0].plan.risk
    mid = run(bars, OrbConfig(stop="mid", trendFilter=False)).signals[0].plan.risk
    assert mid < opposite
    assert mid == pytest.approx(2006.3 - (2002.5 - 0.3))


def test_only_first_breakout_counts_and_time_exit_at_1600():
    bars = asian_range() + flat(7, 0, 7, 15, 2003) + flat(7, 15, 7, 30, 1999)  # first breakout: short
    bars += flat(7, 30, 7, 35, 1999.1)  # fills near the trigger
    bars += flat(7, 35, 7, 45, 2006)  # a later upside breakout is ignored, and it stops the short out
    bars += flat(7, 45, 17, 0, 2006)
    r = run(bars)
    assert len(r.signals) == 1
    assert r.signals[0].plan.direction == -1
    assert r.signals[0].outcome == "sl"


def test_time_exit():
    bars = asian_range() + flat(7, 0, 7, 15, 2003) + flat(7, 15, 7, 30, 2006) + flat(7, 30, 17, 0, 2007)
    s = run(bars).signals[0]
    assert s.outcome == "time_exit"
    assert s.closed_t == minute(16, 0)


def test_no_trade_outside_entry_window_or_without_breakout():
    bars = asian_range() + flat(7, 0, 10, 0, 2003) + flat(10, 0, 11, 0, 2010)  # breaks out after 10:00
    assert run(bars).signals == []


def test_range_width_filter():
    bars = asian_range(2000.0, 2000.5) + flat(7, 0, 7, 15, 2000.2) + flat(7, 15, 7, 30, 2001)  # width 0.025%
    r = run(bars)
    assert r.signals == []
    assert r.reasons["range_width"] == 1
