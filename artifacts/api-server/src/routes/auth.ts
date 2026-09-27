/**
 * POST /api/auth/login     — sets the session cookie
 * POST /api/auth/logout    — clears it and revokes every session of the user
 * GET  /api/auth/me        — current user (refreshes the cookie)
 * POST /api/auth/password  — change own password (revokes other sessions)
 * POST /api/auth/register  — only when REGISTRATION_ENABLED=true; creates a viewer
 */

import { Router } from "express";
import { z } from "zod";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { config } from "../config.js";
import { comparePassword, hashPassword, SESSION_COOKIE, sessionCookieOptions, signToken } from "../lib/jwtAuth.js";
import { requireAuth } from "../middlewares/auth.js";
import { validateBody } from "../middlewares/validate.js";
import { writeAudit } from "../lib/audit.js";

const router = Router();

const MAX_FAILED = 10;
// Compared against when the username does not exist, so both paths take the same time.
const DUMMY_HASH = hashPassword("not-a-real-password");
const LOCK_MINUTES = 15;

type UserRow = typeof usersTable.$inferSelect;

function publicUser(u: Pick<UserRow, "id" | "username" | "email" | "role">) {
  return { id: u.id, username: u.username, email: u.email, role: u.role };
}

function issueSession(res: import("express").Response, u: UserRow): void {
  const token = signToken({ userId: u.id, username: u.username, role: u.role, tv: u.tokenVersion });
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

const loginSchema = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(200) });

router.post("/login", validateBody(loginSchema), async (req, res, next) => {
  const { username, password } = req.body as z.infer<typeof loginSchema>;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));
    const now = new Date();
    if (!user || !user.active) {
      // Same work and message as a wrong password, so usernames can't be probed.
      await comparePassword(password, await DUMMY_HASH);
      res.status(401).json({ ok: false, error: "Invalid username or password." });
      return;
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      res.status(429).json({ ok: false, error: "Too many failed attempts. Try again later." });
      return;
    }
    if (!(await comparePassword(password, user.passwordHash))) {
      const failed = user.failedLogins + 1;
      await db
        .update(usersTable)
        .set({
          failedLogins: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : user.lockedUntil,
        })
        .where(eq(usersTable.id, user.id));
      res.status(401).json({ ok: false, error: "Invalid username or password." });
      return;
    }
    await db.update(usersTable).set({ failedLogins: 0, lockedUntil: null, lastSeenAt: now }).where(eq(usersTable.id, user.id));
    writeAudit({ actorId: user.id, actorUsername: user.username, action: "user.login" });
    issueSession(res, user);
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await db
      .update(usersTable)
      .set({ tokenVersion: sql`${usersTable.tokenVersion} + 1` })
      .where(eq(usersTable.id, req.userId));
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId));
    if (!user) {
      res.status(404).json({ ok: false, error: "User not found." });
      return;
    }
    await db.update(usersTable).set({ lastSeenAt: new Date() }).where(eq(usersTable.id, user.id));
    if (req.authVia === "cookie") issueSession(res, user); // sliding session
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

const passwordSchema = z.object({ current: z.string().min(1), next: z.string().min(12).max(200) });

router.post("/password", requireAuth, validateBody(passwordSchema), async (req, res, next) => {
  const body = req.body as z.infer<typeof passwordSchema>;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId));
    if (!user || !(await comparePassword(body.current, user.passwordHash))) {
      res.status(400).json({ ok: false, error: "Current password is wrong." });
      return;
    }
    const [updated] = await db
      .update(usersTable)
      .set({ passwordHash: await hashPassword(body.next), tokenVersion: user.tokenVersion + 1 })
      .where(eq(usersTable.id, user.id))
      .returning();
    writeAudit({ actorId: user.id, actorUsername: user.username, action: "user.password_change" });
    issueSession(res, updated!);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const registerSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/, "Letters, digits, dot, dash and underscore only."),
  email: z.string().trim().email().max(200).optional(),
  password: z.string().min(12).max(200),
});

router.post("/register", async (req, res, next) => {
  if (!config.REGISTRATION_ENABLED) {
    res.status(404).json({ ok: false, error: "Not found." });
    return;
  }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." });
    return;
  }
  const { username, email, password } = parsed.data;
  try {
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, username));
    if (existing) {
      res.status(409).json({ ok: false, error: "Username already taken." });
      return;
    }
    const [user] = await db
      .insert(usersTable)
      .values({ username, email: email ?? null, passwordHash: await hashPassword(password), role: "viewer" })
      .returning();
    writeAudit({ actorId: user!.id, actorUsername: user!.username, action: "user.register" });
    issueSession(res, user!);
    res.status(201).json({ ok: true, user: publicUser(user!) });
  } catch (err) {
    next(err);
  }
});

export default router;
