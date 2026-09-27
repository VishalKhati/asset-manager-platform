import { Aggregator, M1, M5, M15, type Bar, type IndBar } from "./bars";
import { Atr, Ema, Stoch } from "./indicators";
import type { Params } from "./params";
import { decide, type Reason } from "./strategy";
import { advance, isOpen, newSignal, type Signal, type SignalEvent } from "./tracker";

/**
 * Bar-by-bar engine core, shared by the TypeScript replay and the live engine.
 * Mirrors research/src/xausig/replay.py. For every M1 bar `b`:
 *   1. close any bucket that ended at or before `b.t`, evaluating each new M5 close;
 *   2. advance every open signal with `b`;
 *   3. add `b` to the buckets;
 *   4. close any bucket that ends at `b.t + 60` and evaluate.
 */

export interface EngineHooks {
  /** A new signal was created at an M5 close. */
  onSignal?(s: Signal): void;
  /** A tracked signal produced events (filled, tp1, outcome). */
  onEvents?(s: Signal, events: SignalEvent[]): void;
  /** Every M5 evaluation, including "no signal" ones. */
  onDecision?(tClose: number, reason: Reason, m5: IndBar, m15: IndBar | undefined): void;
}

export interface EngineOptions {
  news?: readonly number[];
  recordDecisions?: boolean;
  maxBars?: number;
  hooks?: EngineHooks;
  /** First signal id to assign. The live engine uses database ids instead. */
  nextId?: number;
}

export class Engine {
  readonly m5: IndBar[] = [];
  readonly m15: IndBar[] = [];
  open: Signal[] = [];
  readonly closed: Signal[] = [];
  cooldownUntil = 0;
  readonly reasons: Partial<Record<Reason, number>> = {};
  readonly decisions: Array<{ t: number; reason: Reason }> = [];
  /** While true, evaluations never create signals (used to warm indicators from history). */
  silent = false;
  news: readonly number[];
  hooks: EngineHooks;

  private agg5 = new Aggregator(M5);
  private agg15 = new Aggregator(M15);
  private e5f: Ema;
  private e5s: Ema;
  private atr: Atr;
  private stoch: Stoch;
  private e15f: Ema;
  private e15s: Ema;
  private e15t: Ema;
  private nextId: number;
  private m5Count = 0;
  private m15Count = 0;
  private readonly recordDecisions: boolean;
  private readonly maxBars: number;

  constructor(
    readonly p: Params,
    opts: EngineOptions = {},
  ) {
    this.news = [...(opts.news ?? [])].sort((a, b) => a - b);
    this.recordDecisions = opts.recordDecisions ?? false;
    this.maxBars = opts.maxBars ?? 2000;
    this.hooks = opts.hooks ?? {};
    this.nextId = opts.nextId ?? 1;
    this.e5f = new Ema(p.emaFast);
    this.e5s = new Ema(p.emaSlow);
    this.atr = new Atr(p.atrPeriod);
    this.stoch = new Stoch(p.stochK, p.stochSmooth, p.stochD);
    this.e15f = new Ema(p.emaFast);
    this.e15s = new Ema(p.emaSlow);
    this.e15t = new Ema(p.emaTrend);
  }

  /** Time of the last M1 bar the engine has seen, or 0. */
  lastBarT = 0;

  private onM15(b: IndBar): void {
    b.emaFast = this.e15f.update(b.c);
    b.emaSlow = this.e15s.update(b.c);
    b.emaTrend = this.e15t.update(b.c);
    this.m15.push(b);
    this.m15Count += 1;
    if (this.m15.length > this.maxBars) this.m15.splice(0, this.m15.length - this.maxBars);
  }

  private onM5(b: IndBar): void {
    b.emaFast = this.e5f.update(b.c);
    b.emaSlow = this.e5s.update(b.c);
    b.atr = this.atr.update(b.h, b.l, b.c);
    [b.k, b.d] = this.stoch.update(b.h, b.l, b.c);
    this.m5.push(b);
    this.m5Count += 1;
    if (this.m5.length > this.maxBars) this.m5.splice(0, this.m5.length - this.maxBars);
    this.evaluate(b.t + M5);
  }

  private closeBuckets(now: number): void {
    const h = this.agg15.closeIfDone(now);
    if (h) this.onM15(h);
    const b = this.agg5.closeIfDone(now);
    if (b) this.onM5(b);
  }

  private evaluate(tClose: number): void {
    const p = this.p;
    let reason: Reason;
    let plan = null;
    if (this.m5Count < Math.max(p.warmupM5, 3) || this.m15Count < p.warmupM15) {
      reason = "warmup";
    } else {
      const d = decide(this.m5, this.m15, tClose, { openCount: this.open.length, cooldownUntil: this.cooldownUntil, news: this.news }, p);
      reason = d.reason;
      plan = d.plan;
    }
    this.reasons[reason] = (this.reasons[reason] ?? 0) + 1;
    if (this.recordDecisions) this.decisions.push({ t: tClose, reason });
    this.hooks.onDecision?.(tClose, reason, this.m5[this.m5.length - 1]!, this.m15[this.m15.length - 1]);
    if (plan && !this.silent) {
      const s = newSignal(this.nextId, tClose, plan, p);
      this.nextId += 1;
      this.open.push(s);
      this.hooks.onSignal?.(s);
    }
  }

  onM1(b: Bar): void {
    if (b.t <= this.lastBarT) throw new Error(`bars must be strictly increasing: ${b.t} after ${this.lastBarT}`);
    this.lastBarT = b.t;
    this.closeBuckets(b.t);
    if (this.open.length) {
      const stillOpen: Signal[] = [];
      for (const s of this.open) {
        if (b.t >= s.t) {
          const events = advance(s, b, this.p);
          if (events.length) this.hooks.onEvents?.(s, events);
        }
        if (isOpen(s)) {
          stillOpen.push(s);
        } else {
          this.closed.push(s);
          if ((s.outcome === "sl" || s.outcome === "time_exit") && s.rNet < 0) {
            this.cooldownUntil = Math.max(this.cooldownUntil, s.closedT + this.p.cooldownAfterLossMin * 60);
          }
        }
      }
      this.open = stillOpen;
    }
    this.agg15.push(b);
    this.agg5.push(b);
    this.closeBuckets(b.t + M1);
  }

  run(bars: Iterable<Bar>): this {
    for (const b of bars) this.onM1(b);
    return this;
  }

  get signals(): Signal[] {
    return [...this.closed, ...this.open].sort((a, b) => a.id - b.id);
  }
}
