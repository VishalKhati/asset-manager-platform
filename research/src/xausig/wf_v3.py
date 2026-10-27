# ruff: noqa: E501  (report tables are clearer on one line)
"""Walk-forward for hypothesis v3 (`delta_va_fade`), exactly as pre-registered in
research/HYPOTHESIS_V3.md: train 4 months / test 2 months on Binance XAUUSDT perp,
final params from 2025-12-01..2026-07-31, holdouts run once (primary tail, Bybit XAUTUSDT).
"""

from __future__ import annotations

import math
import multiprocessing as mp
from datetime import UTC, date, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from .bars import Bar
from .delta_va import STRATEGY_ID, DeltaVaReplay, DvaConfig, FlowBar
from .news import proxy_calendar
from .orderflow import value_areas
from .params import Params
from .stats import bootstrap_expectancy_ci, monte_carlo_drawdown, summarize
from .walkforward import _equity, _json_safe

GRID = [{"windowMin": w, "stopBuffer": b} for w in (30, 60) for b in (0.10, 0.25)]
TESTS = [("2026-04-01", "2026-06-01"), ("2026-06-01", "2026-08-01"), ("2026-08-01", "2026-10-01")]
TRAIN_MONTHS = 4
FINAL_TRAIN = ("2025-12-01", "2026-08-01")
PRIMARY_TAIL = ("2026-10-01", "2026-10-16")
SECONDARY = ("2025-04-03", "2025-12-01")
MIN_TRAIN_TRADES = 40
GATE = {"minTrades": 100, "minProfitFactor": 1.3, "minExpectancyR": 0.2, "maxDrawdownR": 15.0,
        "secondaryMinTrades": 30, "secondaryMinExpectancyR": 0.0}

_DATA: dict = {}


def _ts(s: str) -> int:
    return int(datetime.fromisoformat(s).replace(tzinfo=UTC).timestamp())


def _months_back(s: str, n: int) -> str:
    d = date.fromisoformat(s)
    m = d.month - 1 - n
    return date(d.year + m // 12, m % 12 + 1, 1).isoformat()


def load(dir_: Path) -> tuple[pd.DataFrame, dict]:
    bars = pd.read_parquet(dir_ / "m1.parquet")
    va = value_areas(pd.read_parquet(dir_ / "profile.parquet"))
    return bars, va


def flow_bars(df: pd.DataFrame):
    t, o, h, lo, c, s = (df[k].to_numpy() for k in ("t", "o", "h", "l", "c", "spread"))
    buy, sell, sid = df["buy"].to_numpy(), df["sell"].to_numpy(), df["session"].to_numpy()
    for i in range(len(t)):
        yield FlowBar(Bar(int(t[i]), float(o[i]), float(h[i]), float(lo[i]), float(c[i]), float(s[i])),
                      float(buy[i]), float(sell[i]), int(sid[i]))


def _run(args) -> dict:
    label, cfg_json = args
    df, va, news = _DATA["df"], _DATA["va"], _DATA["news"]
    r = DeltaVaReplay(Params(), DvaConfig(**cfg_json), va, news=news).run(flow_bars(df))
    trades = [s.to_json() for s in r.signals if s.outcome and s.outcome != "expired"]
    expired = [s.t for s in r.signals if s.outcome == "expired"]
    return {"label": label, "cfg": cfg_json, "trades": trades, "expired": expired, "reasons": dict(r.reasons)}


def _init(df, va, news):
    _DATA.update(df=df, va=va, news=news)


def _window(run: dict, a: str, b: str) -> dict:
    lo, hi = _ts(a), _ts(b)
    rs = [t for t in run["trades"] if lo <= t["t"] < hi]
    return summarize([t["rNet"] for t in rs], [t["outcome"] for t in rs], sum(1 for x in run["expired"] if lo <= x < hi))


def _choose(runs: list[dict], a: str, b: str) -> int:
    scored = []
    for i, r in enumerate(runs):
        st = _window(r, a, b)
        scored.append((st["trades"] >= MIN_TRAIN_TRADES, st["expectancyR"], i))
    return max(scored)[2]


def lead_lag(df: pd.DataFrame, spot: pd.DataFrame | None) -> dict:
    x = df.set_index(pd.to_datetime(df["t"], unit="s", utc=True))
    m5 = pd.DataFrame({"c": x["c"].resample("5min").last(), "delta": (x["buy"] - x["sell"]).resample("5min").sum()}).dropna()
    out = {}
    for h in (1, 3):  # next 5 and 15 minutes
        fut = np.log(m5["c"].shift(-h) / m5["c"])
        out[f"perp_delta5_vs_next{5 * h}m"] = float(m5["delta"].corr(fut))
    if spot is not None:
        s = spot.set_index(pd.to_datetime(spot["t"], unit="s", utc=True))["c"].resample("5min").last()
        j = pd.concat([m5["delta"], s.rename("spot")], axis=1, join="inner").dropna()
        for h in (1, 3):
            fut = np.log(j["spot"].shift(-h) / j["spot"])
            out[f"perp_delta5_vs_spot_next{5 * h}m"] = float(j["delta"].corr(fut))
        out["spotOverlapBars5m"] = int(len(j))
    return out


def run_all(primary_dir: Path, secondary_dir: Path | None, spot_path: Path | None, processes: int = 4) -> dict:
    df, va = load(primary_dir)
    start = datetime.fromtimestamp(int(df["t"].iloc[0]), UTC).date()
    end = datetime.fromtimestamp(int(df["t"].iloc[-1]), UTC).date()
    news = proxy_calendar(date(2025, 3, 1), end)
    jobs = [(f"grid{i}", g) for i, g in enumerate(GRID)]
    with mp.get_context("fork").Pool(min(processes, len(jobs)), initializer=_init, initargs=(df, va, news)) as pool:
        runs = pool.map(_run, jobs)

    windows, oos = [], []
    for a, b in TESTS:
        tr = (_months_back(a, TRAIN_MONTHS), a)
        best = _choose(runs, *tr)
        test = _window(runs[best], a, b)
        oos += [t for t in runs[best]["trades"] if _ts(a) <= t["t"] < _ts(b)]
        windows.append({"train": list(tr), "test": [a, b], "chosen": GRID[best], "trainStats": _window(runs[best], *tr), "testStats": test})
    oos_r = [t["rNet"] for t in oos]
    oos_stats = summarize(oos_r, [t["outcome"] for t in oos])
    oos_stats["expectancyCI95"] = list(bootstrap_expectancy_ci(oos_r))
    oos_stats["monteCarloDrawdownR"] = monte_carlo_drawdown(oos_r)

    final = _choose(runs, *FINAL_TRAIN)
    tail = _window(runs[final], *PRIMARY_TAIL)

    secondary = None
    if secondary_dir is not None and (secondary_dir / "m1.parquet").exists():
        sdf, sva = load(secondary_dir)
        _init(sdf, sva, news)
        srun = _run(("secondary", GRID[final]))
        secondary = _window(srun, *SECONDARY)

    pf = oos_stats["profitFactor"]
    checks = {
        "trades": oos_stats["trades"] >= GATE["minTrades"],
        "profitFactor": (pf if math.isfinite(pf) else 1e9) > GATE["minProfitFactor"],
        "expectancy": oos_stats["expectancyR"] > GATE["minExpectancyR"],
        "maxDrawdown": oos_stats["maxDrawdownR"] <= GATE["maxDrawdownR"],
        "secondaryHoldout": bool(secondary and secondary["trades"] >= GATE["secondaryMinTrades"]
                                 and secondary["expectancyR"] > GATE["secondaryMinExpectancyR"]),
    }
    spot = pd.read_parquet(spot_path, columns=["t", "c"]) if spot_path and spot_path.exists() else None
    return _json_safe({
        "strategy": {"id": STRATEGY_ID, "version": 1},
        "generatedAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "data": {"primary": f"Binance XAUUSDT perp {start}..{end}", "m1Bars": int(len(df)),
                 "secondary": "Bybit XAUTUSDT perp" if secondary is not None else None},
        "design": {"grid": GRID, "tests": TESTS, "trainMonths": TRAIN_MONTHS, "finalTrain": FINAL_TRAIN,
                   "preRegistration": "research/HYPOTHESIS_V3.md"},
        "windows": windows,
        "oos": oos_stats,
        "oosEquityR": _equity(oos),
        "finalParams": GRID[final],
        "primaryTail": tail,
        "secondaryHoldout": secondary,
        "gate": {"thresholds": GATE, "checks": checks, "pass": all(checks.values())},
        "gridFullPeriod": [{"params": GRID[i], "stats": _window(r, start.isoformat(), (end.isoformat()))} for i, r in enumerate(runs)],
        "reasons": runs[final]["reasons"],
        "leadLag": lead_lag(df, spot),
    })


def render(res: dict) -> str:
    g, o = res["gate"], res["oos"]

    def f(x, d=3):
        return "n/a" if x is None else (x if isinstance(x, str) else f"{x:.{d}f}")

    sec = res["secondaryHoldout"]
    lines = [
        f"# Walk-forward report: {res['strategy']['id']} (hypothesis v3)", "",
        f"Generated {res['generatedAt']}. Data: {res['data']['primary']} ({res['data']['m1Bars']:,} M1 bars). "
        "Pre-registered in `research/HYPOTHESIS_V3.md` (commit a42ecde) before any data was downloaded.", "",
        f"## Gate 1 verdict: **{'PASS' if g['pass'] else 'FAIL'}**", "",
        "| Check | Threshold | Result | Pass |", "|---|---|---|---|",
        f"| Out-of-sample trades | ≥ {g['thresholds']['minTrades']} | {o['trades']} | {'yes' if g['checks']['trades'] else 'no'} |",
        f"| Profit factor | > {g['thresholds']['minProfitFactor']} | {f(o['profitFactor'], 2)} | {'yes' if g['checks']['profitFactor'] else 'no'} |",
        f"| Expectancy (R) | > {g['thresholds']['minExpectancyR']} | {f(o['expectancyR'])} | {'yes' if g['checks']['expectancy'] else 'no'} |",
        f"| Max drawdown (R) | ≤ {g['thresholds']['maxDrawdownR']} | {f(o['maxDrawdownR'], 1)} | {'yes' if g['checks']['maxDrawdown'] else 'no'} |",
        f"| Bybit XAUT holdout | ≥ 30 trades, expectancy > 0 | {sec['trades'] if sec else 'n/a'} trades, {f(sec['expectancyR']) if sec else 'n/a'} R | {'yes' if g['checks']['secondaryHoldout'] else 'no'} |",
        "", f"Out-of-sample expectancy 95% bootstrap interval: {f(o['expectancyCI95'][0])} to {f(o['expectancyCI95'][1])} R. "
        f"Win rate {o['winRate'] * 100:.1f}%. Monte Carlo p95 drawdown {f(o['monteCarloDrawdownR']['p95'], 1)}R.", "",
        f"Primary tail (2026-10-01..15, informational): {res['primaryTail']['trades']} trades, {f(res['primaryTail']['expectancyR'])} R.", "",
        "## Walk-forward windows", "", "| Test window | Chosen | Train trades / exp. | Test trades | Test exp. (R) | Test PF |", "|---|---|---|---|---|---|",
    ]
    for w in res["windows"]:
        c, tr, te = w["chosen"], w["trainStats"], w["testStats"]
        lines.append(f"| {w['test'][0]} → {w['test'][1]} | W {c['windowMin']} min, buffer {c['stopBuffer']} ATR | {tr['trades']} / {f(tr['expectancyR'])} | "
                     f"{te['trades']} | {f(te['expectancyR'])} | {f(te['profitFactor'], 2)} |")
    lines += ["", "## Full grid, whole primary period (in-sample, context only)", "", "| Params | Trades | Win rate | PF | Expectancy (R) | Total R | Max DD (R) |", "|---|---|---|---|---|---|---|"]
    for row in res["gridFullPeriod"]:
        c, s = row["params"], row["stats"]
        lines.append(f"| W {c['windowMin']}, buffer {c['stopBuffer']} | {s['trades']} | {s['winRate'] * 100:.1f}% | {f(s['profitFactor'], 2)} | {f(s['expectancyR'])} | {f(s['totalR'], 1)} | {f(s['maxDrawdownR'], 1)} |")
    lines += ["", "## Does the free order flow predict anything? (diagnostic)", "", "Correlation of 5-minute perp delta with the following return:", ""]
    lines += [f"- `{k}`: {f(v, 4) if isinstance(v, float) else v}" for k, v in res["leadLag"].items()]
    lines += ["", "## Why most M5 bars produce no signal (final params)", "", "| Reason | Count |", "|---|---|"]
    lines += [f"| {k} | {v:,} |" for k, v in sorted(res["reasons"].items(), key=lambda kv: -kv[1])]
    lines += ["", "## Caveats", "",
              "- Only ~10 months of free gold order-flow history exist; results carry wide uncertainty.",
              "- Execution is simulated on the perp's prices with MT5-like costs; live trading would be on MT5 spot gold.",
              "- Session rule clarification (weekends and the 17:00–18:00 New York break excluded from profiles and CVD) was fixed in code before any result was seen.",
              "- Not financial advice.", ""]
    return "\n".join(lines)
