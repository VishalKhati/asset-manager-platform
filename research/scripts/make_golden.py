"""Generate (or --check) the shared golden fixtures in ../../fixtures/golden.

Each case is a slice of real Dukascopy M1 data plus parameters and news times. The
expected output is every M5 decision, the M5/M15 indicator values, and every signal
with its full outcome. ``lib/strategy`` (TypeScript) must reproduce these exactly.

Usage:
    python scripts/make_golden.py          # regenerate
    python scripts/make_golden.py --check  # fail if regenerating would change anything
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import UTC, date, datetime
from pathlib import Path

from xausig.bars import Bar
from xausig.news import proxy_calendar
from xausig.params import Params
from xausig.replay import Replay

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "fixtures" / "golden"
M1_PATH = ROOT / "research" / "data" / "xauusd_m1.parquet"

# Short warm-up keeps fixtures small; everything else is the v1 default unless overridden.
FIXTURE_BASE = {"warmupM5": 150, "warmupM15": 250}

CASES = {
    "dst_gap_mar_2021": {
        "from": "2021-03-01", "to": "2021-03-20",
        "note": "US clocks change 2021-03-14, UK on 2021-03-28: the New York session shifts one hour in UTC.",
        "params": {},
    },
    "dst_gap_oct_2019": {
        "from": "2019-10-14", "to": "2019-11-02",
        "note": "UK clocks change 2019-10-27, US on 2019-11-03.",
        "params": {"tp1Fraction": 0.0, "pullbackBars": 5},
    },
    "covid_crash_mar_2020": {
        "from": "2020-03-02", "to": "2020-03-21",
        "note": "Extreme volatility: wide spreads, ATR filter, gaps, fast stops.",
        "params": {"slAtrMult": 2.0, "atrMaxBps": 20.0, "maxSpread": 0.8},
    },
}


def _ts(s: str) -> int:
    return int(datetime.fromisoformat(s).replace(tzinfo=UTC).timestamp())


def _num(x: float):
    return None if isinstance(x, float) and math.isnan(x) else x


def build_case(df, spec: dict) -> dict[str, str]:
    a, b = _ts(spec["from"]), _ts(spec["to"])
    part = df[(df["t"] >= a) & (df["t"] < b)]
    p = Params().replace(**{**FIXTURE_BASE, **spec["params"]})
    news = proxy_calendar(date.fromisoformat(spec["from"]), date.fromisoformat(spec["to"]))
    r = Replay(p, news=news, record_decisions=True, max_bars=10**9)
    bars = [Bar(int(t), float(o), float(h), float(lo), float(c), float(s))
            for t, o, h, lo, c, s in zip(part["t"], part["o"], part["h"], part["l"], part["c"], part["spread"],
                                         strict=True)]
    r.run(bars)

    m1_csv = "t,o,h,l,c,spread\n" + "".join(
        f"{x.t},{x.o!r},{x.h!r},{x.l!r},{x.c!r},{x.spread!r}\n" for x in bars
    )
    expected = {
        "note": spec["note"],
        "counts": {"m1": len(bars), "m5": len(r.m5), "m15": len(r.m15), "signals": len(r.signals)},
        "reasons": dict(sorted(r.reasons.items())),
        "decisions": r.decisions,
        "m5": [{"t": x.t, "emaFast": _num(x.ema_fast), "emaSlow": _num(x.ema_slow), "atr": _num(x.atr),
                "k": _num(x.k), "d": _num(x.d)} for x in r.m5],
        "m15": [{"t": x.t, "emaFast": _num(x.ema_fast), "emaSlow": _num(x.ema_slow), "emaTrend": _num(x.ema_trend)}
                for x in r.m15],
        "signals": [s.to_json() | {"state": s.state} for s in r.signals],
    }
    return {
        "m1.csv": m1_csv,
        "params.json": json.dumps(p.to_json(), indent=2) + "\n",
        "news.json": json.dumps(news) + "\n",
        "expected.json": json.dumps(expected, indent=1) + "\n",
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    import pandas as pd

    df = pd.read_parquet(M1_PATH)
    changed = []
    for name, spec in CASES.items():
        files = build_case(df, spec)
        exp = json.loads(files["expected.json"])
        print(f"{name}: {exp['counts']}")
        for fname, content in files.items():
            path = OUT / name / fname
            if args.check:
                if not path.exists() or path.read_text() != content:
                    changed.append(str(path.relative_to(ROOT)))
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
    if args.check and changed:
        print("golden fixtures are stale:\n  " + "\n  ".join(changed), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
