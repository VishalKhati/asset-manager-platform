# ruff: noqa: E501  (report tables are clearer on one line)
"""Hypothesis v4, `macro_trend`: daily gold position from trend + real-yield + dollar momentum.

Implements research/HYPOTHESIS_V4.md exactly (committed 2a57f34 before any analysis).
"""

from __future__ import annotations

import json
import math
import urllib.request
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path

import numpy as np
import pandas as pd

GRID = [{"N": n, "k": k, "mode": m} for n in (100, 200) for k in (2, 3) for m in ("long_flat", "long_short")]
TESTS = [(y, y + 1) for y in range(2012, 2026, 2)]  # (first year, last year) inclusive
TRAIN_YEARS = 5
HOLDOUT = ("2026-01-01", "2026-10-15")
FINAL_TRAIN = (2021, 2025)
COST_PER_UNIT = 0.0003  # 0.03% per unit of position change
FIN_SPREAD = 2.5  # % added to / subtracted from fed funds
LOOKBACK = 63

FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={}"
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/{}?period1=1104537600&period2={}&interval=1d&events=div%2Csplit"


# --------------------------------------------------------------------------- data
def download(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for sid in ("DFII10", "DTWEXBGS", "DFF"):
        urllib.request.urlretrieve(FRED.format(sid), out / f"{sid}.csv")
    end = int(datetime.now(UTC).timestamp())
    for sym, name in (("GLD", "GLD"), ("GC%3DF", "GC")):
        req = urllib.request.Request(YAHOO.format(sym, end), headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            (out / f"{name}.json").write_bytes(r.read())


def _yahoo(path: Path) -> pd.Series:
    d = json.loads(path.read_text())["chart"]["result"][0]
    ts = pd.to_datetime(d["timestamp"], unit="s", utc=True).tz_convert("America/New_York").normalize().tz_localize(None)
    adj = d["indicators"].get("adjclose", [{}])[0].get("adjclose") or d["indicators"]["quote"][0]["close"]
    s = pd.Series(adj, index=ts, dtype="float64").dropna()
    return s[~s.index.duplicated(keep="last")]


def _fred(path: Path) -> pd.Series:
    df = pd.read_csv(path)
    df.columns = ["date", "value"]
    s = pd.to_numeric(df["value"], errors="coerce")
    s.index = pd.to_datetime(df["date"])
    return s.dropna()


def lagged_asof(series: pd.Series, dates: pd.DatetimeIndex) -> pd.Series:
    """Value of `series` last published strictly before each date (one-day publication lag)."""
    src = series.sort_index()
    pos = src.index.searchsorted(dates - pd.Timedelta(days=1), side="right") - 1
    vals = np.where(pos >= 0, src.to_numpy()[np.clip(pos, 0, None)], np.nan)
    return pd.Series(vals, index=dates)


def load_frame(data_dir: Path) -> pd.DataFrame:
    gld = _yahoo(data_dir / "GLD.json")
    idx = gld.index
    f = pd.DataFrame({"close": gld})
    f["ry"] = lagged_asof(_fred(data_dir / "DFII10.csv"), idx)
    f["usd"] = lagged_asof(_fred(data_dir / "DTWEXBGS.csv"), idx)
    f["dff"] = lagged_asof(_fred(data_dir / "DFF.csv"), idx)
    return f


# ---------------------------------------------------------------------- strategy
@dataclass(frozen=True)
class Cfg:
    N: int
    k: int
    mode: str


def positions(f: pd.DataFrame, cfg: Cfg) -> pd.Series:
    """Position decided at each close (applied to the next day's return). NaN while warming up."""
    sma = f["close"].rolling(cfg.N, min_periods=cfg.N).mean()
    trend = (f["close"] > sma).astype(float)
    ry = (f["ry"] < f["ry"].shift(LOOKBACK)).astype(float)
    usd = (f["usd"] < f["usd"].shift(LOOKBACK)).astype(float)
    bull = trend + ry + usd
    pos = np.where(bull >= cfg.k, 1.0, 0.0)
    if cfg.mode == "long_short":
        pos = np.where((3 - bull) >= cfg.k, -1.0, pos)
    ready = sma.notna() & f["ry"].shift(LOOKBACK).notna() & f["usd"].shift(LOOKBACK).notna() & f["dff"].notna()
    return pd.Series(np.where(ready, pos, np.nan), index=f.index)


def daily_returns(f: pd.DataFrame, pos: pd.Series) -> pd.DataFrame:
    """Net daily returns for day t+1 from the position held after the close of day t."""
    ret = f["close"].pct_change().shift(-1)  # return from close t to close t+1
    days = pd.Series(f.index, index=f.index).diff().shift(-1).dt.days
    held = pos.fillna(0.0)
    change = (held - held.shift(1).fillna(0.0)).abs()
    long_fin = (f["dff"] + FIN_SPREAD) / 100 / 360 * days
    short_fin = (f["dff"] - FIN_SPREAD) / 100 / 360 * days
    fin = np.where(held > 0, -long_fin, np.where(held < 0, short_fin, 0.0))
    strat = held * ret - change * COST_PER_UNIT + fin
    bh_fin = ret - long_fin
    out = pd.DataFrame({"strat": strat, "bh_fin": bh_fin, "bh": ret, "pos": held, "change": change})
    out = out[pos.notna()].dropna(subset=["strat", "bh"])
    # Index = decision day t; the return is realised from close t to close t+1.
    return out


def metrics(r: pd.Series, pos: pd.Series | None = None, change: pd.Series | None = None) -> dict:
    if r.empty:
        return {"days": 0}
    eq = (1 + r).cumprod()
    years = len(r) / 252
    vol = r.std() * math.sqrt(252)
    sharpe = (r.mean() * 252) / vol if vol > 0 else 0.0
    dd = float((eq / eq.cummax() - 1).min())
    out = {"days": int(len(r)), "totalReturn": float(eq.iloc[-1] - 1), "cagr": float(eq.iloc[-1] ** (1 / years) - 1) if years > 0 else 0.0,
           "volatility": float(vol), "sharpe": float(sharpe), "maxDrawdown": dd}
    if pos is not None:
        out["timeInMarket"] = float((pos != 0).mean())
        out["timeShort"] = float((pos < 0).mean())
    if change is not None:
        out["positionChanges"] = int((change > 0).sum())
    return out


def _slice_years(df: pd.DataFrame, y0: int, y1: int) -> pd.DataFrame:
    return df[(df.index.year >= y0) & (df.index.year <= y1)]


def walk_forward(data_dir: Path) -> dict:
    f = load_frame(data_dir)
    runs = [daily_returns(f, positions(f, Cfg(**g))) for g in GRID]
    windows, oos_parts = [], []
    for y0, y1 in TESTS:
        tr0, tr1 = y0 - TRAIN_YEARS, y0 - 1
        train_sharpes = [metrics(_slice_years(r, tr0, tr1)["strat"]).get("sharpe", -9) for r in runs]
        best = int(np.argmax(train_sharpes))
        test = _slice_years(runs[best], y0, y1)
        oos_parts.append(test)
        windows.append({"train": [tr0, tr1], "testYears": [y0, y1], "chosen": GRID[best], "trainSharpe": train_sharpes[best],
                        "test": metrics(test["strat"], test["pos"], test["change"]), "testBuyHoldFin": metrics(test["bh_fin"])})
    oos = pd.concat(oos_parts)
    final = int(np.argmax([metrics(_slice_years(r, *FINAL_TRAIN)["strat"]).get("sharpe", -9) for r in runs]))
    h = runs[final]
    hold = h[(h.index >= HOLDOUT[0]) & (h.index <= HOLDOUT[1])]
    m_oos = metrics(oos["strat"], oos["pos"], oos["change"])
    m_bhf = metrics(oos["bh_fin"])
    m_bh = metrics(oos["bh"])
    m_hold = metrics(hold["strat"], hold["pos"], hold["change"])
    checks = {
        "sharpeAtLeast0_5": m_oos["sharpe"] >= 0.5,
        "beatsBuyHoldSharpe": m_oos["sharpe"] > m_bhf["sharpe"],
        "drawdownNoWorse": m_oos["maxDrawdown"] >= m_bhf["maxDrawdown"],
        "positionChanges": m_oos["positionChanges"] >= 20,
        "holdoutPositive": m_hold.get("totalReturn", -1) > 0,
    }
    eq = pd.DataFrame({"strategy": (1 + oos["strat"]).cumprod(), "buyHoldFinanced": (1 + oos["bh_fin"]).cumprod()})
    return {
        "strategy": {"id": "macro_trend", "version": 1},
        "generatedAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "data": {"from": str(f.index[0].date()), "to": str(f.index[-1].date()), "days": int(len(f))},
        "design": {"grid": GRID, "tests": TESTS, "trainYears": TRAIN_YEARS, "preRegistration": "research/HYPOTHESIS_V4.md"},
        "windows": windows,
        "oos": m_oos, "oosBuyHoldFinanced": m_bhf, "oosBuyHold": m_bh,
        "finalParams": GRID[final],
        "holdout": m_hold, "holdoutBuyHoldFinanced": metrics(hold["bh_fin"]),
        "gate": {"checks": checks, "pass": all(checks.values())},
        "gridFullPeriod": [{"params": GRID[i], "stats": metrics(r["strat"], r["pos"], r["change"])} for i, r in enumerate(runs)],
        "equity": [[str(d.date()), round(a, 5), round(b, 5)] for d, a, b in eq.itertuples()][::5],
    }


def _pct(x):
    return "n/a" if x is None else f"{x * 100:.1f}%"


def render(res: dict) -> str:
    o, b, bb, h = res["oos"], res["oosBuyHoldFinanced"], res["oosBuyHold"], res["holdout"]
    c = res["gate"]["checks"]
    yn = lambda v: "yes" if v else "no"  # noqa: E731
    lines = [
        "# Walk-forward report: macro_trend (hypothesis v4)", "",
        f"Generated {res['generatedAt']}. GLD daily {res['data']['from']} to {res['data']['to']} with FRED real yields (DFII10), dollar (DTWEXBGS) and fed funds (DFF). "
        "Pre-registered in `research/HYPOTHESIS_V4.md` (commit 2a57f34) before any analysis.", "",
        f"## Gate 1 verdict: **{'PASS' if res['gate']['pass'] else 'FAIL'}**", "",
        "| Check | Strategy (OOS 2012–2025) | Buy-and-hold, financed | Pass |", "|---|---|---|---|",
        f"| Sharpe ≥ 0.5 | {o['sharpe']:.2f} | | {yn(c['sharpeAtLeast0_5'])} |",
        f"| Sharpe above buy-and-hold | {o['sharpe']:.2f} | {b['sharpe']:.2f} | {yn(c['beatsBuyHoldSharpe'])} |",
        f"| Max drawdown no deeper | {_pct(o['maxDrawdown'])} | {_pct(b['maxDrawdown'])} | {yn(c['drawdownNoWorse'])} |",
        f"| Position changes ≥ 20 | {o['positionChanges']} | | {yn(c['positionChanges'])} |",
        f"| 2026 holdout return > 0 | {_pct(h.get('totalReturn'))} | {_pct(res['holdoutBuyHoldFinanced'].get('totalReturn'))} | {yn(c['holdoutPositive'])} |",
        "", "## Out-of-sample summary (2012–2025)", "",
        "| | CAGR | Volatility | Sharpe | Max drawdown | Total return |", "|---|---|---|---|---|---|",
        f"| Strategy | {_pct(o['cagr'])} | {_pct(o['volatility'])} | {o['sharpe']:.2f} | {_pct(o['maxDrawdown'])} | {_pct(o['totalReturn'])} |",
        f"| Buy-and-hold, CFD-financed | {_pct(b['cagr'])} | {_pct(b['volatility'])} | {b['sharpe']:.2f} | {_pct(b['maxDrawdown'])} | {_pct(b['totalReturn'])} |",
        f"| Buy-and-hold, no financing (ETF) | {_pct(bb['cagr'])} | {_pct(bb['volatility'])} | {bb['sharpe']:.2f} | {_pct(bb['maxDrawdown'])} | {_pct(bb['totalReturn'])} |",
        "", f"Time in market {_pct(o['timeInMarket'])}, short {_pct(o['timeShort'])}. Final parameters (chosen on 2021–2025): {res['finalParams']}.", "",
        "## Walk-forward windows", "", "| Test years | Chosen | Train Sharpe | Test Sharpe | Test CAGR | Test max DD | Buy-and-hold Sharpe (financed) |", "|---|---|---|---|---|---|---|",
    ]
    for w in res["windows"]:
        t, ch = w["test"], w["chosen"]
        lines.append(f"| {w['testYears'][0]}–{w['testYears'][1]} | N {ch['N']}, k {ch['k']}, {ch['mode']} | {w['trainSharpe']:.2f} | "
                     f"{t['sharpe']:.2f} | {_pct(t['cagr'])} | {_pct(t['maxDrawdown'])} | {w['testBuyHoldFin']['sharpe']:.2f} |")
    lines += ["", "## Full grid, whole period (in-sample, context only)", "", "| Params | Sharpe | CAGR | Max DD | In market | Changes |", "|---|---|---|---|---|---|"]
    for row in res["gridFullPeriod"]:
        p, s = row["params"], row["stats"]
        lines.append(f"| N {p['N']}, k {p['k']}, {p['mode']} | {s['sharpe']:.2f} | {_pct(s['cagr'])} | {_pct(s['maxDrawdown'])} | {_pct(s['timeInMarket'])} | {s['positionChanges']} |")
    lines += ["", "## Caveats", "",
              "- GLD is used as the gold price; MT5 spot gold differs slightly (GLD charges 0.40% a year).",
              "- Financing is a generic MT5 swap model (fed funds ± 2.5%); check your broker's actual swap rates.",
              "- Not financial advice.", ""]
    return "\n".join(lines)


def main_run(data_dir: Path, reports: Path, refresh: bool) -> dict:
    if refresh or not (data_dir / "GLD.json").exists():
        download(data_dir)
    res = walk_forward(data_dir)
    reports.mkdir(exist_ok=True)
    (reports / "walkforward_macro.json").write_text(json.dumps(res, indent=2, default=float) + "\n")
    (reports / "WALKFORWARD_MACRO.md").write_text(render(res))
    return res


def _today() -> date:
    return datetime.now(UTC).date()
