"""Interim live feed without an MT5 terminal: Binance XAUUSDT perpetual 1-minute bars.

    python -m mt5feeder.binance --api-url http://localhost:8080 --secret … [--backfill-days 20]

Backfills the last N days, then polls every few seconds and sends each newly *closed* bar
through the same signed ingest API as the MT5 feeder. Bars outside spot gold's trading hours
(Friday 17:00 to Sunday 18:00 New York, and the daily 17:00–18:00 break) are dropped, because
the perp trades 24/7 but MT5 spot gold does not.

Caveats: the perp trades a few dollars above spot, and the spread sent is a constant
MT5-like 0.30. Use the MT5 feeder for anything beyond demos and research.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import time
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

from .api import IngestClient

KLINES = "https://fapi.binance.com/fapi/v1/klines?symbol=XAUUSDT&interval=1m&startTime={}&limit=1500"
NY = ZoneInfo("America/New_York")
SPREAD = 0.30
log = logging.getLogger("mt5feeder.binance")


def gold_market_open(t: int) -> bool:
    """Same rule as the engine's marketHours.ts: closed Fri 17:00 – Sun 18:00 NY and daily 17:00–18:00."""
    d = datetime.fromtimestamp(t, NY)
    minutes = d.hour * 60 + d.minute
    wd = d.weekday()
    if wd == 5:
        return False
    if wd == 6:
        return minutes >= 18 * 60
    if wd == 4 and minutes >= 17 * 60:
        return False
    return not (17 * 60 <= minutes < 18 * 60)


def to_bars(klines: list, now_ms: int) -> list[dict]:
    """Closed klines inside gold trading hours → ingest bars."""
    out = []
    for k in klines:
        open_ms, close_ms = int(k[0]), int(k[6])
        if close_ms >= now_ms:
            continue  # still forming
        t = open_ms // 1000
        if not gold_market_open(t):
            continue
        out.append({"t": t, "o": float(k[1]), "h": float(k[2]), "l": float(k[3]), "c": float(k[4]), "spread": SPREAD,
                    "volume": float(k[5])})
    return out


def fetch(start_ms: int) -> list:
    req = urllib.request.Request(KLINES.format(start_ms), headers={"User-Agent": "mt5feeder-binance/0.1"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def run(client: IngestClient, backfill_days: int, poll_s: float) -> None:
    cursor_ms = int((time.time() - backfill_days * 86_400) // 60 * 60 * 1000)
    while True:
        try:
            now_ms = int(time.time() * 1000)
            klines = fetch(cursor_ms)
            bars = to_bars(klines, now_ms)
            if bars:
                res = client.send_bars("XAUUSD", bars, {"terminalConnected": True, "version": "binance-perp"})
                last = datetime.fromtimestamp(bars[-1]["t"], NY).strftime("%Y-%m-%d %H:%M NY")
                log.info("sent %d bars up to %s (inserted %s, revised %s)", len(bars), last, res.get("inserted"), res.get("revised"))
            closed = [k for k in klines if int(k[6]) < now_ms]
            if closed:
                cursor_ms = int(closed[-1][0]) + 60_000
            if len(klines) == 1500:
                continue  # still backfilling
        except Exception as err:
            log.warning("binance feed error: %s", err)
        time.sleep(poll_s)


def main() -> None:
    ap = argparse.ArgumentParser(prog="mt5feeder.binance")
    ap.add_argument("--api-url", default=os.environ.get("API_URL", "http://localhost:8080"))
    ap.add_argument("--secret", default=os.environ.get("FEEDER_HMAC_SECRET", ""))
    ap.add_argument("--backfill-days", type=int, default=20)
    ap.add_argument("--poll-seconds", type=float, default=5.0)
    args = ap.parse_args()
    if not args.secret:
        raise SystemExit("set FEEDER_HMAC_SECRET or --secret")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    run(IngestClient(args.api_url, "binance-perp", args.secret), args.backfill_days, args.poll_seconds)


if __name__ == "__main__":
    main()
