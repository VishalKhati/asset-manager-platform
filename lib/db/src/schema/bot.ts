import {
  pgTable,
  text,
  uuid,
  boolean,
  timestamp,
  jsonb,
  doublePrecision,
  integer,
  serial,
  primaryKey,
} from "drizzle-orm/pg-core";

// ─── Trades ───────────────────────────────────────────────────────────────────

export const botTradesTable = pgTable("bot_trades", {
  id:         uuid("id").primaryKey(),
  userId:     text("user_id").notNull().default("_system"),
  symbol:     text("symbol").notNull(),
  direction:  text("direction").notNull(),
  entry:      doublePrecision("entry").notNull(),
  sl:         doublePrecision("sl").notNull(),
  tp:         doublePrecision("tp").notNull(),
  lots:       doublePrecision("lots").notNull(),
  slPips:     doublePrecision("sl_pips").notNull(),
  tpPips:     doublePrecision("tp_pips").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  strategies: jsonb("strategies").notNull().$type<string[]>(),
  openedAt:   text("opened_at").notNull(),
  closedAt:   text("closed_at"),
  pnl:        doublePrecision("pnl"),
  status:     text("status").notNull(),
  reason:     text("reason"),
});

export type DbTrade       = typeof botTradesTable.$inferSelect;
export type DbTradeInsert = typeof botTradesTable.$inferInsert;

// ─── Logs ─────────────────────────────────────────────────────────────────────

export const botLogsTable = pgTable("bot_logs", {
  id:      serial("id").primaryKey(),
  userId:  text("user_id").notNull().default("_system"),
  symbol:  text("symbol").notNull(),
  level:   text("level").notNull(),
  message: text("message").notNull(),
  ts:      text("ts").notNull(),
  meta:    jsonb("meta"),
});

export type DbLog = typeof botLogsTable.$inferSelect;

// ─── Config (composite PK: user_id + symbol) ──────────────────────────────────

export const botConfigTable = pgTable("bot_config", {
  userId:    text("user_id").notNull(),
  symbol:    text("symbol").notNull(),
  config:    jsonb("config").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.symbol] })]);

// ─── Bot status (composite PK: user_id + symbol) ──────────────────────────────

export const botStatusTable = pgTable("bot_status", {
  userId:        text("user_id").notNull(),
  symbol:        text("symbol").notNull(),
  running:       boolean("running").notNull().default(false),
  startedAt:     text("started_at"),
  stoppedAt:     text("stopped_at"),
  tradesToday:   integer("trades_today").notNull().default(0),
  lastResetDate: text("last_reset_date").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.symbol] })]);

// ─── Webhooks ─────────────────────────────────────────────────────────────────

export const botWebhooksTable = pgTable("bot_webhooks", {
  id:        uuid("id").primaryKey(),
  userId:    text("user_id"),
  url:       text("url").notNull(),
  events:    jsonb("events").notNull().$type<string[]>(),
  name:      text("name").notNull(),
  secret:    text("secret"),
  active:    boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DbWebhook = typeof botWebhooksTable.$inferSelect;
