# Research log ("graveyard")

Every experiment that looked at results, kept whether or not it worked. It exists so nobody, including future us, can quietly tune the strategy on data it is later judged by.

| Date | What was run | Data seen | Result | Changed anything? |
|---|---|---|---|---|
| 2026-09-26 | Sanity run of v1 defaults (SL 1.5×ATR, pullback 3, TP1 close 50%) while testing the simulator | 2019-01 → 2021-12 (in-sample years only) | 634 trades, expectancy −0.13R net, PF 0.76. Costs ≈ 0.17R per trade; without commission and slippage still −0.08R. | No. The grid in `walkforward.py` was already fixed; this run only confirmed the simulator's accounting (e.g. a sample trade checked by hand). |
| 2026-09-26 | **Walk-forward v1** (`reports/WALKFORWARD.md`): pre-registered 8-combination grid, 24-month train / 6-month test from 2021, 2026 holdout run once | 2019-01 → 2026-09 (6 one-sided months rebuilt from the other side, flagged in MANIFEST) | **Gate 1 FAIL.** OOS 1,378 trades, expectancy −0.090R (95% CI −0.145 to −0.034), PF 0.82, max DD 131R. Holdout −0.186R over 340 trades. Every grid combination negative even in-sample (best −0.108R). Without commission/slippage still −0.104R. | No. Per the plan: strategy work on v1 stops; the negative result is published and the service runs in shadow/forward mode as an infrastructure showcase until a new strategy passes Gate 1. |
