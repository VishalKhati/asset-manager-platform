/**
 * The live engine: runs the shared strategy core (`@workspace/strategy` Engine) on M1 bars
 * from the database and persists every effect.
 *
 * Invariants:
 *  - Each M1 bar is processed in exactly one transaction that also advances
 *    engine_state.last_bar_t. A crash mid-bar rolls back and the bar is replayed.
 *  - Indicators are rebuilt from the last WARMUP_DAYS of candles at start-up, silently.
 *  - Open signals and the cooldown are restored from the database, never recomputed.
 *  - A signal decided more than LATE_SIGNAL_S after its bar closed is stored but never posted.
 */

import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import {
  candlesTable,
  db,
  engineEvaluationsTable,
  engineStateTable,
  notificationOutboxTable,
  priceAlertsTable,
  signalEventsTable,
  signalsTable,
  strategyConfigsTable,
  SIGNAL_OPEN_STATES,
  type DbSignal,
  type DbStrategyConfig,
} from "@workspace/db";
import {
  DEFAULT_PARAMS,
  Engine,
  parseParams,
  STRATEGY_ID,
  STRATEGY_VERSION,
  type Bar,
  type IndBar,
  type Params,
  type Reason,
  type Signal,
  type SignalEvent,
} from "@workspace/strategy";
import type { Logger } from "pino";
import { metrics } from "../lib/metrics.js";

export type Mode = "shadow" | "forward" | "live";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface LiveEngineOptions {
  symbol: string;
  mode: Mode;
  lateSeconds: number;
  warmupDays: number;
  now: () => number;
  log: Logger;
  loadNews: (nowS: number) => Promise<number[]>;
}

interface Decision {
  t: number;
  reason: Reason | "paused";
  close: number;
  diag: Record<string, number | null>;
}

const NOTIFY_EVENTS = new Set(["tp1", "sl", "tp1_be", "tp2", "time_exit", "expired"]);

export function publicNo(symbol: string, id: number): string {
  return `${symbol.slice(0, 3)}-${String(id).padStart(6, "0")}`;
}

const num = (x: number) => (Number.isFinite(x) ? x : null);

export function rowToSignal(r: DbSignal): Signal {
  return {
    id: r.id,
    t: r.t,
    plan: {
      direction: r.direction === "long" ? 1 : -1,
      entryRef: r.entryRef,
      sl: r.sl,
      tp1: r.tp1,
      tp2: r.tp2,
      risk: r.risk,
      atr: r.atr,
      spread: r.spread,
    },
    validUntil: r.validUntil,
    state: r.state as Signal["state"],
    sl: r.slCurrent,
    fill: r.fill ?? 0,
    fillT: r.fillT ?? 0,
    deadline: r.deadline ?? 0,
    remaining: r.remaining,
    realized: r.realized ?? [],
    outcome: (r.outcome ?? "") as Signal["outcome"],
    closedT: r.closedT ?? 0,
    rGross: r.rGross ?? 0,
    rCost: r.rCost ?? 0,
    rNet: r.rNet ?? 0,
    events: [],
  };
}

export async function ensureActiveConfig(symbol: string): Promise<DbStrategyConfig> {
  const [active] = await db
    .select()
    .from(strategyConfigsTable)
    .where(and(eq(strategyConfigsTable.symbol, symbol), eq(strategyConfigsTable.isActive, true)));
  if (active) return active;
  const [created] = await db
    .insert(strategyConfigsTable)
    .values({
      symbol,
      strategyId: STRATEGY_ID,
      strategyVersion: STRATEGY_VERSION,
      params: { ...DEFAULT_PARAMS } as Record<string, unknown>,
      isActive: true,
      note: "Default v1 parameters",
      createdBy: "engine",
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await db
    .select()
    .from(strategyConfigsTable)
    .where(and(eq(strategyConfigsTable.symbol, symbol), eq(strategyConfigsTable.isActive, true)));
  return again!;
}

export class LiveEngine {
  engine!: Engine;
  config!: DbStrategyConfig;
  params!: Params;
  paused = false;
  private warming = false;
  private published = new Map<number, boolean>();
  private newSignals: Signal[] = [];
  private events: Array<{ s: Signal; events: SignalEvent[] }> = [];
  private decisions: Decision[] = [];

  constructor(readonly o: LiveEngineOptions) {}

  get symbol(): string {
    return this.o.symbol;
  }

  async init(): Promise<void> {
    const { symbol } = this.o;
    await db.insert(engineStateTable).values({ symbol }).onConflictDoNothing();
    this.config = await ensureActiveConfig(symbol);
    this.params = parseParams(this.config.params);
    const [state] = await db.select().from(engineStateTable).where(eq(engineStateTable.symbol, symbol));
    this.paused = state!.paused;

    const news = await this.o.loadNews(this.o.now());
    this.engine = new Engine(this.params, {
      news,
      maxBars: 3000,
      hooks: {
        onSignal: (s) => {
          if (!this.warming) this.newSignals.push(s);
        },
        onEvents: (s, events) => {
          if (!this.warming) this.events.push({ s, events });
        },
        onDecision: (t, reason, m5, m15) => {
          if (this.warming) return;
          this.decisions.push({ t, reason: reason === "signal" && this.engine.silent ? "paused" : reason, close: m5.c, diag: diag(m5, m15) });
        },
      },
    });

    // Warm the indicators on history, up to the last bar already processed.
    let until = state!.lastBarT;
    if (!until) {
      const [last] = await db.select({ t: candlesTable.t }).from(candlesTable).where(eq(candlesTable.symbol, symbol)).orderBy(desc(candlesTable.t)).limit(1);
      until = last?.t ?? 0;
    }
    if (until) {
      this.warming = true;
      this.engine.silent = true;
      let from = until - this.o.warmupDays * 86_400;
      for (;;) {
        const chunk = await db
          .select()
          .from(candlesTable)
          .where(and(eq(candlesTable.symbol, symbol), gt(candlesTable.t, from), lte(candlesTable.t, until)))
          .orderBy(asc(candlesTable.t))
          .limit(10_000);
        for (const c of chunk) this.engine.onM1(toBar(c));
        if (chunk.length < 10_000) break;
        from = chunk[chunk.length - 1]!.t;
      }
      this.warming = false;
      this.engine.silent = false;
      this.engine.lastBarT = Math.max(this.engine.lastBarT, until);
      if (!state!.lastBarT) {
        await db.update(engineStateTable).set({ lastBarT: until, updatedAt: new Date() }).where(eq(engineStateTable.symbol, symbol));
      }
    }

    // Restore durable state.
    const open = await db
      .select()
      .from(signalsTable)
      .where(and(eq(signalsTable.symbol, symbol), eq(signalsTable.mode, this.o.mode), inArray(signalsTable.state, [...SIGNAL_OPEN_STATES])));
    this.engine.open = open.map(rowToSignal);
    this.published = new Map(open.map((r) => [r.id, r.published]));
    this.engine.cooldownUntil = state!.cooldownUntil;
    this.o.log.info(
      { symbol, config: this.config.id, lastBarT: this.engine.lastBarT, open: open.length, m5: this.engine.m5.length, m15: this.engine.m15.length },
      "engine initialised",
    );
  }

  /** Reload control flags; returns true if the active config changed (caller re-inits). */
  async refreshControl(): Promise<boolean> {
    const [state] = await db.select().from(engineStateTable).where(eq(engineStateTable.symbol, this.o.symbol));
    this.paused = state?.paused ?? false;
    const [active] = await db
      .select({ id: strategyConfigsTable.id })
      .from(strategyConfigsTable)
      .where(and(eq(strategyConfigsTable.symbol, this.o.symbol), eq(strategyConfigsTable.isActive, true)));
    return Boolean(active && active.id !== this.config.id);
  }

  async refreshNews(): Promise<void> {
    this.engine.news = await this.o.loadNews(this.o.now());
  }

  /** Process every stored bar newer than the cursor. Returns the number of bars processed. */
  async step(maxBars = 2000): Promise<number> {
    const bars = await db
      .select()
      .from(candlesTable)
      .where(and(eq(candlesTable.symbol, this.o.symbol), gt(candlesTable.t, this.engine.lastBarT)))
      .orderBy(asc(candlesTable.t))
      .limit(maxBars);
    for (const c of bars) {
      this.engine.silent = this.paused;
      this.newSignals = [];
      this.events = [];
      this.decisions = [];
      this.engine.onM1(toBar(c));
      await this.persist(toBar(c));
    }
    return bars.length;
  }

  private async persist(bar: Bar): Promise<void> {
    const { symbol, mode } = this.o;
    const nowS = this.o.now();
    const changed: Array<{ signalId: number; type: string }> = [];

    await db.transaction(async (tx) => {
      for (const s of this.newSignals) {
        const published = mode !== "shadow" && nowS - s.t <= this.o.lateSeconds;
        const [row] = await tx
          .insert(signalsTable)
          .values({
            publicNo: `pending-${symbol}-${mode}-${s.t}`,
            symbol,
            strategyId: this.config.strategyId,
            strategyVersion: this.config.strategyVersion,
            configId: this.config.id,
            mode,
            published,
            direction: s.plan.direction === 1 ? "long" : "short",
            t: s.t,
            entryRef: s.plan.entryRef,
            sl: s.plan.sl,
            tp1: s.plan.tp1,
            tp2: s.plan.tp2,
            risk: s.plan.risk,
            atr: s.plan.atr,
            spread: s.plan.spread,
            validUntil: s.validUntil,
            state: s.state,
            slCurrent: s.sl,
          })
          .returning({ id: signalsTable.id });
        s.id = row!.id;
        await tx.update(signalsTable).set({ publicNo: publicNo(symbol, s.id) }).where(eq(signalsTable.id, s.id));
        await tx.insert(signalEventsTable).values({ signalId: s.id, type: "created", t: s.t, price: s.plan.entryRef });
        this.published.set(s.id, published);
        if (published) await tx.insert(notificationOutboxTable).values({ kind: "signal_new", signalId: s.id, payload: {} });
        changed.push({ signalId: s.id, type: "created" });
        metrics.signals.inc({ event: published ? "created" : "created_unpublished" });
      }

      for (const { s, events } of this.events) {
        const rows = events.filter((e) => e.type !== "created");
        if (!rows.length) continue;
        await tx.insert(signalEventsTable).values(rows.map((e) => ({ signalId: s.id, type: e.type, t: e.t, price: e.price })));
        await tx
          .update(signalsTable)
          .set({
            state: s.state,
            slCurrent: s.sl,
            fill: s.fillT ? s.fill : null,
            fillT: s.fillT || null,
            deadline: s.deadline || null,
            remaining: s.remaining,
            realized: s.realized,
            outcome: s.outcome || null,
            closedT: s.closedT || null,
            rGross: s.outcome ? s.rGross : null,
            rCost: s.outcome ? s.rCost : null,
            rNet: s.outcome ? s.rNet : null,
            updatedAt: new Date(),
          })
          .where(eq(signalsTable.id, s.id));
        for (const e of rows) {
          changed.push({ signalId: s.id, type: e.type });
          metrics.signals.inc({ event: e.type });
          if (this.published.get(s.id) && NOTIFY_EVENTS.has(e.type)) {
            await tx.insert(notificationOutboxTable).values({ kind: "signal_update", signalId: s.id, payload: { event: e.type, t: e.t, price: e.price } });
          }
        }
      }

      for (const d of this.decisions) {
        metrics.engineDecisions.inc({ reason: d.reason });
        await tx
          .insert(engineEvaluationsTable)
          .values({ symbol, t: d.t, reason: d.reason, close: d.close, diag: d.diag })
          .onConflictDoUpdate({
            target: [engineEvaluationsTable.symbol, engineEvaluationsTable.t],
            set: { reason: d.reason, close: d.close, diag: d.diag },
          });
      }

      await checkPriceAlerts(tx, symbol, bar);

      await tx
        .update(engineStateTable)
        .set({ lastBarT: bar.t, cooldownUntil: this.engine.cooldownUntil, heartbeatAt: new Date(), updatedAt: new Date() })
        .where(eq(engineStateTable.symbol, symbol));
      for (const c of changed) await tx.execute(sql`select pg_notify('signal_event', ${JSON.stringify(c)})`);
    });
  }
}

function toBar(c: { t: number; o: number; h: number; l: number; c: number; spread: number }): Bar {
  return { t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, spread: c.spread };
}

function diag(m5: IndBar, m15: IndBar | undefined): Record<string, number | null> {
  return {
    k: num(m5.k),
    d: num(m5.d),
    atr: num(m5.atr),
    emaFast: num(m5.emaFast),
    emaSlow: num(m5.emaSlow),
    spread: num(m5.spread),
    m15Close: m15 ? num(m15.c) : null,
    m15EmaTrend: m15 ? num(m15.emaTrend) : null,
    m15EmaFast: m15 ? num(m15.emaFast) : null,
    m15EmaSlow: m15 ? num(m15.emaSlow) : null,
  };
}

/** Price alerts are checked against each bar's full range, so a spike between polls is not missed. */
async function checkPriceAlerts(tx: Tx, symbol: string, bar: Bar): Promise<void> {
  const fired = await tx
    .update(priceAlertsTable)
    .set({ active: false, triggeredAt: new Date() })
    .where(
      and(
        eq(priceAlertsTable.active, true),
        eq(priceAlertsTable.symbol, symbol),
        sql`((${priceAlertsTable.condition} = 'above' and ${bar.h} >= ${priceAlertsTable.targetPrice}) or (${priceAlertsTable.condition} = 'below' and ${bar.l} <= ${priceAlertsTable.targetPrice}))`,
      ),
    )
    .returning();
  for (const a of fired) {
    await tx.insert(notificationOutboxTable).values({
      kind: "admin",
      payload: {
        text: `🔔 Price alert: ${symbol} ${a.condition === "above" ? "rose above" : "fell below"} ${Number(a.targetPrice).toFixed(2)}${a.label ? ` (${a.label})` : ""}.`,
      },
    });
  }
}
