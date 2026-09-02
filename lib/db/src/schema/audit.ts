import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Audit log — records admin actions and authentication events.
 *
 * action values:
 *   user.login       — successful login
 *   user.register    — new account created
 *   user.suspend     — admin suspended an account
 *   user.activate    — admin reactivated an account
 *   user.promote     — admin granted admin role
 *   user.demote      — admin removed admin role
 */
export const auditLogsTable = pgTable("audit_logs", {
  id:             serial("id").primaryKey(),
  actorId:        text("actor_id").notNull(),
  actorUsername:  text("actor_username").notNull(),
  action:         text("action").notNull(),
  targetId:       text("target_id"),
  targetUsername: text("target_username"),
  details:        jsonb("details").$type<Record<string, unknown>>(),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

export type DbAuditLog = typeof auditLogsTable.$inferSelect;
