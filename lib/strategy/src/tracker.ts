import type { Bar } from "./bars";
import type { Params } from "./params";
import type { Plan } from "./strategy";
import { fridayExitFor } from "./time";

/**
 * Resolves a signal bar by bar on M1 data with conservative intrabar ordering.
 * Mirrors research/src/xausig/tracker.py.
 *
 * - Longs fill on the ask and exit on the bid; shorts the other way round.
 * - A bar touching both the stop and a target counts as a stop.
 * - After TP1 the stop moves to the fill price; if the TP1 bar also touches it, the rest closes there.
 * - Stop exits pay `slippage`; TP limit exits fill at the level.
 */

export type SignalState = "pending" | "active" | "be" | "closed" | "expired";
export type Outcome = "" | "sl" | "tp1_be" | "tp2" | "time_exit" | "expired";
export type EventType = "created" | "filled" | "tp1" | Exclude<Outcome, "">;

export interface SignalEvent {
  type: EventType;
  t: number;
  price: number;
}

export interface Signal {
  id: number;
  t: number;
  plan: Plan;
  validUntil: number;
  state: SignalState;
  sl: number;
  fill: number;
  fillT: number;
  deadline: number;
  remaining: number;
  realized: Array<[fraction: number, price: number]>;
  outcome: Outcome;
  closedT: number;
  rGross: number;
  rCost: number;
  rNet: number;
  events: SignalEvent[];
}

export const OPEN_STATES: readonly SignalState[] = ["pending", "active", "be"];

export function isOpen(s: Signal): boolean {
  return OPEN_STATES.includes(s.state);
}

export function newSignal(id: number, t: number, plan: Plan, p: Params): Signal {
  return {
    id,
    t,
    plan,
    validUntil: t + p.validMin * 60,
    state: "pending",
    sl: plan.sl,
    fill: 0,
    fillT: 0,
    deadline: 0,
    remaining: 1.0,
    realized: [],
    outcome: "",
    closedT: 0,
    rGross: 0,
    rCost: 0,
    rNet: 0,
    events: [{ type: "created", t, price: plan.entryRef }],
  };
}

function close(s: Signal, outcome: Exclude<Outcome, "">, t: number, p: Params): void {
  s.state = outcome === "expired" ? "expired" : "closed";
  s.outcome = outcome;
  s.closedT = t;
  if (outcome === "expired") {
    s.rGross = 0;
    s.rCost = 0;
    s.rNet = 0;
  } else {
    const d = s.plan.direction;
    let gross = 0.0;
    for (const [fraction, price] of s.realized) gross += fraction * (price - s.fill) * d;
    s.rGross = gross / s.plan.risk;
    s.rCost = p.commission / s.plan.risk;
    s.rNet = s.rGross - s.rCost;
  }
  const last = s.realized[s.realized.length - 1];
  s.events.push({ type: outcome, t, price: last ? last[1] : 0.0 });
}

function exitAll(s: Signal, price: number, outcome: Exclude<Outcome, "" | "expired">, t: number, p: Params): void {
  if (s.remaining > 0) {
    s.realized.push([s.remaining, price]);
    s.remaining = 0.0;
  }
  close(s, outcome, t, p);
}

/** Apply one M1 bar (with `b.t >= s.t`) to an open signal. Mutates `s`; returns the new events. */
export function advance(s: Signal, b: Bar, p: Params): SignalEvent[] {
  const before = s.events.length;
  step(s, b, p);
  return s.events.slice(before);
}

function step(s: Signal, b: Bar, p: Params): void {
  const d = s.plan.direction;
  const spread = b.spread;

  if (s.state === "pending") {
    if (b.t >= s.validUntil) {
      close(s, "expired", b.t, p);
      return;
    }
    const fill = d === 1 ? b.o + spread + p.slippage : b.o - p.slippage;
    if (Math.abs(fill - s.plan.entryRef) > p.entryToleranceR * s.plan.risk) {
      close(s, "expired", b.t, p);
      return;
    }
    s.fill = fill;
    s.fillT = b.t;
    s.state = "active";
    let deadline = b.t + p.maxHoldMin * 60;
    const fridayExit = fridayExitFor(b.t, p.fridayExitUtc);
    if (fridayExit !== null && fridayExit > b.t) deadline = Math.min(deadline, fridayExit);
    s.deadline = deadline;
    s.events.push({ type: "filled", t: b.t, price: fill });
  }

  if (b.t >= s.deadline) {
    exitAll(s, d === 1 ? b.o : b.o + spread, "time_exit", b.t, p);
    return;
  }

  const o = d === 1 ? b.o : b.o + spread;
  const hi = d === 1 ? b.h : b.h + spread;
  const lo = d === 1 ? b.l : b.l + spread;
  const adverseOpen = (level: number) => (d === 1 ? o <= level : o >= level);
  const adverseTouch = (level: number) => (d === 1 ? lo <= level : hi >= level);
  const favorableTouch = (level: number) => (d === 1 ? hi >= level : lo <= level);

  const stopOutcome = s.state === "active" ? "sl" : "tp1_be";
  if (adverseOpen(s.sl)) {
    exitAll(s, o - d * p.slippage, stopOutcome, b.t, p);
    return;
  }
  if (adverseTouch(s.sl)) {
    exitAll(s, s.sl - d * p.slippage, stopOutcome, b.t, p);
    return;
  }

  if (s.state === "active") {
    if (!favorableTouch(s.plan.tp1)) return;
    if (p.tp1Fraction > 0) {
      s.realized.push([p.tp1Fraction, s.plan.tp1]);
      s.remaining = 1.0 - p.tp1Fraction;
    }
    s.state = "be";
    s.sl = s.fill;
    s.events.push({ type: "tp1", t: b.t, price: s.plan.tp1 });
    if (adverseTouch(s.sl)) {
      exitAll(s, s.sl - d * p.slippage, "tp1_be", b.t, p);
      return;
    }
  }

  if (favorableTouch(s.plan.tp2)) exitAll(s, s.plan.tp2, "tp2", b.t, p);
}

/** Plain JSON view, identical in shape to Signal.to_json() in Python. */
export function signalToJson(s: Signal) {
  const p = s.plan;
  return {
    id: s.id,
    t: s.t,
    direction: p.direction === 1 ? "long" : "short",
    entryRef: p.entryRef,
    sl: p.sl,
    tp1: p.tp1,
    tp2: p.tp2,
    risk: p.risk,
    atr: p.atr,
    spread: p.spread,
    fill: s.fill,
    fillT: s.fillT,
    outcome: s.outcome,
    closedT: s.closedT,
    rGross: s.rGross,
    rCost: s.rCost,
    rNet: s.rNet,
    events: s.events.map((e) => ({ type: e.type, t: e.t, price: e.price })),
    state: s.state,
  };
}
