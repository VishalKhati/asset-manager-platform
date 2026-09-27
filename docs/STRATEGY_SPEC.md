# Strategy spec: `ema_stoch_atr` v1 (frozen 2026-09-26)

This is the contract implemented twice, in `research/src/xausig` (Python) and `lib/strategy` (TypeScript). The golden fixtures in `fixtures/golden/` prove the two agree bar for bar. **Any rule change bumps the version** and starts a new track-record segment.

## Data

- **Input:** closed M1 bars, bid OHLC, plus `spread` = ask − bid at the bar close, in price units. Times are UTC epoch seconds of the bar open.
- **Higher timeframes:** M5 and M15 are aggregated from M1: bucket = `t − t mod tf`; open = first, high = max, low = min, close = last, spread = last M1's spread.
- **Closing a bucket:** it closes when a bar at or after its end arrives, or when its last minute (`end − 60`) has been processed.
- **Processing order for each M1 bar `b`:**
  1. Close buckets ending at or before `b.t`, and evaluate each newly closed M5 bar.
  2. Advance open signals with `b`.
  3. Add `b` to the buckets.
  4. Close buckets ending at `b.t + 60`, and evaluate.

## Indicators (incremental, IEEE-754 doubles, fixed operation order)

- **EMA(n):** undefined for the first n−1 values. At value n it is the SMA of the first n. After that, `α·x + (1−α)·prev` with `α = 2/(n+1)`.
- **ATR(n), Wilder:**
  - True range TR = `max(h−l, |h−prevC|, |l−prevC|)`. The first bar's TR is `h−l`.
  - The seed is the mean of the first n TRs, then `(prev·(n−1) + TR)/n`.
- **Stochastic(k=5, smooth=3, d=3):**
  - raw = `100·(c − LL)/(HH − LL)` over the last k bars, or 50 if HH = LL.
  - %K = SMA(smooth) of raw. %D = SMA(d) of %K.

## Decision at each M5 close `T` (first failing check is the reason code)

| # | Reason | Rule |
|---|---|---|
| 1 | `warmup` | fewer than `warmupM5` (150) M5 or `warmupM15` (600) M15 bars seen |
| 2 | `data_gap` | the last three M5 bars are not consecutive, or the last closed M15 bar ended 15 min or more before `T` |
| 3 | `session` | `T` not inside London 07:00–16:00 (Europe/London) or New York 08:00–16:00 (America/New_York) on a local weekday; DST follows each zone |
| 4 | `friday_cutoff` | Friday (UTC) at or after 20:00 UTC |
| 5 | `news` | a high-impact USD event within ±15 min of `T` |
| 6 | `one_open` | a signal is pending, active or at breakeven |
| 7 | `cooldown` | `T` is within 60 min after a losing stop or losing time exit |
| 8 | `bias_none` | on the last closed M15 bar: long needs close > EMA200 and EMA20 > EMA50; short needs the opposite |
| 9 | `no_cross` | long: `K[i−1] ≤ D[i−1]`, `K[i] > D[i]`, `K[i−1] < 20`. Short: `K[i−1] ≥ D[i−1]`, `K[i] < D[i]`, `K[i−1] > 80` |
| 10 | `no_pullback` | long: one of the last `pullbackBars` (3) M5 bars has low ≤ max(EMA20, EMA50), and the trigger closes ≥ min(EMA20, EMA50). Short mirrored |
| 11 | `spread` | spread > 1.0, or spread > 0.25 × ATR |
| 12 | `atr_range` | ATR / close outside 1.5–30 basis points |
| 13 | `signal` | all passed |

EMAs 20/50 in rows 10–12 are on M5. ATR is ATR(14) on M5.

## Levels

- **Entry reference:** the trigger close, plus spread for longs, because longs buy at the ask.
- **Stop distance:**
  - Long: `max(1.5 × ATR, entry − (lowest low of the last 10 M5 bars − 0.1 × ATR))`.
  - Short: `max(1.5 × ATR, (highest high of the last 10 M5 bars + spread + 0.1 × ATR) − entry)`.
- `SL = entry ∓ dist`, `TP1 = entry ± 1 × dist`, `TP2 = entry ± 2 × dist`. `1R = dist`.

## Resolution on M1 bars (conservative)

- **Fill:**
  - At the first M1 bar at or after `T`: longs fill at the open plus spread plus slippage, shorts at the open minus slippage.
  - The signal is `expired` if the fill is more than 0.25R from the entry reference, or if no bar arrives within 30 min.
- **Exit sides:** longs exit on the bid, shorts on the ask (bid + spread).
- **Stop first:** if a bar reaches the stop, the stop wins even when a target is touched in the same bar. A gap through the stop fills at the open. Stop exits pay slippage.
- **TP1:** close `tp1Fraction` (50%) at TP1 and move the stop to the fill price. If the same bar also touches the fill price, the rest closes there.
- **TP2:** the rest closes at TP2. Limit exits fill exactly at the level.
- **Time exit:** at the open of the first bar at or after `fill + 240 min`, or Friday 20:45 UTC, whichever comes first.
- **R:**
  - `R_gross = Σ fraction × (exit − fill) × direction / dist`.
  - `R_cost = commission / dist`, with commission 0.06 per oz round trip. Slippage is 0.05.
  - `R_net = R_gross − R_cost`.
- **Outcomes:** `sl`, `tp1_be`, `tp2`, `time_exit`, `expired` (R = 0, excluded from trade stats).

## Pre-registered research grid (do not change without a `research/reports/GRAVEYARD.md` entry)

`slAtrMult ∈ {1.5, 2.0}` × `pullbackBars ∈ {3, 5}` × `tp1Fraction ∈ {0.5, 0.0}`. Everything else stays at the values above.

## Known differences between research and live

- The live engine warms its indicators on the last 15 days of stored bars, while research starts from the first bar. EMA200 on M15 converges well within that window, but rare decisions at a knife-edge crossover can differ.
- Research uses a proxy news calendar (see `research/src/xausig/news.py`). Live uses the ForexFactory calendar.
- Research prices are Dukascopy; live prices are the broker's MT5 feed.
