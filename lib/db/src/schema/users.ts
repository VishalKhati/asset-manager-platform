import { pgTable, text, uuid, timestamp, boolean } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id:           uuid("id").primaryKey().defaultRandom(),
  username:     text("username").notNull().unique(),
  email:        text("email").unique(),
  passwordHash: text("password_hash").notNull(),
  role:         text("role").notNull().default("user"),
  active:       boolean("active").notNull().default(true),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  lastSeenAt:   timestamp("last_seen_at"),
});

export type DbUser = typeof usersTable.$inferSelect;
