# Pre-registration: hypothesis v2, `london_orb`

Written and committed on 2026-09-27, **before** any v2 code was run on any data. The git history is the proof. After results are seen, nothing below may change. Any follow-up is a new hypothesis with its own file and a GRAVEYARD entry.

## Why v1 failed and what v2 changes

v1 (EMA + Stochastic + ATR on M5) lost about 0.14R per trade before commission. Its median stop was about $3, so the $0.35 spread alone cost more than 10% of R. v2 trades once a day on a structural level, with stops of roughly $10–20, so costs fall to a few percent of R.

## Hypothesis

Gold's overnight Asian session builds a range. When London opens, new liquidity often breaks that range, and the break tends to continue. A breakout of the Asian range in the first three London hours, taken in its direction, has positive expectancy after costs.

## Rules (all times Europe/London local, so they follow UK daylight saving)

- **Asian range:** high and low of M1 bars from 00:00 to 07:00 on a weekday (Mon–Fri). Skip the day if its width is under 0.10% or over 0.80% of the 07:00 price, or if fewer than 300 M1 bars fall in the window.
- **Entry window:** M15 bars closing from 07:15 to 10:00 inclusive.
- **Trigger:** the first M15 close above the range high means long; below the range low means short. Only the first breakout of the day counts, and there is at most one signal per day, win or lose.
- **Trend filter (variant):** long only if the trigger close is above the EMA(200) of H1 closes, short only if below. H1 bars are aggregated from M1 the same way as M5 and M15.
- **News:** skip the trigger if a high-impact USD event (the research proxy calendar) falls within ±15 minutes.
- **Entry:** same fill model as v1. Fill at the next M1 open plus spread for longs; expire if the fill is more than 0.25R from the trigger close, or if nothing fills within 30 minutes.
- **Stop (variant):** `opposite` puts the stop at the other side of the range; `mid` puts it at the range midpoint. For longs it sits below that level by the trigger bar's spread, and shorts are mirrored.
- **Targets:** TP1 at 1R closes 50% and moves the stop to entry. TP2 at the variant multiple of R.
- **Time exit:** at 16:00 London, at the first M1 open at or after that time.
- **Resolution and costs:** same tracker, spread, commission (0.06) and slippage (0.05) as v1.

## Pre-registered grid (8 combinations)

`stop ∈ {opposite, mid}` × `tp2R ∈ {2.0, 3.0}` × `trendFilter ∈ {on, off}`

## Evaluation (identical to v1)

- Walk-forward with a 24-month train and 6-month test window. Test windows run from 2021-01 to 2025-12. Parameters are chosen on the train window by highest expectancy, with at least 60 trades.
- **Holdout:** 2026-01-01 to 2026-09-25, evaluated once.
- **Gate 1:** out-of-sample ≥ 200 trades, profit factor > 1.3, expectancy > 0.2R net, max drawdown ≤ 15R, Monte Carlo p95 drawdown ≤ 20R, holdout expectancy > 0.
- **Expected power:** about 250 trading days a year × roughly 60% of days with a qualifying breakout ≈ 150 trades a year, so about 750 out-of-sample trades.

## Data caveat

Six months (2022-10, 2022-11, 2023-05, 2023-07, 2023-10, 2023-12) had one side missing from Dukascopy and were rebuilt from the other side using the median spread for each hour. The holdout is not affected.

## Outcomes decided in advance

- **Pass:** port the strategy to `lib/strategy` with golden fixtures, run it in `shadow` mode, then start the forward test (Phase 6).
- **Fail:** log it in GRAVEYARD, keep the service in shadow mode as an engineering showcase, and publish both negative results.
