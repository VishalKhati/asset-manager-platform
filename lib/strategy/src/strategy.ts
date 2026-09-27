import { M5, M15, type IndBar } from "./bars";
import type { Params } from "./params";
import { afterFridayCutoff, inSessions } from "./time";

/**
 * The decision taken at each M5 close. Mirrors research/src/xausig/strategy.py.
 * Reason codes are checked in this order; the first failing one is reported.
 */
export const REASONS = [
  "warmup",
  "data_gap",
  "session",
  "friday_cutoff",
  "news",
  "one_open",
  "cooldown",
  "bias_none",
  "no_cross",
  "no_pullback",
  "spread",
  "atr_range",
  "signal",
] as const;
export type Reason = (typeof REASONS)[number];

export const REASON_LABELS: Record<Reason, string> = {
  warmup: "Not enough history yet",
  data_gap: "Missing bars",
  session: "Outside London/New York sessions",
  friday_cutoff: "Too close to the weekend",
  news: "High-impact news window",
  one_open: "A signal is already open",
  cooldown: "Cooling down after a loss",
  bias_none: "No clear M15 trend",
  no_cross: "No stochastic cross",
  no_pullback: "No pullback to the EMA zone",
  spread: "Spread too wide",
  atr_range: "Volatility out of range",
  signal: "Signal",
};

export type Direction = 1 | -1;

export interface Plan {
  direction: Direction;
  entryRef: number;
  sl: number;
  tp1: number;
  tp2: number;
  risk: number;
  atr: number;
  spread: number;
}

export interface Context {
  openCount: number;
  cooldownUntil: number;
  /** Sorted UTC seconds of high-impact news events. */
  news: readonly number[];
}

export function newsWithin(news: readonly number[], t: number, windowS: number): boolean {
  // bisect_left for t - windowS
  let lo = 0;
  let hi = news.length;
  const target = t - windowS;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (news[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo < news.length && news[lo]! <= t + windowS;
}

export interface Decision {
  reason: Reason;
  plan: Plan | null;
}

const none = (reason: Reason): Decision => ({ reason, plan: null });

/** Decide at `tClose`, the close time of the last M5 bar. Only closed bars are passed in. */
export function decide(m5: readonly IndBar[], m15: readonly IndBar[], tClose: number, ctx: Context, p: Params): Decision {
  if (m5.length < Math.max(p.warmupM5, 3) || m15.length < p.warmupM15) return none("warmup");

  const n = m5.length;
  const b = m5[n - 1]!;
  const b1 = m5[n - 2]!;
  const b2 = m5[n - 3]!;
  if (b.t - b1.t !== M5 || b1.t - b2.t !== M5) return none("data_gap");
  const h = m15[m15.length - 1]!;
  if (tClose - (h.t + M15) >= M15) return none("data_gap");

  if (!inSessions(tClose, p.sessions)) return none("session");
  if (afterFridayCutoff(tClose, p.fridayCutoffUtc)) return none("friday_cutoff");
  if (p.newsBlackoutMin > 0 && newsWithin(ctx.news, tClose, p.newsBlackoutMin * 60)) return none("news");
  if (ctx.openCount > 0) return none("one_open");
  if (tClose < ctx.cooldownUntil) return none("cooldown");

  let direction: Direction;
  if (h.c > h.emaTrend && h.emaFast > h.emaSlow) direction = 1;
  else if (h.c < h.emaTrend && h.emaFast < h.emaSlow) direction = -1;
  else return none("bias_none");

  const crossed =
    direction === 1
      ? b1.k <= b1.d && b.k > b.d && b1.k < p.stochLow
      : b1.k >= b1.d && b.k < b.d && b1.k > p.stochHigh;
  if (!crossed) return none("no_cross");

  let touched = false;
  for (let j = n - p.pullbackBars; j < n; j++) {
    const x = m5[j]!;
    if (direction === 1 && x.l <= Math.max(x.emaFast, x.emaSlow)) {
      touched = true;
      break;
    }
    if (direction === -1 && x.h >= Math.min(x.emaFast, x.emaSlow)) {
      touched = true;
      break;
    }
  }
  const holds = direction === 1 ? b.c >= Math.min(b.emaFast, b.emaSlow) : b.c <= Math.max(b.emaFast, b.emaSlow);
  if (!(touched && holds)) return none("no_pullback");

  const atr = b.atr;
  const spread = b.spread;
  if (spread > p.maxSpread || spread > p.maxSpreadAtrFrac * atr) return none("spread");
  const atrBps = (atr / b.c) * 10_000.0;
  if (atrBps < p.atrMinBps || atrBps > p.atrMaxBps) return none("atr_range");

  let entry: number;
  let dist: number;
  if (direction === 1) {
    entry = b.c + spread;
    let swingLow = Infinity;
    for (let j = n - p.swingBars; j < n; j++) swingLow = Math.min(swingLow, m5[j]!.l);
    dist = Math.max(p.slAtrMult * atr, entry - (swingLow - p.swingBufferAtr * atr));
  } else {
    entry = b.c;
    let swingHigh = -Infinity;
    for (let j = n - p.swingBars; j < n; j++) swingHigh = Math.max(swingHigh, m5[j]!.h);
    swingHigh = swingHigh + spread;
    dist = Math.max(p.slAtrMult * atr, swingHigh + p.swingBufferAtr * atr - entry);
  }
  if (!(dist > 0 && Number.isFinite(dist))) return none("atr_range");

  return {
    reason: "signal",
    plan: {
      direction,
      entryRef: entry,
      sl: entry - direction * dist,
      tp1: entry + direction * p.tp1R * dist,
      tp2: entry + direction * p.tp2R * dist,
      risk: dist,
      atr,
      spread,
    },
  };
}
