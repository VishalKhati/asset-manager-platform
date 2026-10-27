"""Interim live feed of *spot* gold without an MT5 terminal: Swissquote public quotes.

    python -m mt5feeder.spot --api-url http://localhost:8080 --secret … [--poll-seconds 2]

Swissquote publishes live XAU/USD bid/ask from its regulated broker platforms. Spot brokers
(Vantage included) usually agree with it within a few cents, unlike the Binance perpetual,
which trades several dollars above spot.

Bars are built from quotes polled every few seconds. Each bar is on an estimated MT5-style
bid: the Swissquote mid minus half of a fixed spread (default 0.30, like a typical MT5 gold
account), so the mid matches spot and the spread matches what the strategy expects. Highs
and lows can miss spikes shorter than the poll interval. Bars outside gold trading hours are
dropped. The first, partial minute after start-up is skipped.

There is no backfill: start it on top of existing history. Use the MT5 feeder for anything
beyond demos and research.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import statistics
import time
import urllib.request

from .api import IngestClient
from .binance import gold_market_open

QUOTES = "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD"
log = logging.getLogger("mt5feeder.spot")


def parse_quotes(body: object) -> tuple[float, float] | None:
    """Median bid and ask across Swissquote's platforms, or None if nothing usable."""
    bids: list[float] = []
    asks: list[float] = []
    if not isinstance(body, list):
        return None
    for entry in body:
        try:
            p = entry["spreadProfilePrices"][0]
            bid, ask = float(p["bid"]), float(p["ask"])
        except (KeyError, IndexError, TypeError, ValueError):
            continue
        if bid > 0 and ask >= bid:
            bids.append(bid)
            asks.append(ask)
    if not bids:
        return None
    return statistics.median(bids), statistics.median(asks)


class BarBuilder:
    """Turns timestamped mid prices into closed M1 bars on an estimated bid."""

    def __init__(self, spread: float):
        self.spread = spread
        self.cur: dict | None = None
        self.skip_first = True

    def add(self, t: float, mid: float) -> dict | None:
        """Add one price. Returns the previous bar when a new minute starts."""
        price = round(mid - self.spread / 2, 3)
        minute = int(t) // 60 * 60
        done = None
        if self.cur is not None and minute > self.cur["t"]:
            done = self.cur
            self.cur = None
            if self.skip_first:
                # The first minute after start-up only saw part of the minute.
                self.skip_first = False
                done = None
            elif not gold_market_open(done["t"]):
                done = None
        if self.cur is None:
            self.cur = {"t": minute, "o": price, "h": price, "l": price, "c": price, "spread": self.spread}
        else:
            self.cur["h"] = max(self.cur["h"], price)
            self.cur["l"] = min(self.cur["l"], price)
            self.cur["c"] = price
        return done


def fetch() -> tuple[float, float] | None:
    req = urllib.request.Request(QUOTES, headers={"User-Agent": "mt5feeder-spot/0.1"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return parse_quotes(json.loads(r.read()))


def run(client: IngestClient, spread: float, poll_s: float) -> None:
    builder = BarBuilder(spread)
    failures = 0
    while True:
        try:
            q = fetch()
            if q is None:
                raise ValueError("no usable quote")
            if failures >= 3:
                log.info("quotes recovered")
            failures = 0
            bar = builder.add(time.time(), (q[0] + q[1]) / 2)
            if bar:
                res = client.send_bars("XAUUSD", [bar], {"terminalConnected": True, "version": "swissquote-spot"})
                log.info("sent bar %s c=%.2f (inserted %s, revised %s)", time.strftime("%H:%M", time.gmtime(bar["t"])), bar["c"],
                         res.get("inserted"), res.get("revised"))
        except Exception as err:
            failures += 1
            if failures == 3 or failures % 60 == 0:
                log.warning("spot feed error (%d in a row): %s", failures, err)
        time.sleep(poll_s)


def main() -> None:
    ap = argparse.ArgumentParser(prog="mt5feeder.spot")
    ap.add_argument("--api-url", default=os.environ.get("API_URL", "http://localhost:8080"))
    ap.add_argument("--secret", default=os.environ.get("FEEDER_HMAC_SECRET", ""))
    ap.add_argument("--spread", type=float, default=0.30, help="fixed MT5-style spread in price units")
    ap.add_argument("--poll-seconds", type=float, default=2.0)
    args = ap.parse_args()
    if not args.secret:
        raise SystemExit("set FEEDER_HMAC_SECRET or --secret")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    run(IngestClient(args.api_url, "swissquote-spot", args.secret), args.spread, args.poll_seconds)


if __name__ == "__main__":
    main()
