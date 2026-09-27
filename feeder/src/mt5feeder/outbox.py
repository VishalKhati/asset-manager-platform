"""SQLite-backed queue and cursor, so bars survive API outages and feeder restarts."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path


class Outbox:
    def __init__(self, path: Path):
        self.db = sqlite3.connect(str(path))
        self.db.execute("pragma journal_mode=wal")
        self.db.execute("create table if not exists bars (t integer primary key, payload text not null)")
        self.db.execute("create table if not exists state (key text primary key, value text not null)")
        self.db.commit()

    # -- cursor ------------------------------------------------------------
    def last_queued_t(self) -> int | None:
        row = self.db.execute("select value from state where key = 'last_queued_t'").fetchone()
        return int(row[0]) if row else None

    # -- queue -------------------------------------------------------------
    def enqueue(self, bars: list[dict]) -> int:
        if not bars:
            return 0
        with self.db:
            self.db.executemany(
                "insert or replace into bars (t, payload) values (?, ?)", [(b["t"], json.dumps(b)) for b in bars]
            )
            last = max(b["t"] for b in bars)
            prev = self.last_queued_t() or 0
            self.db.execute(
                "insert or replace into state (key, value) values ('last_queued_t', ?)", (str(max(last, prev)),)
            )
        return len(bars)

    def peek(self, limit: int) -> list[dict]:
        rows = self.db.execute("select payload from bars order by t limit ?", (limit,)).fetchall()
        return [json.loads(r[0]) for r in rows]

    def ack(self, bars: list[dict]) -> None:
        with self.db:
            self.db.executemany("delete from bars where t = ?", [(b["t"],) for b in bars])

    def pending(self) -> int:
        return int(self.db.execute("select count(*) from bars").fetchone()[0])

    def close(self) -> None:
        self.db.close()
