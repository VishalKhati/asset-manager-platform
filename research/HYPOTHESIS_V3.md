# Pre-registration: hypothesis v3, `delta_va_fade`

Committed and pushed to GitHub on 2026-10-16, **before** any order-flow data was downloaded or analysed. After results are seen, nothing below changes; a follow-up is a new file.

## Hypothesis

When gold probes beyond the previous session's value area and aggressive order flow fails to confirm the probe, the probe is absorbed. Price then tends to rotate back toward the previous session's point of control. "Fails to confirm" means price makes a higher high while cumulative delta makes a lower high (mirrored for lows). This is auction market theory with a delta-divergence trigger.

## Data (all free)

- **Primary:** Binance USDⓈ-M `XAUUSDT` perpetual. Aggregated trades from data.binance.vision, each with price, quantity in oz and the `is_buyer_maker` flag. Period: 2025-12-01 to 2026-10-15.
- **Secondary holdout:** Bybit `XAUTUSDT` perpetual public trade archive. The taker side is in the `side` field. Period: 2025-04-03 to 2025-11-30, before the primary data starts.
- **Building bars:** M1 bars come from trades: OHLC, volume, aggressive buy volume and aggressive sell volume. M5 bars are aggregated from M1 exactly as in v1.
- **Delta:** aggressive buy minus aggressive sell volume. **CVD:** delta accumulated from the session start.
- **Execution model:** fills on the perp's own prices with MT5-like costs. Spread is a constant 0.30, commission 0.06 and slippage 0.05, on the same tracker as v1. Live trading would be on MT5 spot gold, whose 1-minute moves are 0.98 correlated with the perp.

## Sessions and value area

- **Session:** the gold trading day runs from 18:00 New York time to 17:00 New York time the next day. "Previous session" means the last fully closed one.
- **Volume profile:** the previous session's traded volume in $1.00 price buckets.
- **POC:** the bucket with the most volume. Ties go to the bucket nearer the session's volume-weighted price.
- **Value area (70%):** start at the POC. Repeatedly add the adjacent bucket, above or below, with more volume (above wins ties) until the area holds at least 70% of the session's volume. VAH and VAL are the outer edges of the area's top and bottom buckets.

## Signal, evaluated at each M5 close `T`

`W` is the window length (grid). Window A covers M5 bars in `[T−2W, T−W)` (the earlier swing). Window B covers `[T−W, T)` (the probe).

- **Short:**
  1. `hB = max high(B)` must be above both `hA = max high(A)` and VAH.
  2. CVD at the close of the bar holding `hB` must be **below** CVD at the close of the bar holding `hA`. Both bars must be in the current session.
  3. The bar closing at `T` must close **below** VAH.
- **Long:** mirrored with lows, VAL and higher CVD.
- **Filters (same as v1):**
  - London 07:00–16:00 or New York 08:00–16:00 local time.
  - No new signals Friday after 20:00 UTC.
  - High-impact USD news within ±15 min (research proxy calendar).
  - One open signal at a time; 60-minute cooldown after a losing stop or time exit.
  - Spread and ATR(14, M5) band as in v1.
- **Entry:** fill at the next M1 open. The signal expires if the fill is more than 0.25R from the trigger close, or if nothing fills within 30 min.
- **Stop:**
  - Short: `hB + stopBuffer × ATR + spread`. Long: `lB − stopBuffer × ATR`.
  - Distance = `max(structural distance, 0.5 × ATR)`.
- **Targets:**
  - TP1 at 1R closes 50% and moves the stop to entry.
  - TP2 is the previous session's POC.
  - Skip the signal if the POC is on the wrong side of entry or less than 1.5R away.
- **Time exit:** 240 min, or Friday 20:45 UTC.

## Pre-registered grid (4 combinations)

`W ∈ {30, 60}` minutes × `stopBuffer ∈ {0.10, 0.25}`.

## Evaluation

- **Walk-forward on primary data:**
  - Train 4 months, test the following 2 months, step 2 months.
  - Test windows: 2026-04/05, 2026-06/07, 2026-08/09.
  - Selection: the highest train expectancy with at least 40 trades.
- **Final parameters:** selected on 2025-12-01 to 2026-07-31.
- **Holdouts, each run once:**
  - Primary tail, 2026-10-01 to 2026-10-15 (informational, too short to gate on).
  - Secondary: Bybit XAUTUSDT, 2025-04-03 to 2025-11-30.
- **Gate 1 (v3):**
  - Out-of-sample (the three test windows): ≥ 100 trades, profit factor > 1.3, expectancy > 0.2R net, max drawdown ≤ 15R.
  - Secondary holdout: ≥ 30 trades with expectancy > 0.
- **Diagnostic, reported but not gating:** correlation of 5-minute perp delta with the next 5- and 15-minute returns, on perp and on Dukascopy spot where the two overlap.

## Outcomes decided in advance

- **Pass:** a TypeScript port with golden fixtures, a live tape feed from the Binance websocket, then an MT5 **demo** forward test for at least 4–6 weeks (Gate 2). Real money only after that.
- **Fail:** log it in GRAVEYARD and publish. The free data collectors keep running, so a longer history accumulates for a future, separately pre-registered test.
