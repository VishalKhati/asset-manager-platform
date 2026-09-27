"""Push historical M1 bars from a CSV (t,o,h,l,c,spread) through the signed ingest API.

Used for demos and end-to-end tests without an MT5 terminal:

    python -m mt5feeder.replay --csv ../fixtures/golden/dst_gap_mar_2021/m1.csv --shift-weeks auto

``--shift-weeks auto`` moves the data forward by whole weeks (so weekdays and session hours
still line up) until the last bar is within the past week.
"""

from __future__ import annotations

import argparse
import csv
import os
import time

from .api import IngestClient

WEEK = 7 * 86_400


def load(path: str) -> list[dict]:
    with open(path, newline="") as f:
        return [
            {"t": int(r["t"]), "o": float(r["o"]), "h": float(r["h"]), "l": float(r["l"]), "c": float(r["c"]),
             "spread": float(r["spread"])}
            for r in csv.DictReader(f)
        ]


def auto_shift_weeks(last_t: int, now: float) -> int:
    return max(0, int((now - 60 - last_t) // WEEK))


def main() -> None:
    ap = argparse.ArgumentParser(prog="mt5feeder.replay")
    ap.add_argument("--csv", required=True)
    ap.add_argument("--api-url", default=os.environ.get("API_URL", "http://localhost:8080"))
    ap.add_argument("--secret", default=os.environ.get("FEEDER_HMAC_SECRET", ""))
    ap.add_argument("--feeder-id", default="replay")
    ap.add_argument("--symbol", default="XAUUSD")
    ap.add_argument("--shift-weeks", default="0", help="whole weeks to add, or 'auto'")
    ap.add_argument("--batch", type=int, default=2000)
    args = ap.parse_args()
    if not args.secret:
        raise SystemExit("set FEEDER_HMAC_SECRET or --secret")

    bars = load(args.csv)
    weeks = auto_shift_weeks(bars[-1]["t"], time.time()) if args.shift_weeks == "auto" else int(args.shift_weeks)
    for b in bars:
        b["t"] += weeks * WEEK
    client = IngestClient(args.api_url, args.feeder_id, args.secret)
    sent = 0
    for i in range(0, len(bars), args.batch):
        res = client.send_bars(args.symbol, bars[i : i + args.batch], {"terminalConnected": True, "version": "replay"})
        sent += res.get("inserted", 0) + res.get("revised", 0)
    print(f"pushed {len(bars)} bars (shifted {weeks} weeks), stored {sent}")


if __name__ == "__main__":
    main()
