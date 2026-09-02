import { pgTable, uuid, text, boolean, numeric, timestamp, index } from "drizzle-orm/pg-core";

export const priceAlertsTable = pgTable("price_alerts", {
  id:          uuid("id").primaryKey().defaultRandom(),
  userId:      text("user_id").notNull(),
  symbol:      text("symbol").notNull(),
  condition:   text("condition").notNull(), // 'above' | 'below'
  targetPrice: numeric("target_price", { precision: 18, scale: 4 }).notNull(),
  label:       text("label"),
  active:      boolean("active").notNull().default(true),
  triggeredAt: timestamp("triggered_at"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
}, t => [
  index("price_alerts_user_id_idx").on(t.userId),
  index("price_alerts_active_idx").on(t.active),
]);

export type DbPriceAlert = typeof priceAlertsTable.$inferSelect;
