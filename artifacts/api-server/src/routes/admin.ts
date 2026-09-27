/**
 * User administration (admin role only).
 *
 * GET   /api/admin/users        all accounts
 * POST  /api/admin/users        create an account { username, password, role }
 * PATCH /api/admin/users/:id    { role?, active? } — revokes the user's sessions
 * GET   /api/admin/audit        recent audit log (?limit=)
 * GET   /api/admin/system       process and database health
 */

import { Router } from "express";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { auditLogsTable, db, USER_ROLES, usersTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/auth.js";
import { parseQuery, validateBody } from "../middlewares/validate.js";
import { hashPassword } from "../lib/jwtAuth.js";
import { writeAudit } from "../lib/audit.js";

const router = Router();
router.use(...requireAdmin);

const userColumns = {
  id: usersTable.id,
  username: usersTable.username,
  email: usersTable.email,
  role: usersTable.role,
  active: usersTable.active,
  createdAt: usersTable.createdAt,
  lastSeenAt: usersTable.lastSeenAt,
};

router.get("/users", async (_req, res, next) => {
  try {
    res.json({ ok: true, users: await db.select(userColumns).from(usersTable).orderBy(usersTable.createdAt) });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
  email: z.string().trim().email().optional(),
  password: z.string().min(12).max(200),
  role: z.enum(USER_ROLES).default("viewer"),
});

router.post("/users", validateBody(createSchema), async (req, res, next) => {
  const body = req.body as z.infer<typeof createSchema>;
  try {
    const [exists] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, body.username));
    if (exists) {
      res.status(409).json({ ok: false, error: "Username already taken." });
      return;
    }
    const [user] = await db
      .insert(usersTable)
      .values({ username: body.username, email: body.email ?? null, passwordHash: await hashPassword(body.password), role: body.role })
      .returning(userColumns);
    writeAudit({ actorId: req.userId, actorUsername: req.username, action: "user.create", targetId: user!.id, targetUsername: user!.username, details: { role: body.role } });
    res.status(201).json({ ok: true, user });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({ role: z.enum(USER_ROLES).optional(), active: z.boolean().optional() }).refine((b) => b.role !== undefined || b.active !== undefined, "Nothing to update.");

router.patch("/users/:id", validateBody(patchSchema), async (req, res, next) => {
  const id = String(req.params["id"]);
  const body = req.body as z.infer<typeof patchSchema>;
  if (id === req.userId && (body.active === false || (body.role && body.role !== "admin"))) {
    res.status(400).json({ ok: false, error: "You cannot suspend or demote yourself." });
    return;
  }
  try {
    const [current] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!current) {
      res.status(404).json({ ok: false, error: "User not found." });
      return;
    }
    const [updated] = await db
      .update(usersTable)
      .set({ ...body, tokenVersion: sql`${usersTable.tokenVersion} + 1` })
      .where(eq(usersTable.id, id))
      .returning(userColumns);
    if (body.active !== undefined && body.active !== current.active) {
      writeAudit({ actorId: req.userId, actorUsername: req.username, action: body.active ? "user.activate" : "user.suspend", targetId: id, targetUsername: current.username });
    }
    if (body.role && body.role !== current.role) {
      writeAudit({ actorId: req.userId, actorUsername: req.username, action: body.role === "admin" ? "user.promote" : "user.demote", targetId: id, targetUsername: current.username, details: { from: current.role, to: body.role } });
    }
    res.json({ ok: true, user: updated });
  } catch (err) {
    next(err);
  }
});

const auditQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

router.get("/audit", async (req, res, next) => {
  const q = parseQuery(auditQuery, req, res);
  if (!q) return;
  try {
    res.json({ ok: true, logs: await db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.createdAt)).limit(q.limit) });
  } catch (err) {
    next(err);
  }
});

router.get("/system", async (_req, res) => {
  const mem = process.memoryUsage();
  const mb = (b: number) => Math.round(b / 1024 / 1024);
  let dbLatencyMs = -1;
  try {
    const t0 = Date.now();
    await db.execute(sql`select 1`);
    dbLatencyMs = Date.now() - t0;
  } catch {
    /* reported as -1 */
  }
  res.json({ ok: true, uptime: Math.floor(process.uptime()), node: process.version, memory: { heapUsedMb: mb(mem.heapUsed), rssMb: mb(mem.rss) }, db: { latencyMs: dbLatencyMs } });
});

export default router;
