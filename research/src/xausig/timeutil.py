"""Session and calendar helpers. All timestamps are UTC epoch seconds."""

from __future__ import annotations

from datetime import UTC, datetime
from functools import lru_cache
from zoneinfo import ZoneInfo

from .params import Session, hhmm_to_minutes

DAY = 86_400
FRIDAY = 4  # datetime.weekday()


@lru_cache(maxsize=16)
def _zone(name: str) -> ZoneInfo:
    return ZoneInfo(name)


def local_weekday_minutes(t: int, tz: str) -> tuple[int, int]:
    dt = datetime.fromtimestamp(t, _zone(tz))
    return dt.weekday(), dt.hour * 60 + dt.minute


def in_sessions(t: int, sessions: tuple[Session, ...]) -> bool:
    """True if ``t`` falls inside any session, on a local weekday (Mon-Fri)."""
    for s in sessions:
        weekday, minutes = local_weekday_minutes(t, s.tz)
        if weekday < 5 and hhmm_to_minutes(s.start) <= minutes < hhmm_to_minutes(s.end):
            return True
    return False


def utc_weekday(t: int) -> int:
    # 1970-01-01 was a Thursday (weekday 3).
    return (t // DAY + 3) % 7


def utc_minute_of_day(t: int) -> int:
    return (t % DAY) // 60


def after_friday_cutoff(t: int, cutoff_hhmm: str) -> bool:
    return utc_weekday(t) == FRIDAY and utc_minute_of_day(t) >= hhmm_to_minutes(cutoff_hhmm)


def friday_exit_for(t: int, exit_hhmm: str) -> int | None:
    """If ``t`` is on a Friday (UTC), return that day's forced-exit time, else None."""
    if utc_weekday(t) != FRIDAY:
        return None
    return (t // DAY) * DAY + hhmm_to_minutes(exit_hhmm) * 60


def iso(t: int) -> str:
    return datetime.fromtimestamp(t, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
