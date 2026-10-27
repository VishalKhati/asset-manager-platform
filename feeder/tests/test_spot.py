from mt5feeder.spot import BarBuilder, parse_quotes

# Wednesday 2026-10-21 10:00 UTC, gold market open.
T0 = 1792576800


def q(bid, ask):
    return {"spreadProfilePrices": [{"bid": bid, "ask": ask}]}


def test_parse_quotes_takes_median_and_skips_bad_entries():
    body = [q(4000.0, 4000.6), q(4000.2, 4000.8), q(4001.0, 4001.4), {"spreadProfilePrices": []}, q(0, 1), q(5, 4)]
    assert parse_quotes(body) == (4000.2, 4000.8)
    assert parse_quotes([]) is None
    assert parse_quotes({"error": "x"}) is None


def test_bar_builder_skips_partial_first_minute_and_uses_estimated_bid():
    b = BarBuilder(spread=0.30)
    assert b.add(T0 + 30, 4000.0) is None  # partial first minute
    assert b.add(T0 + 60, 4001.0) is None  # closes the skipped minute
    assert b.add(T0 + 80, 4003.0) is None
    assert b.add(T0 + 100, 3999.0) is None
    assert b.add(T0 + 110, 4002.0) is None
    bar = b.add(T0 + 125, 4002.5)
    assert bar == {"t": T0 + 60, "o": 4000.85, "h": 4002.85, "l": 3998.85, "c": 4001.85, "spread": 0.30}


def test_bar_builder_drops_closed_market_minutes():
    sat = 1792929600  # Sunday 2026-10-25 12:00 UTC, before the 18:00 New York open
    b = BarBuilder(spread=0.30)
    b.skip_first = False
    b.add(sat, 4000.0)
    assert b.add(sat + 60, 4000.0) is None
