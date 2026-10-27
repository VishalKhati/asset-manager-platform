# Pre-registration: hypothesis v4, `macro_trend`

Committed and pushed on 2026-10-16, **before** any analysis of the data below. So far I have only checked that the sources respond and how far back they go. After results are seen, nothing here changes.

## Hypothesis

Gold does better when its own trend and its two main macro drivers line up: falling US real yields, so the opportunity cost of holding gold falls, and a weakening dollar. A daily long/flat (or long/short) position driven by that agreement beats simply holding gold on a risk-adjusted basis, after the costs an MT5 CFD trader actually pays.

This is a holding strategy, with positions lasting days to months, so it is judged on daily returns against buy-and-hold, not in R per trade.

## Data (all free)

| Series | Source | Use |
|---|---|---|
| GLD daily adjusted close | Yahoo Finance chart API | Gold price proxy (tracks the LBMA price) |
| `DFII10` (10-year TIPS real yield) | FRED | Real-yield momentum |
| `DTWEXBGS` (broad trade-weighted dollar) | FRED | Dollar momentum |
| `DFF` (fed funds rate) | FRED | Overnight financing cost of holding a CFD |
| GC=F daily close | Yahoo | Cross-check only |

**No look-ahead:** FRED values are used with a one-business-day lag, because a day's value is published the next day.

## Signals (computed at the close of day t)

- `trend = 1` if GLD close > SMA(N) of GLD closes.
- `ry = 1` if DFII10 (lagged) < DFII10 63 business days earlier (real yields falling).
- `usd = 1` if DTWEXBGS (lagged) < DTWEXBGS 63 business days earlier (dollar weakening).
- `bull = trend + ry + usd`, `bear = 3 − bull`.
- **Position for day t+1:** long if `bull ≥ k`; short if `bear ≥ k` and the mode is `long_short`; otherwise flat.

## Returns and costs

- Strategy return for day t+1 = position × GLD close-to-close return.
- **Trading cost:** 0.03% of notional each time the position changes (spread plus slippage), and 0.06% when it flips straight from long to short.
- **Financing (MT5-style swap),** per calendar day between closes:
  - Long pays `(DFF + 2.5%) / 360`.
  - Short receives `(DFF − 2.5%) / 360`, which is negative, so a cost, when DFF is below 2.5%.

## Benchmarks

- **Buy-and-hold GLD with the same long financing.** This is the honest comparison for a CFD trader.
- **Buy-and-hold GLD without financing** (an ETF holder), reported for context.

## Pre-registered grid (8 combinations)

`N ∈ {100, 200}` × `k ∈ {2, 3}` × `mode ∈ {long_flat, long_short}`

## Evaluation

- **Walk-forward:**
  - Train on the 5 calendar years before each test window, test on the next 2.
  - Test windows: 2012–13, 2014–15, 2016–17, 2018–19, 2020–21, 2022–23, 2024–25.
  - Selection: the highest annualised Sharpe ratio (net, 0% risk-free) on the train window.
- **Holdout:** 2026-01-01 to 2026-10-15, run once with the parameters chosen on 2021–2025.

## Gate 1 (v4)

All of these must hold on the concatenated out-of-sample days (2012–2025):

1. Net Sharpe ≥ 0.5.
2. Net Sharpe greater than the Sharpe of buy-and-hold with financing over the same days.
3. Max drawdown no deeper than buy-and-hold with financing.
4. At least 20 position changes.

In addition, the 2026 holdout return must be > 0.

## Outcomes decided in advance

- **Pass:**
  - Port to `lib/strategy` with golden fixtures.
  - Add FRED and GLD daily ingestion to the engine.
  - Run in shadow mode, then on an MT5 demo for at least 4–6 weeks (positions change rarely, so expect only a few trades).
  - Real money only after that.
- **Fail:** log it in GRAVEYARD and publish. Candidates for a separate pre-registration, from the same reel, include CFTC positioning extremes, ETF flows and the gold/silver ratio.
