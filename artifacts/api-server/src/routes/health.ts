import { Router, type IRouter } from "express";
import { db }                  from "@workspace/db";
import { sql }                 from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  let dbOk    = false;
  let dbMs    = 0;
  const start = Date.now();

  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
    dbMs = Date.now() - start;
  } catch {
    dbMs = Date.now() - start;
  }

  const status = dbOk ? "ok" : "degraded";
  const data   = HealthCheckResponse.parse({ status });

  res.status(dbOk ? 200 : 503).json({
    ...data,
    db:      { ok: dbOk, latencyMs: dbMs },
    uptime:  Math.floor(process.uptime()),
    env:     process.env["NODE_ENV"] ?? "unknown",
  });
});

export default router;
