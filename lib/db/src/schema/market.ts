import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Market data. Bar times are UTC epoch seconds (`bigint`, mode number) because every
 * strategy calculation works in seconds; audit columns use timestamptz.
 */

/** Closed M1 bars (bid OHLC) with the spread at bar close. M5/M15 are built from these. */
export const candlesTable = pgTable(
  "candles",
  {
    symbol: text("symbol").notNull(),
    t: bigint("t", { mode: "number" }).notNull(),
    o: doublePrecision("o").notNull(),
    h: doublePrecision("h").notNull(),
    l: doublePrecision("l").notNull(),
    c: doublePrecision("c").notNull(),
    spread: doublePrecision("spread").notNull(),
    volume: doublePrecision("volume").notNull().default(0),
    source: text("source").notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
    revisedAt: timestamp("revised_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.t] })],
);

/** One row per MT5 feeder process; updated on every ingest and heartbeat. */
export const feedersTable = pgTable("feeders", {
  id: text("id").primaryKey(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  lastBarT: bigint("last_bar_t", { mode: "number" }),
  serverUtcOffsetMin: integer("server_utc_offset_min"),
  terminalConnected: boolean("terminal_connected"),
  version: text("version"),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
});

/** High-impact economic calendar events used by the news filter. */
export const newsEventsTable = pgTable(
  "news_events",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    extId: text("ext_id").notNull(),
    currency: text("currency").notNull(),
    title: text("title").notNull(),
    impact: text("impact").notNull(),
    t: bigint("t", { mode: "number" }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("news_events_source_ext_uq").on(t.source, t.extId), index("news_events_t_idx").on(t.t)],
);

export type DbCandle = typeof candlesTable.$inferSelect;
export type DbFeeder = typeof feedersTable.$inferSelect;
export type DbNewsEvent = typeof newsEventsTable.$inferSelect;
