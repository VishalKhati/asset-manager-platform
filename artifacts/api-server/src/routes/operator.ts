/**
 * Operator endpoints (signed-in users; changes need the admin role).
 *
 * GET  /api/engine/status             feed, engine, queue and news health
 * POST /api/engine/pause              { reason }   (admin)
 * POST /api/engine/resume                          (admin)
 * GET  /api/engine/evaluations        "why no signal" log (?limit=)
 * GET  /api/signals                   every signal incl. unpublished (?mode=&before=&limit=)
 * GET  /api/signals/stats             stats per mode (?days=)
 * GET  /api/strategy-configs          config history
 * POST /api/strategy-configs          { params, note } → new active version (admin)
 * GET  /api/backtest-runs             uploaded research reports
 * POST /api/backtest-runs             { kind, report, isPublic } (admin)
 */

import { Router } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { backtestRunsTable, db, engineEvaluationsTable, signalsTable, strategyConfigsTable } from "@workspace/db";
import { parseParams, REASON_LABELS, STRATEGY_ID, STRATEGY_VERSION } from "@workspace/strategy";
import { config } from "../config.js";
import { requireAdmin, requireAuth } from "../middlewares/auth.js";
import { parseQuery, validateBody } from "../middlewares/validate.js";
import { engineStatus, setPaused } from "../engine/control.js";
import { eventsFor, listSignals, signalStats, toView } from "../services/signals.js";
import { m5Chart } from "../services/chart.js";
import { writeAudit } from "../lib/audit.js";

const router = Router();
router.use(["/engine", "/signals", "/strategy-configs", "/backtest-runs"], requireAuth);
const nowS = () => Math.floor(Date.now() / 1000);

router.get("/engine/status", async (_req, res, next) => {
  try {
    res.json({ ok: true, status: await engineStatus(config.SYMBOL, config.SIGNAL_MODE, config.FEED_SILENT_ALERT_MIN) });
  } catch (err) {
    next(err);
  }
});

const pauseSchema = z.object({ reason: z.string().trim().max(200).optional() });

router.post("/engine/pause", ...requireAdmin, validateBody(pauseSchema), async (req, res, next) => {
  try {
    await setPaused(config.SYMBOL, true, { id: req.userId, name: req.username }, (req.body as z.infer<typeof pauseSchema>).reason ?? "paused from dashboard");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/engine/resume", ...requireAdmin, async (req, res, next) => {
  try {
    await setPaused(config.SYMBOL, false, { id: req.userId, name: req.username });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const evalQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });

router.get("/engine/evaluations", async (req, res, next) => {
  const q = parseQuery(evalQuery, req, res);
  if (!q) return;
  try {
    const rows = await db
      .select()
      .from(engineEvaluationsTable)
      .where(eq(engineEvaluationsTable.symbol, config.SYMBOL))
      .orderBy(desc(engineEvaluationsTable.t))
      .limit(q.limit);
    res.json({
      ok: true,
      labels: { ...REASON_LABELS, paused: "Signal suppressed: engine paused" },
      evaluations: rows.map((r) => ({ t: r.t, reason: r.reason, close: r.close, diag: r.diag })),
    });
  } catch (err) {
    next(err);
  }
});

const signalsQuery = z.object({
  mode: z.enum(["shadow", "forward", "live"]).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

router.get("/signals", async (req, res, next) => {
  const q = parseQuery(signalsQuery, req, res);
  if (!q) return;
  try {
    const signals = await listSignals({
      symbol: config.SYMBOL,
      modes: q.mode ? [q.mode] : ["shadow", "forward", "live"],
      publishedOnly: false,
      beforeId: q.before,
      limit: q.limit,
    });
    res.json({ ok: true, signals });
  } catch (err) {
    next(err);
  }
});

const statsQuery = z.object({ days: z.coerce.number().int().min(0).max(3650).default(0) });

router.get("/signals/stats", async (req, res, next) => {
  const q = parseQuery(statsQuery, req, res);
  if (!q) return;
  try {
    const since = q.days ? nowS() - q.days * 86_400 : undefined;
    const [forward, live, shadow] = await Promise.all([
      signalStats(config.SYMBOL, ["forward"], false, since),
      signalStats(config.SYMBOL, ["live"], false, since),
      signalStats(config.SYMBOL, ["shadow"], false, since),
    ]);
    res.json({ ok: true, stats: { forward, live, shadow } });
  } catch (err) {
    next(err);
  }
});

/** Operator view of one signal, including unpublished and shadow ones. */
router.get("/signals/by-no/:publicNo", async (req, res, next) => {
  try {
    const [s] = await db.select().from(signalsTable).where(eq(signalsTable.publicNo, String(req.params["publicNo"])));
    if (!s) {
      res.status(404).json({ ok: false, error: "Signal not found." });
      return;
    }
    const events = await eventsFor([s.id]);
    res.json({ ok: true, signal: toView(s, events.get(s.id)) });
  } catch (err) {
    next(err);
  }
});

router.get("/signals/by-no/:publicNo/chart", async (req, res, next) => {
  try {
    const [s] = await db.select().from(signalsTable).where(eq(signalsTable.publicNo, String(req.params["publicNo"])));
    if (!s) {
      res.status(404).json({ ok: false, error: "Signal not found." });
      return;
    }
    const [cfg] = await db.select().from(strategyConfigsTable).where(eq(strategyConfigsTable.id, s.configId));
    const params = parseParams(cfg?.params ?? {});
    const nowS = Math.floor(Date.now() / 1000);
    res.json({ ok: true, bars: await m5Chart(config.SYMBOL, s.t - 8 * 3600, Math.min((s.closedT ?? nowS) + 2 * 3600, nowS), params) });
  } catch (err) {
    next(err);
  }
});

router.get("/strategy-configs", async (_req, res, next) => {
  try {
    const rows = await db.select().from(strategyConfigsTable).where(eq(strategyConfigsTable.symbol, config.SYMBOL)).orderBy(desc(strategyConfigsTable.id)).limit(50);
    res.json({ ok: true, configs: rows });
  } catch (err) {
    next(err);
  }
});

const configSchema = z.object({ params: z.record(z.unknown()), note: z.string().trim().min(3).max(500) });

router.post("/strategy-configs", ...requireAdmin, validateBody(configSchema), async (req, res, next) => {
  const body = req.body as z.infer<typeof configSchema>;
  let params;
  try {
    params = parseParams(body.params);
  } catch (err) {
    const issue = err instanceof z.ZodError ? err.issues[0] : undefined;
    res.status(400).json({ ok: false, error: issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid parameters." });
    return;
  }
  try {
    const created = await db.transaction(async (tx) => {
      await tx
        .update(strategyConfigsTable)
        .set({ isActive: false })
        .where(and(eq(strategyConfigsTable.symbol, config.SYMBOL), eq(strategyConfigsTable.isActive, true)));
      const [row] = await tx
        .insert(strategyConfigsTable)
        .values({
          symbol: config.SYMBOL,
          strategyId: STRATEGY_ID,
          strategyVersion: STRATEGY_VERSION,
          params: params as unknown as Record<string, unknown>,
          isActive: true,
          note: body.note,
          createdBy: req.username,
        })
        .returning();
      return row!;
    });
    writeAudit({ actorId: req.userId, actorUsername: req.username, action: "config.activate", targetId: String(created.id), details: { note: body.note } });
    res.status(201).json({ ok: true, config: created });
  } catch (err) {
    next(err);
  }
});

router.get("/backtest-runs", async (_req, res, next) => {
  try {
    const rows = await db
      .select({ id: backtestRunsTable.id, kind: backtestRunsTable.kind, strategyId: backtestRunsTable.strategyId, strategyVersion: backtestRunsTable.strategyVersion, summary: backtestRunsTable.summary, isPublic: backtestRunsTable.isPublic, createdAt: backtestRunsTable.createdAt, createdBy: backtestRunsTable.createdBy })
      .from(backtestRunsTable)
      .orderBy(desc(backtestRunsTable.id))
      .limit(50);
    res.json({ ok: true, runs: rows });
  } catch (err) {
    next(err);
  }
});

router.get("/backtest-runs/:id", async (req, res, next) => {
  try {
    const [row] = await db.select().from(backtestRunsTable).where(eq(backtestRunsTable.id, Number(req.params["id"])));
    if (!row) {
      res.status(404).json({ ok: false, error: "Not found." });
      return;
    }
    res.json({ ok: true, run: row });
  } catch (err) {
    next(err);
  }
});

const runSchema = z.object({
  kind: z.enum(["walk_forward", "backtest"]),
  isPublic: z.boolean().default(false),
  report: z
    .object({
      strategy: z.object({ id: z.string(), version: z.number().int() }),
      gate: z.object({ pass: z.boolean() }).passthrough(),
      oos: z.record(z.unknown()),
    })
    .passthrough(),
});

router.post("/backtest-runs", ...requireAdmin, validateBody(runSchema), async (req, res, next) => {
  const body = req.body as z.infer<typeof runSchema>;
  try {
    const r = body.report as Record<string, unknown> & { strategy: { id: string; version: number }; gate: { pass: boolean }; oos: Record<string, unknown> };
    const summary = { gatePass: r.gate.pass, oos: r.oos, holdout: r["holdout"] ?? null, data: r["data"] ?? null, generatedAt: r["generatedAt"] ?? null };
    const [row] = await db
      .insert(backtestRunsTable)
      .values({ kind: body.kind, strategyId: r.strategy.id, strategyVersion: r.strategy.version, summary, report: r, isPublic: body.isPublic, createdBy: req.username })
      .returning({ id: backtestRunsTable.id });
    writeAudit({ actorId: req.userId, actorUsername: req.username, action: "backtest.upload", targetId: String(row!.id) });
    res.status(201).json({ ok: true, id: row!.id });
  } catch (err) {
    next(err);
  }
});

export default router;
