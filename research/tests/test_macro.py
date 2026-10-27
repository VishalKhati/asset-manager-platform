import numpy as np
import pandas as pd
import pytest

from xausig.macro import COST_PER_UNIT, Cfg, daily_returns, lagged_asof, metrics, positions


def test_fred_values_are_lagged_one_day():
    s = pd.Series([1.0, 2.0, 3.0], index=pd.to_datetime(["2024-01-02", "2024-01-03", "2024-01-04"]))
    got = lagged_asof(s, pd.to_datetime(["2024-01-03", "2024-01-04", "2024-01-08"]))
    # On Jan 3 only Jan 2's value is public; on Jan 8 the latest is Jan 4's.
    assert got.tolist() == [1.0, 2.0, 3.0]
    assert np.isnan(lagged_asof(s, pd.to_datetime(["2024-01-02"])).iloc[0])


def frame(closes, ry, usd, dff=2.5):
    idx = pd.bdate_range("2020-01-01", periods=len(closes))
    return pd.DataFrame({"close": closes, "ry": ry, "usd": usd, "dff": dff}, index=idx)


def test_positions_need_agreement_and_shorts_only_in_long_short():
    n = 70
    up = np.linspace(100, 120, n)
    f = frame(up, np.linspace(2.0, 1.0, n), np.linspace(110, 100, n))  # trend up, real yields down, dollar down
    pos = positions(f, Cfg(N=10, k=3, mode="long_flat"))
    assert pos.iloc[-1] == 1.0  # all three agree
    assert pos.iloc[:63].isna().all()  # 63-day lookback still warming up
    down = frame(up[::-1], np.linspace(1.0, 2.0, n), np.linspace(100, 110, n))
    assert positions(down, Cfg(N=10, k=3, mode="long_flat")).iloc[-1] == 0.0
    assert positions(down, Cfg(N=10, k=3, mode="long_short")).iloc[-1] == -1.0


def test_costs_and_financing():
    f = frame([100.0, 101.0, 102.0, 101.0], [1, 1, 1, 1], [1, 1, 1, 1], dff=5.0)
    pos = pd.Series([1.0, 1.0, -1.0, np.nan], index=f.index)
    r = daily_returns(f, pos)
    days = 1  # consecutive business days in this frame
    long_fin = (5.0 + 2.5) / 100 / 360 * days
    short_fin = (5.0 - 2.5) / 100 / 360 * days
    assert r["strat"].iloc[0] == pytest.approx(0.01 - COST_PER_UNIT - long_fin)  # enter long, +1%
    assert r["strat"].iloc[1] == pytest.approx(1 / 101 - long_fin)
    # Friday -> Monday: a short held over the weekend earns three calendar days of financing.
    assert r["strat"].iloc[2] == pytest.approx(-(101 / 102 - 1) - 2 * COST_PER_UNIT + 3 * short_fin)


def test_metrics_drawdown_and_sharpe():
    r = pd.Series([0.1, -0.5, 0.2])
    m = metrics(r)
    assert m["maxDrawdown"] == pytest.approx(-0.5)
    assert m["totalReturn"] == pytest.approx(1.1 * 0.5 * 1.2 - 1)
