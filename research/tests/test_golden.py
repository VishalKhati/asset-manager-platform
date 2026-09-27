"""Golden parity (Python side): replay the committed fixture inputs and require the committed output.

The TypeScript side runs the same fixtures in lib/strategy/test/golden.test.ts. Together they
guarantee the research simulator and the live engine make identical decisions. Raw Dukascopy
data is not needed: fixtures carry their own M1 bars.
"""

import csv
import json
import math
from pathlib import Path

import pytest

from xausig.bars import Bar
from xausig.params import Params
from xausig.replay import Replay

GOLDEN = Path(__file__).resolve().parents[2] / "fixtures" / "golden"
CASES = sorted(p.name for p in GOLDEN.iterdir() if (p / "expected.json").exists()) if GOLDEN.exists() else []


def _close(a, b) -> bool:
    if a is None or b is None:
        return a is None and (b is None or (isinstance(b, float) and math.isnan(b)))
    return abs(a - b) <= 1e-9 * max(1.0, abs(a))


def test_fixtures_exist():
    assert CASES, "no golden fixtures found"


@pytest.mark.parametrize("case", CASES)
def test_replay_matches_fixture(case):
    d = GOLDEN / case
    params = Params.from_json(json.loads((d / "params.json").read_text()))
    news = json.loads((d / "news.json").read_text())
    expected = json.loads((d / "expected.json").read_text())
    with open(d / "m1.csv", newline="") as f:
        bars = [Bar(int(r["t"]), float(r["o"]), float(r["h"]), float(r["l"]), float(r["c"]), float(r["spread"]))
                for r in csv.DictReader(f)]
    r = Replay(params, news=news, record_decisions=True, max_bars=10**9).run(bars)

    assert r.decisions == expected["decisions"]
    assert dict(r.reasons) == expected["reasons"]
    for got, exp in zip(r.m5, expected["m5"], strict=True):
        assert got.t == exp["t"]
        for key, attr in (("emaFast", "ema_fast"), ("emaSlow", "ema_slow"), ("atr", "atr"), ("k", "k"), ("d", "d")):
            value = getattr(got, attr)
            assert _close(exp[key], None if math.isnan(value) else value), (case, got.t, key)
    signals = [s.to_json() | {"state": s.state} for s in r.signals]
    assert len(signals) == len(expected["signals"])
    for got, exp in zip(signals, expected["signals"], strict=True):
        for key, value in exp.items():
            if isinstance(value, float):
                assert _close(got[key], value), (case, got["id"], key)
            elif key != "events":
                assert got[key] == value, (case, got["id"], key)
        assert [(e["type"], e["t"]) for e in got["events"]] == [(e["type"], e["t"]) for e in exp["events"]]
