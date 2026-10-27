"""Daily gamma-exposure snapshot for gold from CBOE's free, delayed GLD option chain.

Convention (the common "dealer gamma" estimate): dealers are assumed long calls and short
puts, so call gamma counts positive and put gamma negative. GEX per strike, in dollars per
1% move: gamma × open interest × 100 shares × spot² × 0.01. Levels are converted to gold
prices with the GLD→gold ratio observed at snapshot time.

No free source has *historical* GLD option open interest, so this only builds history from
the day collection starts.
"""

from __future__ import annotations

import json
import re
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime

URL = "https://cdn.cboe.com/api/global/delayed_quotes/options/GLD.json"
OCC = re.compile(r"^(?P<root>[A-Z]+)(?P<ymd>\d{6})(?P<cp>[CP])(?P<strike>\d{8})$")


@dataclass(frozen=True)
class Contract:
    expiry: str
    call: bool
    strike: float
    oi: float
    gamma: float


def parse_chain(data: dict) -> tuple[float, list[Contract]]:
    spot = float(data["current_price"])
    out = []
    for o in data["options"]:
        m = OCC.match(o["option"])
        if not m or not o.get("open_interest") or not o.get("gamma"):
            continue
        ymd = m["ymd"]
        expiry = f"20{ymd[:2]}-{ymd[2:4]}-{ymd[4:]}"
        out.append(Contract(expiry, m["cp"] == "C", int(m["strike"]) / 1000, float(o["open_interest"]), float(o["gamma"])))
    return spot, out


def gex_summary(spot: float, contracts: list[Contract], gold_per_gld: float | None = None) -> dict:
    by_strike: dict[float, float] = {}
    call_g: dict[float, float] = {}
    put_g: dict[float, float] = {}
    for c in contracts:
        g = c.gamma * c.oi * 100 * spot * spot * 0.01
        by_strike[c.strike] = by_strike.get(c.strike, 0.0) + (g if c.call else -g)
        (call_g if c.call else put_g)[c.strike] = (call_g if c.call else put_g).get(c.strike, 0.0) + g
    strikes = sorted(by_strike)
    total = sum(by_strike.values())
    # Gamma flip: the strike where cumulative GEX (from low strikes up) changes sign.
    flip = None
    cum = 0.0
    prev = None
    for k in strikes:
        before = cum
        cum += by_strike[k]
        if prev is not None and before < 0 <= cum:
            flip = k
        prev = k
    call_wall = max(call_g, key=call_g.get) if call_g else None
    put_wall = max(put_g, key=put_g.get) if put_g else None
    ratio = gold_per_gld

    def gold(x):
        return None if x is None or ratio is None else round(x * ratio, 2)

    return {
        "gldSpot": spot,
        "totalGexUsdPer1pct": round(total, 0),
        "regime": "positive" if total >= 0 else "negative",
        "gammaFlipGld": flip,
        "callWallGld": call_wall,
        "putWallGld": put_wall,
        "goldPerGld": ratio,
        "gammaFlipGold": gold(flip),
        "callWallGold": gold(call_wall),
        "putWallGold": gold(put_wall),
        "contracts": len(contracts),
    }


def fetch_chain(timeout: float = 30.0) -> dict:
    req = urllib.request.Request(URL, headers={"User-Agent": "goldflow-collector/0.1"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())["data"]


def snapshot(gold_price: float | None) -> dict:
    data = fetch_chain()
    spot, contracts = parse_chain(data)
    ratio = gold_price / spot if gold_price else None
    return {"takenAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), "quoteTime": data.get("last_trade_time"),
            **gex_summary(spot, contracts, ratio)}
