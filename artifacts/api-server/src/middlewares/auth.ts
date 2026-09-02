import { type Request, type Response, type NextFunction } from "express";
import { verifyToken } from "../lib/jwtAuth.js";
import { db }          from "@workspace/db";
import { usersTable }  from "@workspace/db/schema";
import { eq }          from "drizzle-orm";

/**
 * Auth middleware — accepts two credential types:
 *
 *  1. Bearer <BOT_API_TOKEN>  — machine auth (MT5 bridge).
 *     Resolves to userId="_system".
 *
 *  2. Bearer <JWT>            — human user auth (dashboard login).
 *     Resolves to the userId embedded in the token payload.
 *     Also validates that the user account is still active in the DB.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token  = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    res.status(401).json({ ok: false, error: "Unauthorized — missing token." });
    return;
  }

  // ── Machine auth (MT5 bridge / server-to-server) ─────────────────────────
  const machineToken = process.env["BOT_API_TOKEN"] ?? "changeme";
  if (token === machineToken) {
    req.userId   = "_system";
    req.username = "system";
    next();
    return;
  }

  // ── JWT auth (human dashboard users) ─────────────────────────────────────
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ ok: false, error: "Unauthorized — invalid or expired token." });
    return;
  }

  // Verify the account still exists and is active in the DB.
  // This catches suspended accounts that still hold a valid JWT.
  db.select({ id: usersTable.id, active: usersTable.active })
    .from(usersTable)
    .where(eq(usersTable.id, payload.userId))
    .then(([user]) => {
      if (!user) {
        res.status(401).json({ ok: false, error: "Unauthorized — account not found." });
        return;
      }
      if (!user.active) {
        res.status(403).json({ ok: false, error: "Account suspended. Contact an administrator." });
        return;
      }
      req.userId   = payload.userId;
      req.username = payload.username;
      next();
    })
    .catch(() => {
      res.status(500).json({ ok: false, error: "Auth check failed." });
    });
}
