/**
 * Auth routes — public endpoints for register/login + protected /me.
 */

import { Router }   from "express";
import { db }       from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq }       from "drizzle-orm";
import { signToken, hashPassword, comparePassword } from "../lib/jwtAuth.js";
import { requireAuth }  from "../middlewares/auth.js";
import { writeAudit }   from "../lib/audit.js";
import { notifyUser }   from "../lib/notificationService.js";

const router = Router();

// ─── POST /api/auth/register ─────────────────────────────────────────────────

router.post("/register", async (req, res) => {
  const { username, email, password } = req.body ?? {};

  if (!username || typeof username !== "string" || username.trim().length < 3) {
    res.status(400).json({ ok: false, error: "Username must be at least 3 characters." });
    return;
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    res.status(400).json({ ok: false, error: "Password must be at least 8 characters." });
    return;
  }

  try {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, username.trim()));

    if (existing) {
      res.status(409).json({ ok: false, error: "Username already taken." });
      return;
    }

    // First registered user automatically becomes admin
    const [anyUser] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
    const role = anyUser ? "user" : "admin";

    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(usersTable)
      .values({ username: username.trim(), email: email ?? null, passwordHash, role })
      .returning();

    writeAudit({
      actorId:       user!.id,
      actorUsername: user!.username,
      action:        "user.register",
      targetId:      user!.id,
      targetUsername: user!.username,
      details:       { role },
    });

    const token = signToken({ userId: user!.id, username: user!.username });
    res.status(201).json({
      ok:    true,
      token,
      user:  { id: user!.id, username: user!.username, email: user!.email, role: user!.role },
    });
  } catch {
    res.status(500).json({ ok: false, error: "Registration failed. Please try again." });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

router.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};

  if (!username || !password) {
    res.status(400).json({ ok: false, error: "username and password are required." });
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.username, String(username).trim()));

    if (!user || !user.active) {
      res.status(401).json({ ok: false, error: "Invalid credentials." });
      return;
    }

    const valid = await comparePassword(String(password), user.passwordHash);
    if (!valid) {
      res.status(401).json({ ok: false, error: "Invalid credentials." });
      return;
    }

    // Update last seen + write audit (fire-and-forget)
    db.update(usersTable)
      .set({ lastSeenAt: new Date() })
      .where(eq(usersTable.id, user.id))
      .catch(() => { /* ignore */ });

    writeAudit({
      actorId:       user.id,
      actorUsername: user.username,
      action:        "user.login",
    });

    notifyUser(user.id, "user.login", { username: user.username }).catch(() => {});

    const token = signToken({ userId: user.id, username: user.username });
    res.json({
      ok:    true,
      token,
      user:  { id: user.id, username: user.username, email: user.email, role: user.role },
    });
  } catch {
    res.status(500).json({ ok: false, error: "Login failed. Please try again." });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

router.get("/me", requireAuth, async (req, res) => {
  if (req.userId === "_system") {
    res.json({ ok: true, user: { id: "_system", username: "system", role: "machine" } });
    return;
  }
  try {
    const [user] = await db
      .select({ id: usersTable.id, username: usersTable.username, email: usersTable.email, role: usersTable.role, active: usersTable.active })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId));

    if (!user) { res.status(404).json({ ok: false, error: "User not found." }); return; }

    // Update last seen (fire-and-forget)
    db.update(usersTable)
      .set({ lastSeenAt: new Date() })
      .where(eq(usersTable.id, req.userId))
      .catch(() => { /* ignore */ });

    res.json({ ok: true, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to fetch user." });
  }
});

export default router;
