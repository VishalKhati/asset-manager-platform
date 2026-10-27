"""Free gold order-flow data: trade tapes → M1 bars with aggressive buy/sell volume, and
per-session volume profiles. Implements the data section of research/HYPOTHESIS_V3.md.

Session rule (clarified before any result was seen): a gold session D runs from 18:00
New York on the previous day to 17:00 New York on D, for weekdays D. Trades in the daily
17:00–18:00 break and on weekends belong to no session: they are kept in price bars but
excluded from profiles and from cumulative delta.
"""

from __future__ import annotations

import zipfile
from collections.abc import Iterable
from pathlib import Path

import numpy as np
import pandas as pd

MT5_SPREAD = 0.30  # constant MT5-like spread used for execution (HYPOTHESIS_V3.md)


def session_ids(ts_s: np.ndarray) -> np.ndarray:
    """Session id (NY date ordinal, int) per UTC second, or -1 outside sessions."""
    t = pd.to_datetime(ts_s, unit="s", utc=True).tz_convert("America/New_York")
    hour = t.hour.to_numpy()
    shifted = (t + pd.to_timedelta(np.where(hour >= 18, 1, 0), unit="D")).normalize()
    in_break = hour == 17
    weekday = shifted.weekday.to_numpy()
    ordinal = (shifted.tz_localize(None).to_numpy().astype("datetime64[D]").astype(np.int64))
    sid = np.where(in_break | (weekday >= 5), -1, ordinal)
    return sid.astype(np.int64)


def _trades_binance(path: Path) -> pd.DataFrame:
    with zipfile.ZipFile(path) as z:
        name = z.namelist()[0]
        with z.open(name) as f:
            first = f.readline().decode()
        header = 0 if first.startswith("agg_trade_id") else None
        with z.open(name) as f:
            df = pd.read_csv(f, header=header, usecols=[1, 2, 5, 6],
                             names=None if header == 0 else ["id", "price", "quantity", "f", "l", "transact_time", "is_buyer_maker"])
    df.columns = ["price", "qty", "ms", "maker"]
    maker = df["maker"].astype(str).str.lower() == "true"
    ts_ms = df["ms"].to_numpy()
    ts = np.where(ts_ms > 1e14, ts_ms // 1000, ts_ms) // 1000  # tolerate microsecond timestamps
    return pd.DataFrame({"ts": ts.astype(np.int64), "price": df["price"].to_numpy(float),
                         "qty": df["qty"].to_numpy(float), "buy": (~maker).to_numpy()})


def _trades_bybit(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, usecols=["timestamp", "side", "size", "price"])
    return pd.DataFrame({"ts": df["timestamp"].to_numpy(float).astype(np.int64), "price": df["price"].to_numpy(float),
                         "qty": df["size"].to_numpy(float), "buy": (df["side"] == "Buy").to_numpy()})


def _bars_and_profile(tr: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    tr = tr.sort_values("ts", kind="stable")
    minute = tr["ts"].to_numpy() // 60 * 60
    buyv = np.where(tr["buy"], tr["qty"], 0.0)
    g = pd.DataFrame({"t": minute, "price": tr["price"].to_numpy(), "qty": tr["qty"].to_numpy(), "buyv": buyv})
    bars = g.groupby("t").agg(o=("price", "first"), h=("price", "max"), l=("price", "min"), c=("price", "last"),
                              v=("qty", "sum"), buy=("buyv", "sum")).reset_index()
    bars["sell"] = bars["v"] - bars["buy"]
    sid = session_ids(tr["ts"].to_numpy())
    keep = sid >= 0
    prof = pd.DataFrame({"session": sid[keep], "bucket": np.floor(tr["price"].to_numpy()[keep]).astype(np.int64),
                         "qty": tr["qty"].to_numpy()[keep], "pq": (tr["price"] * tr["qty"]).to_numpy()[keep]})
    prof = prof.groupby(["session", "bucket"]).agg(qty=("qty", "sum"), pq=("pq", "sum")).reset_index()
    return bars, prof


def build(paths: Iterable[Path], venue: str, out_dir: Path) -> dict:
    """Convert raw trade files into `m1.parquet` and `profile.parquet` under out_dir."""
    reader = _trades_binance if venue == "binance" else _trades_bybit
    bars_parts, prof_parts, n_trades = [], [], 0
    for p in sorted(paths):
        tr = reader(p)
        n_trades += len(tr)
        b, pr = _bars_and_profile(tr)
        bars_parts.append(b)
        prof_parts.append(pr)
    bars = pd.concat(bars_parts)
    # A minute split across two files: merge it.
    bars = bars.sort_values("t").groupby("t").agg(o=("o", "first"), h=("h", "max"), l=("l", "min"), c=("c", "last"),
                                                  v=("v", "sum"), buy=("buy", "sum"), sell=("sell", "sum")).reset_index()
    bars["spread"] = MT5_SPREAD
    bars["session"] = session_ids(bars["t"].to_numpy())
    prof = pd.concat(prof_parts).groupby(["session", "bucket"]).sum().reset_index()
    out_dir.mkdir(parents=True, exist_ok=True)
    bars.to_parquet(out_dir / "m1.parquet", index=False)
    prof.to_parquet(out_dir / "profile.parquet", index=False)
    return {"venue": venue, "trades": n_trades, "m1Bars": len(bars), "sessions": int(prof["session"].nunique()),
            "from": int(bars["t"].iloc[0]), "to": int(bars["t"].iloc[-1])}


def value_areas(profile: pd.DataFrame, share: float = 0.70) -> dict[int, tuple[float, float, float]]:
    """session id → (POC, VAH, VAL) per HYPOTHESIS_V3.md. POC is the bucket midpoint."""
    out: dict[int, tuple[float, float, float]] = {}
    for sid, g in profile.groupby("session"):
        g = g.sort_values("bucket")
        buckets = g["bucket"].to_numpy()
        vol = g["qty"].to_numpy()
        # Fill missing buckets with zero volume so "adjacent" means price-adjacent.
        full = np.arange(buckets[0], buckets[-1] + 1)
        v = np.zeros(len(full))
        v[buckets - buckets[0]] = vol
        vwap = g["pq"].sum() / g["qty"].sum()
        top = v.max()
        cands = np.flatnonzero(v == top)
        poc_i = int(cands[np.argmin(np.abs(full[cands] + 0.5 - vwap))])
        lo_i = hi_i = poc_i
        acc = v[poc_i]
        total = v.sum()
        while acc < share * total:
            up = v[hi_i + 1] if hi_i + 1 < len(v) else -1.0
            dn = v[lo_i - 1] if lo_i > 0 else -1.0
            if up >= dn:
                hi_i += 1
                acc += up
            else:
                lo_i -= 1
                acc += dn
        out[int(sid)] = (float(full[poc_i] + 0.5), float(full[hi_i] + 1), float(full[lo_i]))
    return out
