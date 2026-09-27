"""High-impact USD news times for research.

No free, downloadable historical calendar exists, so research uses a stated proxy:

- 08:30 New York on every weekday (CPI, NFP, PPI, retail sales, GDP and claims all use this slot);
- 10:00 New York on the first weekday of each month (ISM manufacturing);
- 14:00 and 14:30 New York on FOMC decision days (statement and press conference).

The proxy over-blocks (not every weekday has a high-impact 08:30 release), so reports
show results with and without the filter. The live engine uses a real calendar feed.
FOMC dates are the scheduled decision days; the March 2020 emergency cuts are included.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")

FOMC_DATES = [
    # 2019
    "2019-01-30", "2019-03-20", "2019-05-01", "2019-06-19", "2019-07-31", "2019-09-18", "2019-10-30",
    "2019-12-11",
    # 2020 (03-03 and 03-15 were emergency moves)
    "2020-01-29", "2020-03-03", "2020-03-15", "2020-04-29", "2020-06-10", "2020-07-29", "2020-09-16",
    "2020-11-05", "2020-12-16",
    # 2021
    "2021-01-27", "2021-03-17", "2021-04-28", "2021-06-16", "2021-07-28", "2021-09-22", "2021-11-03",
    "2021-12-15",
    # 2022
    "2022-01-26", "2022-03-16", "2022-05-04", "2022-06-15", "2022-07-27", "2022-09-21", "2022-11-02",
    "2022-12-14",
    # 2023
    "2023-02-01", "2023-03-22", "2023-05-03", "2023-06-14", "2023-07-26", "2023-09-20", "2023-11-01",
    "2023-12-13",
    # 2024
    "2024-01-31", "2024-03-20", "2024-05-01", "2024-06-12", "2024-07-31", "2024-09-18", "2024-11-07",
    "2024-12-18",
    # 2025
    "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18", "2025-07-30", "2025-09-17", "2025-10-29",
    "2025-12-10",
    # 2026
    "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28",
    "2026-12-09",
]


def _ny(d: date, hour: int, minute: int) -> int:
    return int(datetime(d.year, d.month, d.day, hour, minute, tzinfo=NY).timestamp())


def proxy_calendar(start: date, end: date) -> list[int]:
    """UTC epoch seconds of proxy high-impact events between ``start`` and ``end`` inclusive."""
    out: list[int] = []
    d = start
    first_weekday_seen: set[tuple[int, int]] = set()
    while d <= end:
        if d.weekday() < 5:
            out.append(_ny(d, 8, 30))
            if (d.year, d.month) not in first_weekday_seen:
                first_weekday_seen.add((d.year, d.month))
                out.append(_ny(d, 10, 0))
        d += timedelta(days=1)
    for s in FOMC_DATES:
        d = date.fromisoformat(s)
        if start <= d <= end:
            out += [_ny(d, 14, 0), _ny(d, 14, 30)]
    return sorted(set(out))
