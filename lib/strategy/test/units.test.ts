import { describe, expect, it } from "vitest";
import {
  advance,
  afterFridayCutoff,
  Atr,
  DEFAULT_PARAMS,
  Ema,
  inSessions,
  isOpen,
  newSignal,
  newsWithin,
  parseParams,
  Stoch,
  summarize,
  utcWeekday,
  type Bar,
  type Plan,
} from "../src";

const ts = (s: string) => Date.parse(s + "Z") / 1000;

describe("indicators (same cases as research/tests/test_indicators.py)", () => {
  it("EMA seeds with SMA then recurses", () => {
    const e = new Ema(3);
    expect(e.update(1)).toBeNaN();
    expect(e.update(2)).toBeNaN();
    expect(e.update(3)).toBe(2);
    expect(e.update(5)).toBe(3.5);
    expect(e.update(1)).toBe(2.25);
  });

  it("ATR uses Wilder smoothing", () => {
    const a = new Atr(2);
    expect(a.update(10, 8, 9)).toBeNaN();
    expect(a.update(11, 10, 10.5)).toBe(2);
    expect(a.update(12, 9, 11)).toBe(2.5);
  });

  it("stochastic %K and %D", () => {
    const s = new Stoch(2, 2, 2);
    s.update(10, 8, 9);
    expect(s.update(12, 9, 11)[0]).toBeNaN();
    const [k1, d1] = s.update(12, 10, 12);
    expect(k1).toBe(87.5);
    expect(d1).toBeNaN();
    expect(s.update(11, 10, 10)).toEqual([50, 68.75]);
  });
});

describe("time", () => {
  const P = DEFAULT_PARAMS;
  it("follows UK and US daylight saving time", () => {
    expect(inSessions(ts("2024-01-10T06:55:00"), P.sessions)).toBe(false);
    expect(inSessions(ts("2024-01-10T07:00:00"), P.sessions)).toBe(true);
    expect(inSessions(ts("2024-07-10T06:00:00"), P.sessions)).toBe(true);
    expect(inSessions(ts("2024-03-12T19:55:00"), P.sessions)).toBe(true);
    expect(inSessions(ts("2024-03-12T20:00:00"), P.sessions)).toBe(false);
    expect(inSessions(ts("2024-03-09T12:00:00"), P.sessions)).toBe(false);
  });
  it("knows Fridays", () => {
    expect(utcWeekday(ts("2024-03-08T12:00:00"))).toBe(4);
    expect(afterFridayCutoff(ts("2024-03-08T20:00:00"), "20:00")).toBe(true);
    expect(afterFridayCutoff(ts("2024-03-08T19:55:00"), "20:00")).toBe(false);
  });
  it("finds news in a window", () => {
    const news = [1000, 5000];
    expect(newsWithin(news, 1900, 900)).toBe(true);
    expect(newsWithin(news, 1901, 900)).toBe(false);
    expect(newsWithin(news, 4100, 900)).toBe(true);
    expect(newsWithin([], 4100, 900)).toBe(false);
  });
});

describe("tracker (same cases as research/tests/test_tracker.py)", () => {
  const P = parseParams({ commission: 0, slippage: 0 });
  const T0 = 1_709_550_000;
  const longPlan = (entry = 100, risk = 1): Plan => ({ direction: 1, entryRef: entry, sl: entry - risk, tp1: entry + risk, tp2: entry + 2 * risk, risk, atr: 0.66, spread: 0 });
  const shortPlan = (entry = 100, risk = 1): Plan => ({ direction: -1, entryRef: entry, sl: entry + risk, tp1: entry - risk, tp2: entry - 2 * risk, risk, atr: 0.66, spread: 0 });
  const bar = (i: number, o: number, h: number, l: number, c: number, spread = 0): Bar => ({ t: T0 + 60 * i, o, h, l, c, spread });
  const run = (plan: Plan, bars: Bar[], p = P) => {
    const s = newSignal(1, T0, plan, p);
    for (const b of bars) {
      advance(s, b, p);
      if (!isOpen(s)) break;
    }
    return s;
  };

  it("TP2 with a 50% partial at TP1", () => {
    const s = run(longPlan(), [bar(0, 100, 100.5, 99.8, 100.2), bar(1, 100.2, 101.2, 100.1, 101), bar(2, 101, 102.1, 100.9, 102)]);
    expect(s.outcome).toBe("tp2");
    expect(s.rNet).toBeCloseTo(1.5);
  });
  it("stop wins when a bar touches both", () => {
    const s = run(longPlan(), [bar(0, 100, 102.5, 98.9, 100)]);
    expect([s.outcome, s.rNet]).toEqual(["sl", -1]);
  });
  it("gaps through the stop fill at the open", () => {
    const s = run(longPlan(), [bar(0, 100, 100.2, 99.9, 100), bar(1, 98.5, 98.7, 98.2, 98.4)]);
    expect(s.rNet).toBeCloseTo(-1.5);
  });
  it("shorts exit on the ask", () => {
    const s = run(shortPlan(), [bar(0, 100, 100.1, 99.5, 99.9, 0.2), bar(1, 99.9, 100.85, 99.8, 100.5, 0.2)]);
    expect(s.outcome).toBe("sl");
  });
  it("expires when price ran away", () => {
    expect(run(longPlan(), [bar(0, 100.4, 100.5, 100.3, 100.4)]).outcome).toBe("expired");
  });
  it("time exit", () => {
    const s = run(longPlan(), [bar(0, 100, 100.2, 99.9, 100.1), bar(1, 100.1, 100.3, 100, 100.2), bar(2, 100.3, 100.4, 100.2, 100.3)], parseParams({ commission: 0, slippage: 0, maxHoldMin: 2 }));
    expect(s.outcome).toBe("time_exit");
    expect(s.rNet).toBeCloseTo(0.3);
  });
});

describe("params and stats", () => {
  it("rejects bad params", () => {
    expect(() => parseParams({ emaFast: 60, emaSlow: 50 })).toThrow();
    expect(() => parseParams({ unknownKey: 1 })).toThrow();
  });
  it("summarizes R", () => {
    const s = summarize([1.5, -1, -1, 0.5, 1.5]);
    expect(s.trades).toBe(5);
    expect(s.profitFactor).toBe(3.5 / 2);
    expect(s.maxDrawdownR).toBe(2);
    expect(s.longestLosingStreak).toBe(2);
  });
});
