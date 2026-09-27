import { Router, type IRouter } from "express";
import { sql, eq } from "drizzle-orm";
import { db, engineStateTable } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";
import { config } from "../config.js";

const router: IRouter = Router();

/** Liveness: the process is up and the database answers. */
router.get("/healthz", async (_req, res) => {
  const start = Date.now();
  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch {
    /* degraded */
  }
  const data = HealthCheckResponse.parse({ status: dbOk ? "ok" : "degraded" });
  res.status(dbOk ? 200 : 503).json({ ...data, db: { ok: dbOk, latencyMs: Date.now() - start } });
});

/** Readiness: migrations applied and the engine has written a heartbeat in the last 2 minutes. */
router.get("/readyz", async (_req, res) => {
  try {
    const [state] = await db.select({ heartbeatAt: engineStateTable.heartbeatAt }).from(engineStateTable).where(eq(engineStateTable.symbol, config.SYMBOL));
    const ageS = state?.heartbeatAt ? (Date.now() - state.heartbeatAt.getTime()) / 1000 : null;
    const engineOk = ageS !== null && ageS < 120;
    res.status(engineOk ? 200 : 503).json({ status: engineOk ? "ok" : "engine_stale", engineHeartbeatAgeS: ageS });
  } catch {
    res.status(503).json({ status: "db_unavailable" });
  }
});

export default router;
