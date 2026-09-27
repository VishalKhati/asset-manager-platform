import type { NextFunction, Request, Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { SESSION_COOKIE, verifyToken } from "../lib/jwtAuth.js";

/**
 * Session auth. The dashboard sends an httpOnly cookie; scripts may send `Authorization: Bearer`.
 * Every request re-checks the account in the database, so suspending a user or bumping
 * their token version takes effect immediately.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const cookie = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE] ?? "";
  const token = bearer || cookie;
  if (!token) {
    res.status(401).json({ ok: false, error: "Not signed in." });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ ok: false, error: "Session expired. Sign in again." });
    return;
  }
  try {
    const [user] = await db
      .select({ id: usersTable.id, username: usersTable.username, role: usersTable.role, active: usersTable.active, tokenVersion: usersTable.tokenVersion })
      .from(usersTable)
      .where(eq(usersTable.id, payload.userId));
    if (!user || user.tokenVersion !== payload.tv) {
      res.status(401).json({ ok: false, error: "Session expired. Sign in again." });
      return;
    }
    if (!user.active) {
      res.status(403).json({ ok: false, error: "Account suspended." });
      return;
    }
    req.userId = user.id;
    req.username = user.username;
    req.role = user.role;
    req.authVia = bearer ? "bearer" : "cookie";
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(role: "admin") {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.role !== role) {
      res.status(403).json({ ok: false, error: "Admin access required." });
      return;
    }
    next();
  };
}

export const requireAdmin = [requireAuth, requireRole("admin")];

/**
 * CSRF guard for cookie sessions: state-changing requests must carry `X-Requested-With`,
 * which a cross-site form cannot set. Combined with SameSite=Strict cookies.
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  const safe = req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";
  const hasCookie = Boolean((req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE]);
  if (!safe && hasCookie && !req.headers.authorization && !req.headers["x-requested-with"]) {
    res.status(403).json({ ok: false, error: "Missing X-Requested-With header." });
    return;
  }
  next();
}
