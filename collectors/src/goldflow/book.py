"""Records the live Binance XAUUSDT perp order book and trade tape (both free).

- Order book: top-20 levels every 500 ms (`@depth20@500ms`), aggregated per minute into a
  heatmap: the average resting size per $0.50 price bucket, bids and asks separately.
- Tape: every aggregated trade (`@aggTrade`) with its aggressor side, summarised per minute
  as volume, aggressive buy volume and aggressive sell volume.

Output: one gzipped CSV per day and kind under the output folder. The archive on
data.binance.vision has trades and coarse depth with a one-day lag; this fills the gap for
live use and keeps a full-resolution heatmap that has no free history.
"""

from __future__ import annotations

import asyncio
import gzip
import json
import logging
import math
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

log = logging.getLogger("goldflow.book")
# Binance serves order-book streams on the root path and trade streams under /market (2026).
DEPTH_STREAM = "wss://fstream.binance.com/stream?streams=xauusdt@depth20@500ms"
TRADE_STREAM = "wss://fstream.binance.com/market/stream?streams=xauusdt@aggTrade"
BUCKET = 0.5


def bucket(price: float) -> float:
    return math.floor(price / BUCKET) * BUCKET


class MinuteHeatmap:
    """Accumulates depth snapshots; `flush(minute)` returns rows (minute, side, bucket, avg size)."""

    def __init__(self) -> None:
        self.minute: int | None = None
        self.sums: dict[tuple[str, float], float] = defaultdict(float)
        self.snaps = 0

    def add(self, ts_ms: int, bids: list, asks: list) -> list[tuple]:
        minute = ts_ms // 60_000 * 60
        out: list[tuple] = []
        if self.minute is not None and minute != self.minute:
            out = self.flush()
        self.minute = minute
        self.snaps += 1
        for side, levels in (("bid", bids), ("ask", asks)):
            for price, qty in levels:
                self.sums[(side, bucket(float(price)))] += float(qty)
        return out

    def flush(self) -> list[tuple]:
        if self.minute is None or not self.snaps:
            return []
        rows = [(self.minute, side, b, round(total / self.snaps, 4)) for (side, b), total in sorted(self.sums.items())]
        self.sums.clear()
        self.snaps = 0
        return rows


class MinuteTape:
    def __init__(self) -> None:
        self.minute: int | None = None
        self.v = self.buy = 0.0
        self.o = self.h = self.l = self.c = None

    def add(self, ts_ms: int, price: float, qty: float, buyer_is_maker: bool) -> list[tuple]:
        minute = ts_ms // 60_000 * 60
        out: list[tuple] = []
        if self.minute is not None and minute != self.minute:
            out = self.flush()
        if self.minute != minute:
            self.minute, self.o, self.h, self.l = minute, price, price, price
        self.h = max(self.h, price)
        self.l = min(self.l, price)
        self.c = price
        self.v += qty
        if not buyer_is_maker:
            self.buy += qty
        return out

    def flush(self) -> list[tuple]:
        if self.minute is None or self.o is None:
            return []
        row = (self.minute, self.o, self.h, self.l, self.c, round(self.v, 6), round(self.buy, 6), round(self.v - self.buy, 6))
        self.v = self.buy = 0.0
        self.o = None
        return [row]


class DailyWriter:
    def __init__(self, out_dir: Path, kind: str, header: str):
        self.out_dir, self.kind, self.header = out_dir, kind, header
        out_dir.mkdir(parents=True, exist_ok=True)

    def write(self, rows: list[tuple]) -> None:
        if not rows:
            return
        day = datetime.fromtimestamp(rows[0][0], UTC).strftime("%Y-%m-%d")
        path = self.out_dir / f"{self.kind}-{day}.csv.gz"
        new = not path.exists()
        with gzip.open(path, "at") as f:
            if new:
                f.write(self.header + "\n")
            for r in rows:
                f.write(",".join(str(x) for x in r) + "\n")


async def _consume(url: str, handle) -> None:
    import websockets  # imported lazily so the pure parts are testable without it

    backoff = 1
    while True:
        try:
            async with websockets.connect(url, ping_interval=20, max_size=2**22) as ws:
                log.info("connected to %s", url)
                backoff = 1
                async for raw in ws:
                    handle(json.loads(raw).get("data", {}))
        except Exception as err:  # reconnect on any network error
            log.warning("stream %s error: %s; reconnecting in %ss", url, err, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)


async def record(out_dir: Path) -> None:
    heat, tape = MinuteHeatmap(), MinuteTape()
    hw = DailyWriter(out_dir, "heatmap", "minute,side,bucket,avg_size")
    tw = DailyWriter(out_dir, "tape", "minute,o,h,l,c,volume,buy,sell")

    def on_depth(d: dict) -> None:
        if "b" in d:
            hw.write(heat.add(int(d["E"]), d["b"], d["a"]))

    def on_trade(d: dict) -> None:
        if d.get("e") == "aggTrade":
            tw.write(tape.add(int(d["T"]), float(d["p"]), float(d["q"]), bool(d["m"])))

    await asyncio.gather(_consume(DEPTH_STREAM, on_depth), _consume(TRADE_STREAM, on_trade))
