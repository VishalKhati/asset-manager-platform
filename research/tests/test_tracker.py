import pytest

from xausig.bars import Bar
from xausig.params import Params
from xausig.strategy import Plan
from xausig.tracker import advance, new_signal

P = Params(commission=0.0, slippage=0.0, tp1Fraction=0.5, entryToleranceR=0.25, maxHoldMin=240)
T0 = 1_709_550_000  # a Monday, 11:00 UTC


def long_plan(entry=100.0, risk=1.0):
    return Plan(1, entry, entry - risk, entry + risk, entry + 2 * risk, risk, 0.66, 0.0)


def short_plan(entry=100.0, risk=1.0):
    return Plan(-1, entry, entry + risk, entry - risk, entry - 2 * risk, risk, 0.66, 0.0)


def bar(i, o, h, low, c, s=0.0):
    return Bar(T0 + 60 * i, o, h, low, c, s)


def run(plan, bars, p=P):
    sig = new_signal(1, T0, plan, p)
    for b in bars:
        advance(sig, b, p)
        if not sig.is_open:
            break
    return sig


def test_long_tp2_with_partial():
    s = run(long_plan(), [bar(0, 100, 100.5, 99.8, 100.2), bar(1, 100.2, 101.2, 100.1, 101), bar(2, 101, 102.1, 100.9, 102)])
    assert s.outcome == "tp2"
    assert s.r_net == pytest.approx(0.5 * 1 + 0.5 * 2)


def test_long_tp1_then_breakeven():
    s = run(long_plan(), [bar(0, 100, 101.1, 99.9, 101), bar(1, 101, 101.2, 99.95, 100)])
    assert s.outcome == "tp1_be"
    assert s.r_net == pytest.approx(0.5)


def test_same_bar_stop_and_target_stop_wins():
    s = run(long_plan(), [bar(0, 100, 102.5, 98.9, 100)])
    assert s.outcome == "sl"
    assert s.r_net == pytest.approx(-1.0)


def test_tp1_bar_touching_breakeven_closes_at_breakeven():
    s = run(long_plan(), [bar(0, 100, 101.5, 99.95, 100.5)])
    # fills at 100; TP1 at 101 and the same bar trades back to 100 -> BE
    assert s.outcome == "tp1_be"
    assert s.r_net == pytest.approx(0.5)


def test_gap_through_stop_fills_at_open():
    s = run(long_plan(), [bar(0, 100, 100.2, 99.9, 100), bar(1, 98.5, 98.7, 98.2, 98.4)])
    assert s.outcome == "sl"
    assert s.r_net == pytest.approx(-1.5)


def test_short_uses_ask_for_exits():
    # spread 0.2: ask = bid + 0.2. Bid entry at open 100.
    bars = [bar(0, 100, 100.1, 99.5, 99.9, 0.2), bar(1, 99.9, 100.85, 99.8, 100.5, 0.2)]
    s = run(short_plan(), bars)
    # ask high = 101.05 >= SL 101 -> stopped
    assert s.outcome == "sl"
    assert s.r_net == pytest.approx(-1.0)


def test_expired_when_price_ran_away():
    s = run(long_plan(), [bar(0, 100.4, 100.5, 100.3, 100.4)])
    assert s.outcome == "expired"
    assert s.r_net == 0.0


def test_time_exit():
    p = P.replace(maxHoldMin=2)
    s = run(long_plan(), [bar(0, 100, 100.2, 99.9, 100.1), bar(1, 100.1, 100.3, 100, 100.2), bar(2, 100.3, 100.4, 100.2, 100.3)], p)
    assert s.outcome == "time_exit"
    assert s.r_net == pytest.approx(0.3)


def test_costs_reduce_r():
    p = P.replace(commission=0.1, slippage=0.0)
    s = run(long_plan(), [bar(0, 100, 100.2, 98.9, 99)], p)
    assert s.r_gross == pytest.approx(-1.0)
    assert s.r_net == pytest.approx(-1.1)
