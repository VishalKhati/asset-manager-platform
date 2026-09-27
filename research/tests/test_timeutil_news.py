from datetime import UTC, date, datetime

from xausig.news import proxy_calendar
from xausig.params import Params
from xausig.timeutil import after_friday_cutoff, in_sessions, utc_weekday

P = Params()


def ts(s: str) -> int:
    return int(datetime.fromisoformat(s).replace(tzinfo=UTC).timestamp())


def test_utc_weekday():
    assert utc_weekday(ts("2024-03-08T12:00:00")) == 4  # Friday
    assert utc_weekday(ts("2024-03-11T00:00:00")) == 0  # Monday


def test_london_session_follows_bst():
    # Winter: London 07:00 = 07:00 UTC
    assert not in_sessions(ts("2024-01-10T06:55:00"), P.sessions)
    assert in_sessions(ts("2024-01-10T07:00:00"), P.sessions)
    # Summer (BST): London 07:00 = 06:00 UTC
    assert in_sessions(ts("2024-07-10T06:00:00"), P.sessions)
    assert not in_sessions(ts("2024-07-10T05:55:00"), P.sessions)


def test_ny_session_in_dst_gap_week():
    # 2024-03-12: US already on EDT, UK still on GMT. NY 16:00 = 20:00 UTC.
    assert in_sessions(ts("2024-03-12T19:55:00"), P.sessions)
    assert not in_sessions(ts("2024-03-12T20:00:00"), P.sessions)
    # Winter NY 16:00 = 21:00 UTC
    assert in_sessions(ts("2024-01-10T20:55:00"), P.sessions)


def test_weekend_is_closed():
    assert not in_sessions(ts("2024-03-09T12:00:00"), P.sessions)


def test_friday_cutoff():
    assert after_friday_cutoff(ts("2024-03-08T20:00:00"), "20:00")
    assert not after_friday_cutoff(ts("2024-03-08T19:55:00"), "20:00")
    assert not after_friday_cutoff(ts("2024-03-07T21:00:00"), "20:00")


def test_proxy_calendar_contains_nfp_and_fomc():
    cal = proxy_calendar(date(2024, 3, 1), date(2024, 3, 31))
    assert ts("2024-03-08T13:30:00") in cal  # NFP 08:30 EST
    assert ts("2024-03-20T18:00:00") in cal  # FOMC 14:00 EDT
    assert ts("2024-03-01T15:00:00") in cal  # ISM 10:00 EST, first weekday
