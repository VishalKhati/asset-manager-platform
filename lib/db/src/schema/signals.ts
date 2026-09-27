import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Signals and their append-only event log. Market times are UTC epoch seconds.
 * The database itself enforces two rules:
 *  - one signal per (strategy, symbol, mode, decision bar), so a restart can't post twice;
 *  - at most one open signal per (symbol, mode).
 */

/** Versioned strategy parameters. Rows are never edited; a change inserts a new active row. */
export const strategyConfigsTable = pgTable(
  "strategy_configs",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    strategyId: text("strategy_id").notNull(),
    strategyVersion: integer("strategy_version").notNull(),
    params: jsonb("params").notNull().$type<Record<string, unknown>>(),
    isActive: boolean("is_active").notNull().default(false),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("strategy_configs_one_active_uq").on(t.symbol).where(sql`${t.isActive}`)],
);

export const SIGNAL_OPEN_STATES = ["pending", "active", "be"] as const;

export const signalsTable = pgTable(
  "signals",
  {
    id: serial("id").primaryKey(),
    publicNo: text("public_no").notNull().unique(),
    symbol: text("symbol").notNull(),
    strategyId: text("strategy_id").notNull(),
    strategyVersion: integer("strategy_version").notNull(),
    configId: integer("config_id")
      .notNull()
      .references(() => strategyConfigsTable.id),
    /** shadow = never published; forward = private demo channel; live = public channel */
    mode: text("mode").notNull(),
    published: boolean("published").notNull().default(true),
    direction: text("direction").notNull(),
    /** Decision time: close of the trigger M5 bar. */
    t: bigint("t", { mode: "number" }).notNull(),
    entryRef: doublePrecision("entry_ref").notNull(),
    sl: doublePrecision("sl").notNull(),
    tp1: doublePrecision("tp1").notNull(),
    tp2: doublePrecision("tp2").notNull(),
    risk: doublePrecision("risk").notNull(),
    atr: doublePrecision("atr").notNull(),
    spread: doublePrecision("spread").notNull(),
    validUntil: bigint("valid_until", { mode: "number" }).notNull(),
    state: text("state").notNull(),
    slCurrent: doublePrecision("sl_current").notNull(),
    fill: doublePrecision("fill"),
    fillT: bigint("fill_t", { mode: "number" }),
    deadline: bigint("deadline", { mode: "number" }),
    remaining: doublePrecision("remaining").notNull().default(1),
    realized: jsonb("realized").notNull().$type<Array<[number, number]>>().default([]),
    outcome: text("outcome"),
    closedT: bigint("closed_t", { mode: "number" }),
    rGross: doublePrecision("r_gross"),
    rCost: doublePrecision("r_cost"),
    rNet: doublePrecision("r_net"),
    /** chat id → Telegram message id, so outcome updates can edit the original post. */
    telegramMessages: jsonb("telegram_messages").notNull().$type<Record<string, number>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("signals_bar_uq").on(t.strategyId, t.symbol, t.mode, t.t),
    uniqueIndex("signals_one_open_uq")
      .on(t.symbol, t.mode)
      .where(sql`${t.state} in ('pending', 'active', 'be')`),
    index("signals_symbol_t_idx").on(t.symbol, t.t),
  ],
);

export const signalEventsTable = pgTable(
  "signal_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    signalId: integer("signal_id")
      .notNull()
      .references(() => signalsTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    t: bigint("t", { mode: "number" }).notNull(),
    price: doublePrecision("price").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("signal_events_signal_idx").on(t.signalId)],
);

/** Why each M5 close did or did not produce a signal. Kept for 90 days. */
export const engineEvaluationsTable = pgTable(
  "engine_evaluations",
  {
    symbol: text("symbol").notNull(),
    t: bigint("t", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    close: doublePrecision("close"),
    diag: jsonb("diag").$type<Record<string, number | null>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("engine_evaluations_pk").on(t.symbol, t.t)],
);

/** Durable engine state per symbol: survives restarts. */
export const engineStateTable = pgTable("engine_state", {
  symbol: text("symbol").primaryKey(),
  paused: boolean("paused").notNull().default(false),
  pausedReason: text("paused_reason"),
  pausedBy: text("paused_by"),
  cooldownUntil: bigint("cooldown_until", { mode: "number" }).notNull().default(0),
  lastBarT: bigint("last_bar_t", { mode: "number" }).notNull().default(0),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  feedAlertOpen: boolean("feed_alert_open").notNull().default(false),
  newsFetchedAt: timestamp("news_fetched_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Messages waiting to be delivered to Telegram. Retries survive restarts. */
export const notificationOutboxTable = pgTable(
  "notification_outbox",
  {
    id: serial("id").primaryKey(),
    /** signal_new | signal_update | admin */
    kind: text("kind").notNull(),
    signalId: integer("signal_id").references(() => signalsTable.id, { onDelete: "cascade" }),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("notification_outbox_due_idx").on(t.status, t.nextAttemptAt)],
);

/** Backtest and walk-forward reports uploaded from research/. */
export const backtestRunsTable = pgTable("backtest_runs", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  strategyId: text("strategy_id").notNull(),
  strategyVersion: integer("strategy_version").notNull(),
  summary: jsonb("summary").notNull().$type<Record<string, unknown>>(),
  report: jsonb("report").notNull().$type<Record<string, unknown>>(),
  isPublic: boolean("is_public").notNull().default(false),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DbStrategyConfig = typeof strategyConfigsTable.$inferSelect;
export type DbSignal = typeof signalsTable.$inferSelect;
export type DbSignalEvent = typeof signalEventsTable.$inferSelect;
export type DbEngineState = typeof engineStateTable.$inferSelect;
export type DbOutbox = typeof notificationOutboxTable.$inferSelect;
export type DbBacktestRun = typeof backtestRunsTable.$inferSelect;
