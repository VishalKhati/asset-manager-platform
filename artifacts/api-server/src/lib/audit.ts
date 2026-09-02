/**
 * Audit log helper — fire-and-forget writes to the audit_logs table.
 * Failures are logged but never thrown, so they never break a request.
 */

import { db }            from "@workspace/db";
import { auditLogsTable } from "@workspace/db/schema";
import { logger }        from "./logger.js";

export type AuditAction =
  | "user.login"
  | "user.register"
  | "user.suspend"
  | "user.activate"
  | "user.promote"
  | "user.demote";

export interface AuditParams {
  actorId:        string;
  actorUsername:  string;
  action:         AuditAction;
  targetId?:      string;
  targetUsername?: string;
  details?:       Record<string, unknown>;
}

export function writeAudit(params: AuditParams): void {
  db.insert(auditLogsTable)
    .values({
      actorId:        params.actorId,
      actorUsername:  params.actorUsername,
      action:         params.action,
      targetId:       params.targetId       ?? null,
      targetUsername: params.targetUsername ?? null,
      details:        params.details        ?? null,
    })
    .catch((err) => logger.error({ err, params }, "Failed to write audit log"));
}
