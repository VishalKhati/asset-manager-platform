/**
 * "Time Machine": the odds of a signal's stop and targets, before taking it.
 *
 * Two views, both from price history strictly before the signal:
 *  1. Simulated: N paths of the next `steps` M5 candles. Each candle is drawn at random
 *     from the candles seen at that time of day (New York time) in recent sessions,
 *     scaled to the path's current price.
 *  2. Real analog days: the same trade (same distances, as % of price) placed at the same
 *     time of day on each past session, run through that day's actual candles.
 *
 * Trades are managed exactly like real signals: the stop wins ties within a candle,
 * TP1 closes `tp1Fraction` and moves the stop to entry, then TP2, then the time limit.
 * Costs are ignored. Resampled candles break up trends, so the odds mostly reflect how
 * far the stop and targets are relative to normal volatility: they measure risk, not edge.
 */

export interface ShapeCandle {
  /** High, low and close relative to the open: h/o − 1, l/o − 1, c/o − 1. */
  dh: number;
  dl: number;
  dc: number;
}

export interface TmTrade {
  direction: 1 | -1;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp1Fraction: number;
}

export type TmOutcome = "sl" | "tp1_be" | "tp2" | "time";

export interface TmResult {
  paths: number;
  steps: number;
  seed: number;
  /** Share of simulated paths ending in each outcome. */
  simulated: Record<TmOutcome, number>;
  /** Simulated chance that TP1 is touched before the stop. */
  simTp1BeforeStop: number;
  /** Average R per simulated path, before costs. */
  simExpectedR: number;
  /** Real analog days counted by outcome. */
  analog: Record<TmOutcome, number> & { days: number };
  analogExpectedR: number | null;
}

/** Deterministic PRNG so a result can be repeated from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Run one trade through a sequence of candles. Returns the outcome and the R result. */
export function walk(trade: TmTrade, candles: Iterable<{ h: number; l: number; c: number }>): { outcome: TmOutcome; r: number; tp1Hit: boolean } {
  const d = trade.direction;
  const risk = Math.abs(trade.entry - trade.sl);
  const rAt = (p: number) => ((p - trade.entry) * d) / risk;
  let stop = trade.sl;
  let atBe = false;
  let banked = 0;
  let last = trade.entry;
  for (const c of candles) {
    last = c.c;
    const adverse = d === 1 ? c.l <= stop : c.h >= stop;
    if (adverse) {
      return atBe ? { outcome: "tp1_be", r: banked, tp1Hit: true } : { outcome: "sl", r: -1, tp1Hit: false };
    }
    const fav = (lvl: number) => (d === 1 ? c.h >= lvl : c.l <= lvl);
    if (!atBe && fav(trade.tp1)) {
      atBe = true;
      banked = trade.tp1Fraction * rAt(trade.tp1);
      stop = trade.entry;
      if (d === 1 ? c.l <= stop : c.h >= stop) return { outcome: "tp1_be", r: banked, tp1Hit: true };
    }
    if (fav(trade.tp2)) {
      const rest = atBe ? 1 - trade.tp1Fraction : 1;
      return { outcome: "tp2", r: banked + rest * rAt(trade.tp2), tp1Hit: true };
    }
  }
  const rest = atBe ? 1 - trade.tp1Fraction : 1;
  return { outcome: "time", r: banked + rest * rAt(last), tp1Hit: atBe };
}

/**
 * @param slots   for each step k (0-based), the candle shapes seen at that time of day in past sessions
 * @param analogs real past sessions: each is the list of candle shapes from the signal's time of day onward
 */
export function timeMachine(trade: TmTrade, slots: ShapeCandle[][], analogs: ShapeCandle[][], paths = 10_000, seed = 19): TmResult {
  const rand = mulberry32(seed);
  const counts: Record<TmOutcome, number> = { sl: 0, tp1_be: 0, tp2: 0, time: 0 };
  let sumR = 0;
  let tp1First = 0;
  for (let i = 0; i < paths; i++) {
    let price = trade.entry;
    const candles = function* () {
      for (const slot of slots) {
        if (!slot.length) continue;
        const s = slot[Math.floor(rand() * slot.length)]!;
        const o = price;
        price = o * (1 + s.dc);
        yield { h: o * (1 + s.dh), l: o * (1 + s.dl), c: price };
      }
    };
    const res = walk(trade, candles());
    counts[res.outcome] += 1;
    sumR += res.r;
    if (res.tp1Hit) tp1First += 1;
  }
  const analog: Record<TmOutcome, number> = { sl: 0, tp1_be: 0, tp2: 0, time: 0 };
  let analogR = 0;
  for (const day of analogs) {
    let price = trade.entry;
    const candles = day.map((s) => {
      const o = price;
      price = o * (1 + s.dc);
      return { h: o * (1 + s.dh), l: o * (1 + s.dl), c: price };
    });
    const res = walk(trade, candles);
    analog[res.outcome] += 1;
    analogR += res.r;
  }
  const share = (n: number) => n / paths;
  return {
    paths,
    steps: slots.length,
    seed,
    simulated: { sl: share(counts.sl), tp1_be: share(counts.tp1_be), tp2: share(counts.tp2), time: share(counts.time) },
    simTp1BeforeStop: share(tp1First),
    simExpectedR: sumR / paths,
    analog: { ...analog, days: analogs.length },
    analogExpectedR: analogs.length ? analogR / analogs.length : null,
  };
}
