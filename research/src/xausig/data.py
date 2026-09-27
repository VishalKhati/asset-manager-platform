"""Loads Dukascopy M1 CSVs (bid and ask) into one parquet file of bid bars plus spread."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

COLUMNS = ["t", "o", "h", "l", "c", "spread", "v"]


def _read(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["t"] = (df["timestamp"] // 1000).astype("int64")
    return df.drop(columns=["timestamp"])


def build_m1(raw_dir: Path, out_path: Path, symbol: str = "xauusd") -> dict:
    """Merge yearly bid/ask files, derive spread = ask close - bid close, write parquet + manifest."""
    bids, asks = [], []
    for side, sink in (("bid", bids), ("ask", asks)):
        # Yearly files in raw/, monthly files in raw/monthly/. raw/partial/ holds failed downloads.
        files = sorted(raw_dir.glob(f"{symbol}_m1_{side}_*.csv")) + sorted(
            raw_dir.glob(f"monthly/{symbol}_m1_{side}_*.csv"))
        for f in files:
            if f.stat().st_size and ".part" not in f.name:
                sink.append(_read(f))
    if not bids or not asks:
        raise FileNotFoundError(f"no bid/ask CSVs in {raw_dir}")
    bid = pd.concat(bids).drop_duplicates("t").sort_values("t")
    ask = pd.concat(asks).drop_duplicates("t").sort_values("t")
    m = bid.merge(ask[["t", "open", "high", "low", "close"]].add_prefix("ask_").rename(columns={"ask_t": "t"}),
                  on="t", how="outer")
    have_bid = m["close"].notna()
    have_ask = m["ask_close"].notna()
    both = have_bid & have_ask
    m["spread"] = np.where(both, np.maximum(m["ask_close"] - m["close"], 0.0), np.nan)
    # Months where Dukascopy only served one side (HTTP 429s) are rebuilt from the other side
    # with the median spread for that UTC hour, and flagged in the manifest.
    hour = (m["t"] % 86_400) // 3600
    hourly = m.loc[both].groupby(hour[both])["spread"].median()
    typical = hour.map(hourly).fillna(float(m.loc[both, "spread"].median()))
    only_ask = have_ask & ~have_bid
    for col in ("open", "high", "low", "close"):
        m.loc[only_ask, col] = m.loc[only_ask, f"ask_{col}"] - typical[only_ask]
    m.loc[only_ask, "volume"] = 0.0
    m["spread"] = m["spread"].fillna(typical)
    m = m.sort_values("t").reset_index(drop=True)
    imputed_bid_only = int((have_bid & ~have_ask).sum())
    imputed_ask_only = int(only_ask.sum())
    out = pd.DataFrame(
        {
            "t": m["t"].astype("int64"),
            "o": m["open"].astype("float64"),
            "h": m["high"].astype("float64"),
            "l": m["low"].astype("float64"),
            "c": m["close"].astype("float64"),
            "spread": m["spread"].astype("float64"),
            "v": m["volume"].fillna(0.0).astype("float64"),
        }
    )
    # Drop malformed rows rather than guessing.
    ok = (out["h"] >= out["l"]) & (out["o"] > 0) & (out["c"] > 0)
    dropped = int((~ok).sum())
    out = out[ok].reset_index(drop=True)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(out_path, index=False)
    digest = hashlib.sha256(out_path.read_bytes()).hexdigest()
    manifest = {
        "source": "dukascopy",
        "symbol": symbol.upper(),
        "timeframe": "M1",
        "priceSide": "bid OHLC; spread = ask close - bid close",
        "rows": int(len(out)),
        "droppedRows": dropped,
        "rowsBidOnlySpreadEstimated": imputed_bid_only,
        "rowsAskOnlyBidEstimated": imputed_ask_only,
        "from": int(out["t"].iloc[0]),
        "to": int(out["t"].iloc[-1]),
        "sha256": digest,
    }
    (out_path.parent / "MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def load_m1(path: Path) -> pd.DataFrame:
    return pd.read_parquet(path)


def qa_report(df: pd.DataFrame) -> dict:
    """Coverage and spread statistics used to set filter thresholds."""
    t = df["t"].to_numpy()
    gaps = np.diff(t)
    hours = (t % 86_400) // 3600
    spread = df["spread"].to_numpy()
    by_hour = {
        int(h): {
            "median": float(np.median(spread[hours == h])),
            "p90": float(np.percentile(spread[hours == h], 90)),
        }
        for h in range(24)
        if (hours == h).any()
    }
    return {
        "rows": int(len(df)),
        "gapsOver5Min": int((gaps > 300).sum()),
        "gapsOver1Hour": int((gaps > 3600).sum()),
        "gapsOver3Days": int((gaps > 3 * 86_400).sum()),
        "spreadMedian": float(np.median(spread)),
        "spreadP90": float(np.percentile(spread, 90)),
        "spreadP99": float(np.percentile(spread, 99)),
        "spreadByUtcHour": by_hour,
    }
