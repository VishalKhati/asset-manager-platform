import { pgTable, text, uuid, timestamp, boolean, integer } from "drizzle-orm/pg-core";

/** Operator accounts. Roles: "admin" (full control) and "viewer" (read-only dashboard). */
export const usersTable = pgTable("users", {
  id:           uuid("id").primaryKey().defaultRandom(),
  username:     text("username").notNull().unique(),
  email:        text("email").unique(),
  passwordHash: text("password_hash").notNull(),
  role:         text("role").notNull().default("viewer"),
  active:       boolean("active").notNull().default(true),
  /** Bumped to revoke every session of this user (logout everywhere, suspend, password change). */
  tokenVersion: integer("token_version").notNull().default(0),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil:  timestamp("locked_until", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt:   timestamp("last_seen_at", { withTimezone: true }),
});

export type DbUser = typeof usersTable.$inferSelect;
export const USER_ROLES = ["admin", "viewer"] as const;
