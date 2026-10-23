from datetime import datetime
from zoneinfo import ZoneInfo

from mt5feeder.binance import gold_market_open, to_bars

NY = ZoneInfo("America/New_York")


def ts(y, mo, d, h, mi):
    return int(datetime(y, mo, d, h, mi, tzinfo=NY).timestamp())


def test_market_hours_match_spot_gold():
    assert gold_market_open(ts(2026, 10, 14, 10, 0))  # Wednesday morning
    assert not gold_market_open(ts(2026, 10, 14, 17, 30))  # daily break
    assert not gold_market_open(ts(2026, 10, 16, 17, 0))  # Friday close
    assert not gold_market_open(ts(2026, 10, 17, 12, 0))  # Saturday
    assert not gold_market_open(ts(2026, 10, 18, 17, 59))  # Sunday before open
    assert gold_market_open(ts(2026, 10, 18, 18, 0))  # Sunday open


def kline(t, c=4100.0):
    return [t * 1000, "4100", "4101", "4099", str(c), "12.5", t * 1000 + 59_999, "0", 1, "0", "0", "0"]


def test_only_closed_bars_inside_trading_hours():
    open_t = ts(2026, 10, 14, 10, 0)
    sat = ts(2026, 10, 17, 12, 0)
    now_ms = (open_t + 90) * 1000  # the 10:01 bar is still forming
    bars = to_bars([kline(open_t), kline(open_t + 60), kline(sat)], now_ms)
    assert [b["t"] for b in bars] == [open_t]
    assert bars[0]["spread"] == 0.30 and bars[0]["c"] == 4100.0
