"""Renders the walk-forward result as Markdown with an SVG equity curve."""

from __future__ import annotations

from datetime import UTC, datetime


def _f(x, digits=2):
    if isinstance(x, str):
        return x
    if x is None:
        return "n/a"
    return f"{x:.{digits}f}"


def _row(label: str, st: dict) -> str:
    return (f"| {label} | {st['trades']} | {_f(st['winRate'] * 100, 1)}% | {_f(st['profitFactor'])} | "
            f"{_f(st['expectancyR'], 3)} | {_f(st['totalR'], 1)} | {_f(st['maxDrawdownR'], 1)} |")


HEADER = "| Period | Trades | Win rate | Profit factor | Expectancy (R) | Total R | Max DD (R) |\n|---|---|---|---|---|---|---|"


def equity_svg(points: list[list[float]], width: int = 720, height: int = 240) -> str:
    if len(points) < 2:
        return ""
    xs = [p[0] for p in points]
    ys = [0.0] + [p[1] for p in points]
    x0, x1 = xs[0], xs[-1]
    y0, y1 = min(ys), max(ys)
    span_y = (y1 - y0) or 1.0
    pad = 24

    def sx(x):
        return pad + (x - x0) / ((x1 - x0) or 1) * (width - 2 * pad)

    def sy(y):
        return height - pad - (y - y0) / span_y * (height - 2 * pad)

    path = " ".join(f"{sx(x):.1f},{sy(y):.1f}" for x, y in zip(xs, ys[1:], strict=True))
    zero = sy(0.0)
    first = datetime.fromtimestamp(x0, UTC).strftime("%Y-%m")
    last = datetime.fromtimestamp(x1, UTC).strftime("%Y-%m")
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
<rect width="100%" height="100%" fill="#ffffff"/>
<line x1="{pad}" x2="{width - pad}" y1="{zero:.1f}" y2="{zero:.1f}" stroke="#bbb" stroke-dasharray="4 4"/>
<polyline fill="none" stroke="#b8860b" stroke-width="1.6" points="{path}"/>
<text x="{pad}" y="{height - 6}" font-family="sans-serif" font-size="11" fill="#555">{first}</text>
<text x="{width - pad}" y="{height - 6}" font-family="sans-serif" font-size="11" fill="#555" text-anchor="end">{last}</text>
<text x="{pad}" y="14" font-family="sans-serif" font-size="11" fill="#555">cumulative R (out of sample): {ys[-1]:.1f}</text>
</svg>
"""


def _gate_rows(res: dict) -> list[str]:
    g, oos, hold = res["gate"], res["oos"], res["holdout"]["stats"]
    th, ok = g["thresholds"], g["checks"]
    rows = [
        ("Out-of-sample trades", f"≥ {th['minTrades']}", str(oos["trades"]), ok["trades"]),
        ("Profit factor", f"> {th['minProfitFactor']}", _f(oos["profitFactor"]), ok["profitFactor"]),
        ("Expectancy (R)", f"> {th['minExpectancyR']}", _f(oos["expectancyR"], 3), ok["expectancy"]),
        ("Max drawdown (R)", f"≤ {th['maxDrawdownR']}", _f(oos["maxDrawdownR"], 1), ok["maxDrawdown"]),
        ("Monte Carlo p95 drawdown (R)", f"≤ {th['maxMonteCarloP95DrawdownR']}",
         _f(oos["monteCarloDrawdownR"]["p95"], 1), ok["monteCarloDrawdown"]),
        ("Holdout expectancy", "> 0", f"{_f(hold['expectancyR'], 3)} ({hold['trades']} trades)", ok["holdoutPositive"]),
    ]
    return [f"| {name} | {limit} | {value} | {'yes' if passed else 'no'} |" for name, limit, value, passed in rows]


def _params_label(c: dict) -> str:
    if "slAtrMult" in c:
        return f"SL {c['slAtrMult']}×ATR, pullback {c['pullbackBars']}, TP1 close {int(c['tp1Fraction'] * 100)}%"
    return f"stop {c['stop']}, TP2 {c['tp2R']}R, trend filter {'on' if c['trendFilter'] else 'off'}"


def render_markdown(res: dict) -> str:
    g = res["gate"]
    verdict = "PASS" if g["pass"] else "FAIL"
    lines = [
        f"# Walk-forward report: {res['strategy']['id']} v{res['strategy']['version']}",
        "",
        f"Generated {res['generatedAt']} from Dukascopy XAUUSD M1 data, {res['data']['from']} to "
        f"{res['data']['to']} ({res['data']['m1Bars']:,} bars). All results are hypothetical and net of "
        "spread, commission and slippage unless stated.",
        "",
        f"## Gate 1 verdict: **{verdict}**",
        "",
        "| Check | Threshold | Result | Pass |",
        "|---|---|---|---|",
        *_gate_rows(res),
        "",
        f"Out-of-sample expectancy 95% bootstrap interval: {_f(res['oos']['expectancyCI95'][0], 3)} to "
        f"{_f(res['oos']['expectancyCI95'][1], 3)} R.",
        "",
        "![Out-of-sample equity curve](walkforward_equity.svg)",
        "",
        "## Walk-forward windows",
        "",
        f"Train {res['design']['trainMonths']} months, test {res['design']['testMonths']} months. "
        f"Parameters are chosen on the train window only (highest expectancy with at least "
        f"{res['design']['minTrainTrades']} trades) from the pre-registered grid.",
        "",
        "| Test window | Chosen params | Train exp. (R) | Test trades | Test exp. (R) | Test PF |",
        "|---|---|---|---|---|---|",
    ]
    for w in res["windows"]:
        c = w["chosen"]
        lines.append(
            f"| {w['test'][0]} → {w['test'][1]} | {_params_label(c)} | {_f(w['trainStats']['expectancyR'], 3)} | "
            f"{w['testStats']['trades']} | {_f(w['testStats']['expectancyR'], 3)} | {_f(w['testStats']['profitFactor'])} |"
        )
    lines += ["", "## Default parameters, whole period", "", HEADER,
              _row("All", res["defaultFullPeriod"])]
    for y, st in res["defaultByYear"].items():
        lines.append(_row(y, st))
    v = res["variants"]
    lines += ["", "## Sensitivity (default parameters, whole period)", "", HEADER,
              _row("As tested", res["defaultFullPeriod"]),
              _row("No news filter", v["defaultNoNews"]),
              _row("No commission or slippage (spread kept)", v["defaultNoCommissionOrSlippage"]),
              "", "## Full grid, whole period (in-sample, for context only)", "", HEADER]
    for row in res["gridFullPeriod"]:
        c = row["params"]
        lines.append(_row(_params_label(c), row["stats"]))
    reasons = res["defaultDecisionReasons"]
    total = sum(reasons.values()) or 1
    lines += ["", "## Why most M5 bars produce no signal (default parameters)", "",
              "| Reason | Bars | Share |", "|---|---|---|"]
    for k, n in sorted(reasons.items(), key=lambda kv: -kv[1]):
        lines.append(f"| {k} | {n:,} | {n / total * 100:.1f}% |")
    lines += ["", "## Caveats", "",
              "- Dukascopy prices and spreads differ from any retail broker. The forward test on broker data is the real check.",
              "- The news filter uses a proxy calendar (every 08:30 New York slot, ISM, FOMC), which over-blocks.",
              "- Intrabar order is resolved conservatively on M1 bars: a bar touching stop and target counts as a stop.",
              "- Past performance, simulated or not, does not predict future results. Not financial advice.",
              ""]
    return "\n".join(lines)
