import { describe, expect, it } from "vitest";
import { DEFAULT_ACCOUNT, riskCheck, sizePosition, timeMachine, walk, type ShapeCandle, type TmTrade } from "../src";

describe("position sizing", () => {
  it("sizes to the risk budget and rounds down to the lot step", () => {
    // $1,000 at 1% = $10 budget; $4.50 stop × 100 oz = $450 per lot → 0.0222 → 0.02 lots
    const s = sizePosition(4.5, DEFAULT_ACCOUNT);
    expect(s.lots).toBe(0.02);
    expect(s.riskMoney).toBeCloseTo(9);
    expect(s.minLotOverBudget).toBe(false);
  });
  it("flags when even the minimum lot is too big", () => {
    const s = sizePosition(20, DEFAULT_ACCOUNT); // 0.01 lot risks $20 > $10
    expect(s.lots).toBe(0.01);
    expect(s.minLotOverBudget).toBe(true);
  });
  it("converts an INR account", () => {
    const s = sizePosition(5, { ...DEFAULT_ACCOUNT, balance: 100_000, currency: "INR", usdInr: 84 }); // ₹1,000 budget; ₹42,000 per lot
    expect(s.lots).toBe(0.02);
    expect(s.riskMoney).toBeCloseTo(840);
  });
});

describe("risk check", () => {
  const base = { direction: 1 as const, entry: 100, sl: 99.9, tp2: 100.2, validUntil: 2000, now: 1000, todayResultMoney: 0, approvedToday: 0, openApproved: 0 };
  it("passes a clean trade", () => {
    const r = riskCheck(base, DEFAULT_ACCOUNT);
    expect(r.pass).toBe(true);
    expect(r.checks).toHaveLength(6);
  });
  it("blocks on each limit with a reason", () => {
    const blocked = (x: Partial<typeof base>) => riskCheck({ ...base, ...x }, DEFAULT_ACCOUNT).checks.filter((c) => !c.pass).map((c) => c.id);
    expect(blocked({ todayResultMoney: -25 })).toEqual(["daily_loss"]);
    expect(blocked({ approvedToday: 3 })).toEqual(["trades_per_day"]);
    expect(blocked({ tp2: 100.1 })).toEqual(["reward_risk"]);
    expect(blocked({ now: 2000 })).toEqual(["entry_window"]);
    expect(blocked({ openApproved: 1 })).toEqual(["one_position"]);
  });
});

describe("time machine", () => {
  const trade: TmTrade = { direction: 1, entry: 100, sl: 99, tp1: 101, tp2: 102, tp1Fraction: 0.5 };
  it("manages trades like the live tracker", () => {
    expect(walk(trade, [{ h: 100.5, l: 98.9, c: 99 }]).outcome).toBe("sl");
    expect(walk(trade, [{ h: 102.5, l: 98.5, c: 100 }]).outcome).toBe("sl"); // stop wins ties
    expect(walk(trade, [{ h: 101.2, l: 100.5, c: 101 }, { h: 101.1, l: 99.9, c: 100 }])).toEqual({ outcome: "tp1_be", r: 0.5, tp1Hit: true });
    expect(walk(trade, [{ h: 101.2, l: 100.5, c: 101 }, { h: 102.1, l: 101, c: 102 }]).r).toBeCloseTo(1.5);
    expect(walk(trade, [{ h: 100.4, l: 99.8, c: 100.3 }])).toEqual({ outcome: "time", r: expect.closeTo(0.3, 9), tp1Hit: false });
  });
  it("is repeatable from its seed and sums to 100%", () => {
    const up: ShapeCandle = { dh: 0.006, dl: -0.001, dc: 0.005 };
    const down: ShapeCandle = { dh: 0.001, dl: -0.006, dc: -0.005 };
    const slots = Array.from({ length: 10 }, () => [up, down]);
    const a = timeMachine(trade, slots, [[up, up, up, up, up], [down, down]], 2000, 7);
    const b = timeMachine(trade, slots, [[up, up, up, up, up], [down, down]], 2000, 7);
    expect(a).toEqual(b);
    const total = Object.values(a.simulated).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1);
    expect(a.analog).toEqual({ sl: 1, tp1_be: 0, tp2: 1, time: 0, days: 2 });
  });
});
