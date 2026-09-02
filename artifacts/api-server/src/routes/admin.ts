/**
 * Admin routes — protected by requireAuth + requireAdmin.
 *
 * GET  /api/admin/overview      — summary cards + per-user bot status
 * GET  /api/admin/users         — all registered users
 * PATCH /api/admin/users/:id    — update role or active state
 * POST /api/admin/init          — self-promote to admin if no admins exist
 * GET  /api/admin/audit         — recent audit log entries
 * GET  /api/admin/system        — server uptime, memory, DB latency
 */

import { Router }        from "express";
import { db }            from "@workspace/db";
import { usersTable, botTradesTable, auditLogsTable } from "@workspace/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { requireAuth }   from "../middlewares/auth.js";
import { botRegistry }   from "../lib/botState.js";
import { writeAudit }    from "../lib/audit.js";
import type { Request, Response, NextFunction } from "express";

const router = Router();

// ─── requireAdmin ────────────────────────────────────────────────────────────

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId || req.userId === "_system") {
    res.status(403).json({ ok: false, error: "Admin access required." });
    return;
  }
  try {
    const [user] = await db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId));

    if (!user || user.role !== "admin") {
      res.status(403).json({ ok: false, error: "Admin access required." });
      return;
    }
    next();
  } catch {
    res.status(500).json({ ok: false, error: "Admin check failed." });
  }
}

const guard = [requireAuth, requireAdmin];

// ─── POST /api/admin/init ─────────────────────────────────────────────────────

router.post("/init", requireAuth, async (req, res) => {
  if (req.userId === "_system") {
    res.status(403).json({ ok: false, error: "Machine auth cannot become admin." });
    return;
  }
  try {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"));

    if (existing) {
      res.status(409).json({ ok: false, error: "An admin already exists. Contact them to promote you." });
      return;
    }

    await db
      .update(usersTable)
      .set({ role: "admin" })
      .where(eq(usersTable.id, req.userId));

    res.json({ ok: true, message: "You are now the admin." });
  } catch {
    res.status(500).json({ ok: false, error: "Init failed." });
  }
});

// ─── GET /api/admin/overview ──────────────────────────────────────────────────

router.get("/overview", ...guard, async (_req, res) => {
  try {
    const users = await db
      .select({
        id:          usersTable.id,
        username:    usersTable.username,
        email:       usersTable.email,
        role:        usersTable.role,
        active:      usersTable.active,
        createdAt:   usersTable.createdAt,
        lastSeenAt:  usersTable.lastSeenAt,
      })
      .from(usersTable)
      .orderBy(usersTable.createdAt);

    const tradeStats = await db
      .select({
        userId:      botTradesTable.userId,
        symbol:      botTradesTable.symbol,
        tradeCount:  sql<number>`cast(count(*) as int)`,
        closedCount: sql<number>`cast(count(*) filter (where ${botTradesTable.status} = 'closed') as int)`,
        openCount:   sql<number>`cast(count(*) filter (where ${botTradesTable.status} = 'open') as int)`,
        totalPnl:    sql<number>`coalesce(sum(${botTradesTable.pnl}), 0)`,
        winCount:    sql<number>`cast(count(*) filter (where ${botTradesTable.pnl} > 0) as int)`,
      })
      .from(botTradesTable)
      .groupBy(botTradesTable.userId, botTradesTable.symbol);

    const statsMap = new Map<string, Map<string, typeof tradeStats[0]>>();
    for (const row of tradeStats) {
      if (!statsMap.has(row.userId)) statsMap.set(row.userId, new Map());
      statsMap.get(row.userId)!.set(row.symbol, row);
    }

    const liveEntries = botRegistry.allEntries();
    const liveMap = new Map<string, { running: boolean; bridgeConnected: boolean; startedAt?: string }>();
    for (const { userId, symbol, state } of liveEntries) {
      const key = `${userId}:${symbol}`;
      const bridgeConnected = state.bridgeLastPing
        ? (Date.now() - new Date(state.bridgeLastPing).getTime()) < 2 * 60 * 1000
        : false;
      liveMap.set(key, { running: state.running, bridgeConnected, startedAt: state.startedAt });
    }

    const SYMBOLS = ["XAUUSD", "BTCUSD"];
    const userRows = users.map(u => {
      const symbolData = SYMBOLS.map(sym => {
        const dbStats = statsMap.get(u.id)?.get(sym);
        const live    = liveMap.get(`${u.id}:${sym}`);
        return {
          symbol:          sym,
          running:         live?.running         ?? false,
          bridgeConnected: live?.bridgeConnected ?? false,
          startedAt:       live?.startedAt,
          tradeCount:      dbStats?.tradeCount   ?? 0,
          closedCount:     dbStats?.closedCount  ?? 0,
          openCount:       dbStats?.openCount    ?? 0,
          totalPnl:        Number((dbStats?.totalPnl ?? 0).toFixed(2)),
          winCount:        dbStats?.winCount     ?? 0,
          winRate:         dbStats?.closedCount
            ? Math.round((dbStats.winCount / dbStats.closedCount) * 100)
            : 0,
        };
      });

      const totals = {
        tradeCount:      symbolData.reduce((a, s) => a + s.tradeCount, 0),
        totalPnl:        Number(symbolData.reduce((a, s) => a + s.totalPnl, 0).toFixed(2)),
        running:         symbolData.some(s => s.running),
        bridgeConnected: symbolData.some(s => s.bridgeConnected),
      };

      return { ...u, lastSeenAt: u.lastSeenAt?.toISOString() ?? null, symbols: symbolData, totals };
    });

    const summary = {
      totalUsers:  users.length,
      activeUsers: users.filter(u => u.active).length,
      adminCount:  users.filter(u => u.role === "admin").length,
      runningBots: userRows.filter(u => u.totals.running).length,
      bridgeOnline: userRows.filter(u => u.totals.bridgeConnected).length,
      totalTrades: userRows.reduce((a, u) => a + u.totals.tradeCount, 0),
      totalPnl:    Number(userRows.reduce((a, u) => a + u.totals.totalPnl, 0).toFixed(2)),
    };

    res.json({ ok: true, summary, users: userRows });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── GET /api/admin/users ─────────────────────────────────────────────────────

router.get("/users", ...guard, async (_req, res) => {
  try {
    const users = await db
      .select({
        id:         usersTable.id,
        username:   usersTable.username,
        email:      usersTable.email,
        role:       usersTable.role,
        active:     usersTable.active,
        createdAt:  usersTable.createdAt,
        lastSeenAt: usersTable.lastSeenAt,
      })
      .from(usersTable)
      .orderBy(usersTable.createdAt);

    res.json({ ok: true, users });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to list users." });
  }
});

// ─── PATCH /api/admin/users/:id ───────────────────────────────────────────────

router.patch("/users/:id", ...guard, async (req, res) => {
  const id              = String(req.params["id"]);
  const { role, active } = req.body ?? {};

  if (id === req.userId && role && role !== "admin") {
    res.status(400).json({ ok: false, error: "Cannot demote yourself." });
    return;
  }

  try {
    const [current] = await db
      .select({ username: usersTable.username, role: usersTable.role, active: usersTable.active })
      .from(usersTable)
      .where(eq(usersTable.id, id));

    if (!current) {
      res.status(404).json({ ok: false, error: "User not found." });
      return;
    }

    const updates: Partial<{ role: string; active: boolean }> = {};
    if (role   !== undefined) updates.role   = String(role);
    if (active !== undefined) updates.active = Boolean(active);

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ ok: false, error: "Nothing to update." });
      return;
    }

    const [updated] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, id))
      .returning({ id: usersTable.id, username: usersTable.username, role: usersTable.role, active: usersTable.active });

    // ── Audit log ──────────────────────────────────────────────────────────
    if (active !== undefined && Boolean(active) !== current.active) {
      writeAudit({
        actorId:        req.userId,
        actorUsername:  req.username,
        action:         Boolean(active) ? "user.activate" : "user.suspend",
        targetId:       id,
        targetUsername: current.username,
      });
    }
    if (role !== undefined && String(role) !== current.role) {
      writeAudit({
        actorId:        req.userId,
        actorUsername:  req.username,
        action:         String(role) === "admin" ? "user.promote" : "user.demote",
        targetId:       id,
        targetUsername: current.username,
        details:        { from: current.role, to: String(role) },
      });
    }

    res.json({ ok: true, user: updated });
  } catch {
    res.status(500).json({ ok: false, error: "Update failed." });
  }
});

// ─── GET /api/admin/audit ─────────────────────────────────────────────────────

router.get("/audit", ...guard, async (req, res) => {
  const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
  try {
    const logs = await db
      .select()
      .from(auditLogsTable)
      .orderBy(desc(auditLogsTable.createdAt))
      .limit(limit);

    res.json({ ok: true, logs });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to fetch audit logs." });
  }
});

// ─── GET /api/admin/system ────────────────────────────────────────────────────

router.get("/system", ...guard, async (_req, res) => {
  const memMb = (bytes: number) => Math.round(bytes / 1024 / 1024);
  const mem   = process.memoryUsage();

  let dbLatencyMs = -1;
  try {
    const t0 = Date.now();
    await db.execute(sql`SELECT 1`);
    dbLatencyMs = Date.now() - t0;
  } catch { /* ignore */ }

  res.json({
    ok:     true,
    uptime: Math.floor(process.uptime()),
    node:   process.version,
    memory: {
      heapUsedMb:  memMb(mem.heapUsed),
      heapTotalMb: memMb(mem.heapTotal),
      rssMb:       memMb(mem.rss),
    },
    db: { latencyMs: dbLatencyMs },
    bots: {
      total:   botRegistry.allEntries().length,
      running: botRegistry.allEntries().filter(e => e.state.running).length,
    },
  });
});

export default router;
