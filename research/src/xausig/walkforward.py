"""Walk-forward validation with a locked holdout.

The parameter grid is pre-registered here, before any results were seen. Changing it
after looking at results is tuning on test data: log any change in reports/GRAVEYARD.md.
"""

from __future__ import annotations

import math
import multiprocessing as mp
from dataclasses import dataclass
from datetime import UTC, date, datetime

import numpy as np
import pandas as pd

from . import STRATEGY_VERSION
from .news import proxy_calendar
from .params import Params
from .replay import Replay, bars_from_arrays
from .stats import bootstrap_expectancy_ci, monte_carlo_drawdown, summarize

# Pre-registered on 2026-09-26. Do not edit without a GRAVEYARD.md entry.
GRID: list[dict] = [
    {"slAtrMult": sl, "pullbackBars": pb, "tp1Fraction": f}
    for sl in (1.5, 2.0)
    for pb in (3, 5)
    for f in (0.5, 0.0)
]
TRAIN_MONTHS = 24
TEST_MONTHS = 6
FIRST_TEST = date(2021, 1, 1)
HOLDOUT_START = date(2026, 1, 1)
MIN_TRAIN_TRADES = 60

GATE = {"minTrades": 200, "minProfitFactor": 1.3, "minExpectancyR": 0.2, "maxDrawdownR": 15.0,
        "maxMonteCarloP95DrawdownR": 20.0}

_DATA: dict = {}


def _ts(d: date) -> int:
    return int(datetime(d.year, d.month, d.day, tzinfo=UTC).timestamp())


def _add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    return date(d.year + m // 12, m % 12 + 1, 1)


@dataclass
class RunResult:
    label: str
    params: dict
    trades: list[dict]  # filled trades only
    expired: list[int]  # decision times of expired signals
    reasons: dict


def run_one(label: str, params_json: dict, use_news: bool = True, orb: dict | None = None) -> RunResult:
    df = _DATA["df"]
    p = Params.from_json(params_json)
    news = _DATA["news"] if use_news else []
    if orb is not None:
        from .orb import OrbConfig, OrbReplay

        r = OrbReplay(p, OrbConfig(**orb), news=news)
    else:
        r = Replay(p, news=news)
    r.run(bars_from_arrays(df["t"], df["o"], df["h"], df["l"], df["c"], df["spread"]))
    trades, expired = [], []
    for s in r.signals:
        if s.outcome == "expired":
            expired.append(s.t)
        elif s.outcome:
            trades.append(s.to_json())
    return RunResult(label, orb if orb is not None else params_json, trades, expired, dict(r.reasons))


def _run_star(args):
    return run_one(*args)


def _init_worker(df_dict, news):
    _DATA["df"] = df_dict
    _DATA["news"] = news


def window_stats(run: RunResult, start: int, end: int) -> dict:
    rs = [t["rNet"] for t in run.trades if start <= t["t"] < end]
    outcomes = [t["outcome"] for t in run.trades if start <= t["t"] < end]
    expired = sum(1 for t in run.expired if start <= t < end)
    return summarize(rs, outcomes, expired)


def _json_safe(x):
    if isinstance(x, float) and not math.isfinite(x):
        return None if math.isnan(x) else ("inf" if x > 0 else "-inf")
    if isinstance(x, dict):
        return {k: _json_safe(v) for k, v in x.items()}
    if isinstance(x, list | tuple):
        return [_json_safe(v) for v in x]
    return x


# Pre-registered in research/HYPOTHESIS_V2.md (committed before any v2 run).
ORB_GRID: list[dict] = [
    {"stop": stop, "tp2R": tp2, "trendFilter": trend}
    for stop in ("opposite", "mid")
    for tp2 in (2.0, 3.0)
    for trend in (True, False)
]


def walk_forward(df: pd.DataFrame, base: Params | None = None, processes: int = 8, strategy: str = "ema_stoch_atr") -> dict:
    base = base or Params()
    orb = strategy == "london_orb"
    grid = ORB_GRID if orb else GRID
    start_day = datetime.fromtimestamp(int(df["t"].iloc[0]), UTC).date()
    end_day = datetime.fromtimestamp(int(df["t"].iloc[-1]), UTC).date()
    news = proxy_calendar(start_day, end_day)
    arrays = {k: df[k].to_numpy() for k in ("t", "o", "h", "l", "c", "spread")}

    jobs = []
    default_json = base.to_json()
    if orb:
        for i, g in enumerate(grid):
            jobs.append((f"grid{i}", default_json, True, g))
        jobs.append(("default_no_news", default_json, False, grid[0]))
        jobs.append(("default_no_costs", base.replace(commission=0.0, slippage=0.0).to_json(), True, grid[0]))
    else:
        for i, g in enumerate(grid):
            jobs.append((f"grid{i}", base.replace(**g).to_json(), True, None))
        jobs.append(("default_no_news", default_json, False, None))
        jobs.append(("default_no_costs", base.replace(commission=0.0, slippage=0.0).to_json(), True, None))

    with mp.get_context("fork").Pool(processes, initializer=_init_worker, initargs=(arrays, news)) as pool:
        results: list[RunResult] = pool.map(_run_star, jobs)
    by_label = {r.label: r for r in results}
    grid_runs = [by_label[f"grid{i}"] for i in range(len(grid))]

    # Walk-forward windows.
    windows = []
    oos_trades: list[dict] = []
    test_start = FIRST_TEST
    while test_start < HOLDOUT_START:
        test_end = min(_add_months(test_start, TEST_MONTHS), HOLDOUT_START)
        train_start = _add_months(test_start, -TRAIN_MONTHS)
        a, b = _ts(train_start), _ts(test_start)
        scored = []
        for i, run in enumerate(grid_runs):
            st = window_stats(run, a, b)
            eligible = st["trades"] >= MIN_TRAIN_TRADES
            scored.append((eligible, st["expectancyR"], _pf(st), i, st))
        scored.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
        best = scored[0][3]
        c, d = _ts(test_start), _ts(test_end)
        test = window_stats(grid_runs[best], c, d)
        oos_trades += [t for t in grid_runs[best].trades if c <= t["t"] < d]
        windows.append({
            "train": [train_start.isoformat(), test_start.isoformat()],
            "test": [test_start.isoformat(), test_end.isoformat()],
            "chosen": grid[best],
            "trainStats": scored[0][4],
            "testStats": test,
        })
        test_start = test_end

    oos_r = [t["rNet"] for t in oos_trades]
    oos = summarize(oos_r, [t["outcome"] for t in oos_trades])
    oos["expectancyCI95"] = list(bootstrap_expectancy_ci(oos_r))
    oos["monteCarloDrawdownR"] = monte_carlo_drawdown(oos_r)

    # Holdout: choose on the last 24 months before it, evaluate once.
    h_train = (_ts(_add_months(HOLDOUT_START, -TRAIN_MONTHS)), _ts(HOLDOUT_START))
    scored = sorted(
        ((window_stats(r, *h_train)["trades"] >= MIN_TRAIN_TRADES, window_stats(r, *h_train)["expectancyR"], i)
         for i, r in enumerate(grid_runs)),
        reverse=True,
    )
    h_best = scored[0][2]
    holdout = window_stats(grid_runs[h_best], _ts(HOLDOUT_START), _ts(end_day) + 86_400)

    gate = _gate(oos, holdout)
    full_default = window_stats(grid_runs[0], _ts(start_day), _ts(end_day) + 86_400)
    by_year = {}
    for y in range(start_day.year, end_day.year + 1):
        by_year[str(y)] = window_stats(grid_runs[0], _ts(date(y, 1, 1)), _ts(date(y + 1, 1, 1)))

    return _json_safe({
        "strategy": {"id": strategy, "version": 1 if orb else STRATEGY_VERSION},
        "generatedAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "data": {"from": start_day.isoformat(), "to": end_day.isoformat(), "m1Bars": int(len(df))},
        "design": {"grid": grid, "trainMonths": TRAIN_MONTHS, "testMonths": TEST_MONTHS,
                   "firstTest": FIRST_TEST.isoformat(), "holdoutStart": HOLDOUT_START.isoformat(),
                   "minTrainTrades": MIN_TRAIN_TRADES, "newsCalendar": "proxy (see xausig/news.py)",
                   "preRegistration": "research/HYPOTHESIS_V2.md" if orb else "docs/STRATEGY_SPEC.md"},
        "baseParams": default_json,
        "windows": windows,
        "oos": oos,
        "oosEquityR": _equity(oos_trades),
        "holdout": {"chosen": grid[h_best], "stats": holdout},
        "gate": gate,
        "defaultFullPeriod": full_default,
        "defaultByYear": by_year,
        "defaultDecisionReasons": grid_runs[0].reasons,
        "variants": {
            "defaultNoNews": window_stats(by_label["default_no_news"], _ts(start_day), _ts(end_day) + 86_400),
            "defaultNoCommissionOrSlippage": window_stats(
                by_label["default_no_costs"], _ts(start_day), _ts(end_day) + 86_400),
        },
        "gridFullPeriod": [
            {"params": grid[i], "stats": window_stats(r, _ts(start_day), _ts(end_day) + 86_400)}
            for i, r in enumerate(grid_runs)
        ],
    })


def _pf(st: dict) -> float:
    pf = st["profitFactor"]
    return pf if math.isfinite(pf) else 1e9


def _equity(trades: list[dict]) -> list[list[float]]:
    total = 0.0
    out = []
    for t in sorted(trades, key=lambda x: x["t"]):
        total += t["rNet"]
        out.append([t["t"], round(total, 6)])
    return out


def _gate(oos: dict, holdout: dict) -> dict:
    checks = {
        "trades": oos["trades"] >= GATE["minTrades"],
        "profitFactor": _pf(oos) > GATE["minProfitFactor"],
        "expectancy": oos["expectancyR"] > GATE["minExpectancyR"],
        "maxDrawdown": oos["maxDrawdownR"] <= GATE["maxDrawdownR"],
        "monteCarloDrawdown": oos["monteCarloDrawdownR"]["p95"] <= GATE["maxMonteCarloP95DrawdownR"],
        "holdoutPositive": holdout["trades"] > 0 and holdout["expectancyR"] > 0,
    }
    return {"thresholds": GATE, "checks": checks, "pass": all(checks.values())}


def backtest(df: pd.DataFrame, p: Params, use_news: bool = True) -> dict:
    """Single run over the whole frame, for quick experiments."""
    start_day = datetime.fromtimestamp(int(df["t"].iloc[0]), UTC).date()
    end_day = datetime.fromtimestamp(int(df["t"].iloc[-1]), UTC).date()
    _init_worker({k: np.asarray(df[k]) for k in ("t", "o", "h", "l", "c", "spread")},
                 proxy_calendar(start_day, end_day))
    run = run_one("single", p.to_json(), use_news)
    st = summarize([t["rNet"] for t in run.trades], [t["outcome"] for t in run.trades], len(run.expired))
    return _json_safe({"stats": st, "reasons": run.reasons, "trades": run.trades})
