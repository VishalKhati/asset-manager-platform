# Walk-forward report: delta_va_fade (hypothesis v3)

Generated 2026-10-16T10:11:56Z. Data: Binance XAUUSDT perp 2025-12-11..2026-10-15 (432,936 M1 bars). Pre-registered in `research/HYPOTHESIS_V3.md` (commit a42ecde) before any data was downloaded.

## Gate 1 verdict: **FAIL**

| Check | Threshold | Result | Pass |
|---|---|---|---|
| Out-of-sample trades | ≥ 100 | 76 | no |
| Profit factor | > 1.3 | 1.07 | no |
| Expectancy (R) | > 0.2 | 0.040 | no |
| Max drawdown (R) | ≤ 15.0 | 6.9 | yes |
| Bybit XAUT holdout | ≥ 30 trades, expectancy > 0 | 51 trades, 0.093 R | yes |

Out-of-sample expectancy 95% bootstrap interval: -0.262 to 0.385 R. Win rate 46.1%. Monte Carlo p95 drawdown 16.4R.

Primary tail (2026-10-01..15, informational): 11 trades, -0.289 R.

## Walk-forward windows

| Test window | Chosen | Train trades / exp. | Test trades | Test exp. (R) | Test PF |
|---|---|---|---|---|---|
| 2026-04-01 → 2026-06-01 | W 60 min, buffer 0.25 ATR | 19 / 0.147 | 30 | 0.099 | 1.21 |
| 2026-06-01 → 2026-08-01 | W 30 min, buffer 0.25 ATR | 46 / 0.189 | 17 | 0.191 | 1.29 |
| 2026-08-01 → 2026-10-01 | W 30 min, buffer 0.1 ATR | 53 / 0.229 | 29 | -0.110 | 0.81 |

## Full grid, whole primary period (in-sample, context only)

| Params | Trades | Win rate | PF | Expectancy (R) | Total R | Max DD (R) |
|---|---|---|---|---|---|---|
| W 30, buffer 0.1 | 118 | 50.8% | 1.10 | 0.051 | 6.1 | 9.8 |
| W 30, buffer 0.25 | 108 | 51.9% | 1.17 | 0.084 | 9.1 | 8.6 |
| W 60, buffer 0.1 | 110 | 44.5% | 0.78 | -0.125 | -13.7 | 20.1 |
| W 60, buffer 0.25 | 98 | 49.0% | 1.01 | 0.004 | 0.4 | 10.6 |

## Does the free order flow predict anything? (diagnostic)

Correlation of 5-minute perp delta with the following return:

- `perp_delta5_vs_next5m`: -0.0117
- `perp_delta5_vs_next15m`: -0.0053
- `perp_delta5_vs_spot_next5m`: -0.0035
- `perp_delta5_vs_spot_next15m`: -0.0006
- `spotOverlapBars5m`: 55906

## Why most M5 bars produce no signal (final params)

| Reason | Count |
|---|---|
| no_setup | 58,262 |
| no_session | 27,657 |
| window | 1,330 |
| session | 460 |
| one_open | 216 |
| no_room | 214 |
| no_prev_session | 154 |
| signal | 111 |
| news | 54 |
| cooldown | 50 |
| warmup | 13 |
| atr_range | 6 |

## Caveats

- Only ~10 months of free gold order-flow history exist; results carry wide uncertainty.
- Execution is simulated on the perp's prices with MT5-like costs; live trading would be on MT5 spot gold.
- Session rule clarification (weekends and the 17:00–18:00 New York break excluded from profiles and CVD) was fixed in code before any result was seen.
- Not financial advice.
