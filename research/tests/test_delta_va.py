from datetime import UTC, datetime

import pandas as pd
import pytest

from xausig.bars import Bar
from xausig.delta_va import DeltaVaReplay, DvaConfig, FlowBar
from xausig.orderflow import session_ids, value_areas
from xausig.params import Params


def ts(s: str) -> int:
    return int(datetime.fromisoformat(s).replace(tzinfo=UTC).timestamp())


def test_session_ids_follow_new_york_trading_day():
    # Tue 2026-03-10 18:30 New York (EDT, 22:30 UTC) belongs to Wednesday's session.
    wed = session_ids([ts("2026-03-10T22:30:00")])[0]
    assert wed == session_ids([ts("2026-03-11T15:00:00")])[0]
    assert session_ids([ts("2026-03-10T21:30:00")])[0] == -1  # 17:30 New York: daily break
    assert session_ids([ts("2026-03-14T15:00:00")])[0] == -1  # Saturday
    assert session_ids([ts("2026-03-15T23:00:00")])[0] == session_ids([ts("2026-03-16T12:00:00")])[0]  # Sun 19:00 NY -> Monday


def test_value_area_expands_from_poc_to_70_percent():
    prof = pd.DataFrame({"session": [1] * 5, "bucket": [100, 101, 102, 103, 104], "qty": [5.0, 20.0, 40.0, 25.0, 10.0]})
    prof["pq"] = (prof["bucket"] + 0.5) * prof["qty"]
    poc, vah, val = value_areas(prof)[1]
    assert poc == 102.5
    # 40 (POC) + 25 (above, larger) = 65 < 70 -> add 20 (below) = 85 >= 70
    assert (val, vah) == (101.0, 104.0)


P = Params(commission=0.0, slippage=0.0, newsBlackoutMin=0, sessions=Params().sessions)
DAY = ts("2026-03-11T00:00:00")  # Wednesday


def fb(t, o, h, low, c, buy, sell):
    return FlowBar(Bar(t, o, h, low, c, 0.3), buy, sell, int(session_ids([t])[0]))


def warm_and_probe(probe_buy: float, probe_sell: float):
    """Quiet session around 2000, then a swing high, then a probe above VAH=2004 with the given flow."""
    sid = int(session_ids([DAY + 12 * 3600])[0])
    prev = int(session_ids([DAY - 12 * 3600])[0])
    va = {prev: (2000.0, 2004.0, 1997.0)}
    bars = []
    t = DAY + 7 * 3600  # 07:00 UTC, London open (GMT in March before the switch on the 29th)
    for _ in range(120):  # 2 h of chop to warm ATR
        bars.append(fb(t, 2001, 2001.8, 2000.2, 2001, 5, 5))
        t += 60
    for i in range(30):  # window A: strong buying, swing high 2004.5 printed at the end
        hi = 2004.5 if i >= 25 else 2004.0
        bars.append(fb(t, 2003.5, hi, 2003.3, 2003.9, 30, 5))
        t += 60
    for _ in range(29):  # window B: higher high 2005.2 but with the given flow
        bars.append(fb(t, 2004.2, 2005.2, 2004.0, 2004.4, probe_buy, probe_sell))
        t += 60
    bars.append(fb(t, 2004.2, 2004.3, 2003.6, 2003.7, 5, 20))  # trigger: closes back below VAH
    t += 60
    bars.append(fb(t, 2003.65, 2003.7, 2003.4, 2003.5, 5, 10))  # quiet fill bar
    t += 60
    for _ in range(60):
        bars.append(fb(t, 2003.0, 2003.1, 1999.5, 1999.9, 5, 10))  # rotates through POC (shorts exit on the ask)
        t += 60
    return DeltaVaReplay(P, DvaConfig(windowMin=30), va).run(bars), sid


def test_short_on_bearish_delta_divergence_above_vah():
    r, _ = warm_and_probe(probe_buy=2, probe_sell=30)  # new high on net selling -> CVD lower high
    assert r.reasons["signal"] == 1
    s = r.signals[0]
    assert s.plan.direction == -1
    assert s.plan.tp2 == pytest.approx(2000.0)  # previous POC
    assert s.outcome in ("tp2", "tp1_be")


def test_no_signal_when_delta_confirms_the_probe():
    r, _ = warm_and_probe(probe_buy=60, probe_sell=2)  # higher high with strong buying -> no divergence
    assert r.reasons["signal"] == 0
