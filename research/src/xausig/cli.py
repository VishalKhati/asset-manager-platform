"""Command line: ``xausig build-data | qa | backtest | walkforward``."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from .data import build_m1, load_m1, qa_report
from .params import Params

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
M1_PATH = ROOT / "data" / "xauusd_m1.parquet"
REPORTS = ROOT / "reports"


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="xausig")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("build-data", help="merge raw Dukascopy CSVs into data/xauusd_m1.parquet")
    sub.add_parser("qa", help="data coverage and spread report")
    bt = sub.add_parser("backtest", help="single run with default or given params")
    bt.add_argument("--from", dest="date_from")
    bt.add_argument("--to", dest="date_to")
    bt.add_argument("--params", help="JSON file with parameter overrides")
    bt.add_argument("--no-news", action="store_true")
    wf = sub.add_parser("walkforward", help="full walk-forward + holdout report")
    wf.add_argument("--processes", type=int, default=8)
    args = ap.parse_args(argv)

    if args.cmd == "build-data":
        print(json.dumps(build_m1(RAW, M1_PATH), indent=2))
    elif args.cmd == "qa":
        rep = qa_report(load_m1(M1_PATH))
        REPORTS.mkdir(exist_ok=True)
        (REPORTS / "data_qa.json").write_text(json.dumps(rep, indent=2) + "\n")
        print(json.dumps({k: v for k, v in rep.items() if k != "spreadByUtcHour"}, indent=2))
    elif args.cmd == "backtest":
        from .walkforward import backtest

        df = load_m1(M1_PATH)
        if args.date_from:
            df = df[df["t"] >= _ts(args.date_from)]
        if args.date_to:
            df = df[df["t"] < _ts(args.date_to)]
        p = Params()
        if args.params:
            p = p.replace(**json.loads(Path(args.params).read_text()))
        t0 = time.time()
        res = backtest(df.reset_index(drop=True), p, use_news=not args.no_news)
        print(json.dumps({"stats": res["stats"], "reasons": res["reasons"], "seconds": round(time.time() - t0, 1)},
                         indent=2))
    elif args.cmd == "walkforward":
        from .report import equity_svg, render_markdown
        from .walkforward import walk_forward

        t0 = time.time()
        res = walk_forward(load_m1(M1_PATH), processes=args.processes)
        REPORTS.mkdir(exist_ok=True)
        (REPORTS / "walkforward.json").write_text(json.dumps(res, indent=2) + "\n")
        (REPORTS / "walkforward_equity.svg").write_text(equity_svg(res["oosEquityR"]))
        (REPORTS / "WALKFORWARD.md").write_text(render_markdown(res))
        print(f"gate pass={res['gate']['pass']} oos={res['oos']['trades']} trades, "
              f"exp={res['oos']['expectancyR']:.3f}R in {time.time() - t0:.0f}s")


def _ts(s: str) -> int:
    from datetime import UTC, datetime

    return int(datetime.fromisoformat(s).replace(tzinfo=UTC).timestamp())


if __name__ == "__main__":
    main()
