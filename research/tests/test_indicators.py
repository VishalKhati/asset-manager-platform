import math

from xausig.indicators import Atr, Ema, Stoch


def test_ema_seed_and_recursion():
    e = Ema(3)
    assert math.isnan(e.update(1.0))
    assert math.isnan(e.update(2.0))
    assert e.update(3.0) == 2.0  # SMA seed
    # alpha = 0.5 -> 0.5 * 5 + 0.5 * 2
    assert e.update(5.0) == 3.5
    assert e.update(1.0) == 2.25


def test_atr_wilder():
    a = Atr(2)
    assert math.isnan(a.update(10.0, 8.0, 9.0))  # TR = 2
    # TR = max(1, |11 - 9|, |10 - 9|) = 2 -> seed mean(2, 2) = 2
    assert a.update(11.0, 10.0, 10.5) == 2.0
    # TR = max(3, |12 - 10.5|, |9 - 10.5|) = 3 -> (2 * 1 + 3) / 2
    assert a.update(12.0, 9.0, 11.0) == 2.5


def test_stoch_values():
    s = Stoch(2, 2, 2)
    assert all(math.isnan(v) for v in s.update(10, 8, 9))
    # raw over bars 1-2: hh=12, ll=8 -> (11-8)/4*100 = 75
    k, d = s.update(12, 9, 11)
    assert math.isnan(k)
    # raw over bars 2-3: hh=12, ll=9 -> (12-9)/3*100 = 100 -> %K = mean(75, 100)
    k, d = s.update(12, 10, 12)
    assert k == 87.5 and math.isnan(d)
    # raw: hh=12, ll=10 -> (10-10)/2 = 0 -> %K = mean(100, 0) = 50 -> %D = mean(87.5, 50)
    k, d = s.update(11, 10, 10)
    assert k == 50.0 and d == 68.75


def test_stoch_flat_range_is_50():
    s = Stoch(2, 1, 1)
    s.update(5, 5, 5)
    k, d = s.update(5, 5, 5)
    assert k == 50.0 and d == 50.0
