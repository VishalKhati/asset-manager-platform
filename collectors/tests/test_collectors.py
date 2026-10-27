import gzip

import pytest

from goldflow.book import DailyWriter, MinuteHeatmap, MinuteTape, bucket
from goldflow.gex import gex_summary, parse_chain


def test_parse_occ_symbols_and_skip_empty_contracts():
    data = {"current_price": 380.0, "options": [
        {"option": "GLD261120C00380000", "open_interest": 100, "gamma": 0.02},
        {"option": "GLD261120P00370000", "open_interest": 50, "gamma": 0.03},
        {"option": "GLD261120P00360000", "open_interest": 0, "gamma": 0.03},
    ]}
    spot, cs = parse_chain(data)
    assert spot == 380.0
    assert [(c.expiry, c.call, c.strike) for c in cs] == [("2026-11-20", True, 380.0), ("2026-11-20", False, 370.0)]


def test_gex_sign_walls_and_gold_conversion():
    spot, cs = parse_chain({"current_price": 100.0, "options": [
        {"option": "GLD261120P00090000", "open_interest": 1000, "gamma": 0.05},  # -500,000 at 90
        {"option": "GLD261120C00100000", "open_interest": 300, "gamma": 0.05},   # +150,000 at 100
        {"option": "GLD261120C00110000", "open_interest": 2000, "gamma": 0.05},  # +1,000,000 at 110
    ]})
    s = gex_summary(spot, cs, gold_per_gld=10.0)
    assert s["totalGexUsdPer1pct"] == pytest.approx(650_000)
    assert s["regime"] == "positive"
    assert s["gammaFlipGld"] == 110.0  # cumulative turns positive at 110
    assert (s["callWallGold"], s["putWallGold"]) == (1100.0, 900.0)


def test_heatmap_averages_per_minute_and_bucket():
    h = MinuteHeatmap()
    assert h.add(60_000, [["4000.20", "2"]], [["4000.70", "1"]]) == []
    assert h.add(60_500, [["4000.40", "4"]], []) == []
    rows = h.add(120_000, [["4001", "1"]], [])  # next minute flushes the previous one
    assert rows == [(60, "ask", 4000.5, 0.5), (60, "bid", 4000.0, 3.0)]
    assert bucket(4000.49) == 4000.0


def test_tape_minute_bars_split_aggressor_volume():
    t = MinuteTape()
    t.add(60_000, 4000.0, 2.0, False)  # aggressive buy
    t.add(61_000, 4001.0, 1.0, True)   # aggressive sell
    rows = t.add(125_000, 4002.0, 1.0, False)
    assert rows == [(60, 4000.0, 4001.0, 4000.0, 4001.0, 3.0, 2.0, 1.0)]


def test_daily_writer_appends_with_one_header(tmp_path):
    w = DailyWriter(tmp_path, "tape", "minute,x")
    w.write([(86_400, 1)])
    w.write([(86_460, 2)])
    lines = gzip.open(tmp_path / "tape-1970-01-02.csv.gz", "rt").read().splitlines()
    assert lines == ["minute,x", "86400,1", "86460,2"]
