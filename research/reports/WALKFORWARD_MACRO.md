# Walk-forward report: macro_trend (hypothesis v4)

Generated 2026-10-16T10:35:59Z. GLD daily 2005-01-03 to 2026-10-15 with FRED real yields (DFII10), dollar (DTWEXBGS) and fed funds (DFF). Pre-registered in `research/HYPOTHESIS_V4.md` (commit 2a57f34) before any analysis.

## Gate 1 verdict: **FAIL**

| Check | Strategy (OOS 2012–2025) | Buy-and-hold, financed | Pass |
|---|---|---|---|
| Sharpe ≥ 0.5 | 0.27 | | no |
| Sharpe above buy-and-hold | 0.27 | 0.24 | yes |
| Max drawdown no deeper | -23.8% | -47.6% | yes |
| Position changes ≥ 20 | 147 | | yes |
| 2026 holdout return > 0 | -11.7% | -8.5% | no |

## Out-of-sample summary (2012–2025)

| | CAGR | Volatility | Sharpe | Max drawdown | Total return |
|---|---|---|---|---|---|
| Strategy | 2.3% | 10.3% | 0.27 | -23.8% | 37.0% |
| Buy-and-hold, CFD-financed | 2.6% | 15.4% | 0.24 | -47.6% | 42.7% |
| Buy-and-hold, no financing (ETF) | 6.9% | 15.4% | 0.51 | -42.1% | 155.4% |

Time in market 47.5%, short 6.6%. Final parameters (chosen on 2021–2025): {'N': 100, 'k': 2, 'mode': 'long_flat'}.

## Walk-forward windows

| Test years | Chosen | Train Sharpe | Test Sharpe | Test CAGR | Test max DD | Buy-and-hold Sharpe (financed) |
|---|---|---|---|---|---|---|
| 2012–2013 | N 200, k 3, long_flat | 1.10 | -0.15 | -1.4% | -8.2% | -0.80 |
| 2014–2015 | N 200, k 3, long_flat | 0.86 | -1.04 | -3.7% | -8.3% | -0.58 |
| 2016–2017 | N 200, k 3, long_flat | 0.18 | 0.10 | 0.5% | -9.1% | 0.56 |
| 2018–2019 | N 100, k 2, long_short | -0.06 | 0.29 | 2.6% | -13.7% | 0.28 |
| 2020–2021 | N 200, k 2, long_flat | 0.32 | -0.23 | -4.1% | -23.1% | 0.38 |
| 2022–2023 | N 200, k 2, long_flat | 0.08 | 0.29 | 2.1% | -9.1% | 0.09 |
| 2024–2025 | N 100, k 2, long_flat | 0.22 | 1.42 | 22.2% | -10.4% | 1.78 |

## Full grid, whole period (in-sample, context only)

| Params | Sharpe | CAGR | Max DD | In market | Changes |
|---|---|---|---|---|---|
| N 100, k 2, long_flat | 0.15 | 1.1% | -42.6% | 56.2% | 298 |
| N 100, k 2, long_short | -0.25 | -6.2% | -77.8% | 100.0% | 298 |
| N 100, k 3, long_flat | 0.30 | 2.3% | -23.3% | 26.7% | 230 |
| N 100, k 3, long_short | 0.10 | 0.5% | -39.4% | 47.0% | 473 |
| N 200, k 2, long_flat | 0.28 | 3.1% | -31.9% | 60.2% | 242 |
| N 200, k 2, long_short | -0.03 | -2.2% | -53.7% | 100.0% | 242 |
| N 200, k 3, long_flat | 0.30 | 2.3% | -23.1% | 26.9% | 234 |
| N 200, k 3, long_short | 0.05 | -0.2% | -45.9% | 46.5% | 443 |

## Caveats

- GLD is used as the gold price; MT5 spot gold differs slightly (GLD charges 0.40% a year).
- Financing is a generic MT5 swap model (fed funds ± 2.5%); check your broker's actual swap rates.
- Not financial advice.
