"""Run the free gold data collectors.

    python -m goldflow.main --out data/goldflow

Records the live Binance gold order book + tape continuously, and takes a GLD gamma-exposure
snapshot once a day after the US close (21:30 UTC) and at start-up.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from datetime import UTC, datetime
from pathlib import Path

from .book import record
from .gex import snapshot

log = logging.getLogger("goldflow")


def _gold_price() -> float | None:
    import urllib.request

    try:
        with urllib.request.urlopen("https://fapi.binance.com/fapi/v1/ticker/price?symbol=XAUUSDT", timeout=15) as r:
            return float(json.loads(r.read())["price"])
    except Exception as err:
        log.warning("gold price lookup failed: %s", err)
        return None


async def gex_loop(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    last_day = None
    while True:
        now = datetime.now(UTC)
        due = last_day is None or (now.strftime("%Y-%m-%d") != last_day and (now.hour, now.minute) >= (21, 30))
        if due:
            try:
                snap = await asyncio.to_thread(snapshot, await asyncio.to_thread(_gold_price))
                with open(out / "gex.jsonl", "a") as f:
                    f.write(json.dumps(snap) + "\n")
                log.info("GEX snapshot: %s regime, flip %s, call wall %s, put wall %s (gold)",
                         snap["regime"], snap["gammaFlipGold"], snap["callWallGold"], snap["putWallGold"])
                last_day = now.strftime("%Y-%m-%d")
            except Exception as err:
                log.warning("GEX snapshot failed: %s", err)
        await asyncio.sleep(300)


async def amain(out: Path) -> None:
    await asyncio.gather(record(out / "binance_live"), gex_loop(out / "gex"))


def main() -> None:
    ap = argparse.ArgumentParser(prog="goldflow")
    ap.add_argument("--out", default="data/goldflow")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    asyncio.run(amain(Path(args.out)))


if __name__ == "__main__":
    main()
