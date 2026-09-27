"""Forward-test parity check (Gate 2): does the live engine match the Python reference on broker data?

Replays the M1 bars stored by the live service through ``xausig`` with the same strategy config
and news events, then compares every signal the engine recorded in the window.

    python scripts/parity_check.py --db postgresql://… --from 2026-10-01 --to 2026-10-08 [--mode forward]

Warm-up: the replay starts ``--warmup-days`` (default 20) before ``--from``, like the engine's own
warm-up, and only signals decided inside the window are compared. The engine never re-decides
old bars, so a signal it made while paused or during a different config is reported, not hidden.
Exit code 0 = identical, 1 = differences (listed).
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime

import psycopg2

from xausig.bars import Bar
from xausig.params import Params
from xausig.replay import Replay


def ts(s: str) -> int:
    return int(datetime.fromisoformat(s).replace(tzinfo=UTC).timestamp())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--from", dest="date_from", required=True)
    ap.add_argument("--to", dest="date_to", required=True)
    ap.add_argument("--symbol", default="XAUUSD")
    ap.add_argument("--mode", default="forward")
    ap.add_argument("--warmup-days", type=int, default=20)
    args = ap.parse_args()
    a, b = ts(args.date_from), ts(args.date_to)

    conn = psycopg2.connect(args.db)
    cur = conn.cursor()
    cur.execute("select id, params from strategy_configs where symbol = %s and is_active", (args.symbol,))
    row = cur.fetchone()
    if not row:
        print("no active strategy config", file=sys.stderr)
        return 2
    config_id, params_json = row
    params = Params.from_json(params_json if isinstance(params_json, dict) else json.loads(params_json))

    cur.execute("select t, o, h, l, c, spread from candles where symbol = %s and t >= %s and t < %s order by t",
                (args.symbol, a - args.warmup_days * 86_400, b))
    bars = [Bar(int(t), float(o), float(h), float(lo), float(c), float(s)) for t, o, h, lo, c, s in cur.fetchall()]
    cur.execute("select distinct t from news_events where impact = 'high' and currency = 'USD' and t between %s and %s",
                (a - args.warmup_days * 86_400, b + 86_400))
    news = sorted(int(r[0]) for r in cur.fetchall())

    cur.execute(
        "select t, direction, coalesce(outcome, ''), state, r_net, config_id from signals "
        "where symbol = %s and mode = %s and t >= %s and t < %s order by t",
        (args.symbol, args.mode, a, b),
    )
    engine = [(int(t), d, o, st, r, cfg) for t, d, o, st, r, cfg in cur.fetchall()]

    replay = Replay(params, news=news).run(bars)
    reference = [(s.t, "long" if s.plan.direction == 1 else "short", s.outcome, s.state, s.r_net)
                 for s in replay.signals if a <= s.t < b]

    print(f"bars {len(bars)}, news {len(news)}, engine signals {len(engine)}, reference signals {len(reference)}")
    diffs = []
    eng_by_t = {e[0]: e for e in engine}
    ref_by_t = {r[0]: r for r in reference}
    for t in sorted(set(eng_by_t) | set(ref_by_t)):
        e, r = eng_by_t.get(t), ref_by_t.get(t)
        when = datetime.fromtimestamp(t, UTC).strftime("%Y-%m-%d %H:%M")
        if e is None:
            diffs.append(f"{when}: reference has {r[1]} {r[2]}, engine has nothing")
        elif r is None:
            note = " (different config)" if e[5] != config_id else ""
            diffs.append(f"{when}: engine has {e[1]} {e[2]}{note}, reference has nothing")
        elif (e[1], e[2]) != (r[1], r[2]) or (e[4] is not None and abs(e[4] - r[4]) > 1e-6):
            diffs.append(f"{when}: engine {e[1]} {e[2]} {e[4]} vs reference {r[1]} {r[2]} {r[4]:.6f}")
    if diffs:
        print("DIFFERENCES:\n  " + "\n  ".join(diffs))
        return 1
    print("parity OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
