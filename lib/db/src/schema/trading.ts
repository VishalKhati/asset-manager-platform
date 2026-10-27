import { bigint, boolean, doublePrecision, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { signalsTable } from "./signals";

/** Operator account settings used for position sizing and the pre-trade risk check (one row). */
export const accountSettingsTable = pgTable("account_settings", {
  id: integer("id").primaryKey().default(1),
  settings: jsonb("settings").notNull().$type<Record<string, unknown>>(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A signal the operator approved by typing YES, with the exact order, size and the risk
 * check that passed. MT5 execution is not built yet, so `sentToBroker` stays false: the
 * order is placed by hand. Phase 10's executor will consume approved tickets.
 */
export const tradeTicketsTable = pgTable(
  "trade_tickets",
  {
    id: serial("id").primaryKey(),
    signalId: integer("signal_id")
      .notNull()
      .references(() => signalsTable.id, { onDelete: "cascade" }),
    status: text("status").notNull(), // approved | cancelled
    direction: text("direction").notNull(),
    lots: doublePrecision("lots").notNull(),
    entry: doublePrecision("entry").notNull(),
    sl: doublePrecision("sl").notNull(),
    tp1: doublePrecision("tp1").notNull(),
    tp2: doublePrecision("tp2").notNull(),
    riskMoney: doublePrecision("risk_money").notNull(),
    currency: text("currency").notNull(),
    checks: jsonb("checks").notNull().$type<Record<string, unknown>[]>(),
    odds: jsonb("odds").$type<Record<string, unknown>>(),
    sentToBroker: boolean("sent_to_broker").notNull().default(false),
    approvedBy: text("approved_by").notNull(),
    via: text("via").notNull(), // dashboard | telegram
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
    approvedT: bigint("approved_t", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("trade_tickets_one_per_signal").on(t.signalId), index("trade_tickets_approved_t_idx").on(t.approvedT)],
);

export type DbTradeTicket = typeof tradeTicketsTable.$inferSelect;
