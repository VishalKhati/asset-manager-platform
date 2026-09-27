/**
 * Price alert CRUD routes.
 *
 * GET    /api/alerts            — list user's alerts (sorted newest first)
 * POST   /api/alerts            — create a new alert
 * DELETE /api/alerts/:id        — delete an alert
 * PATCH  /api/alerts/:id/rearm  — re-arm a triggered alert
 */

import { Router }        from "express";
import { db }            from "@workspace/db";
import { priceAlertsTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth }   from "../middlewares/auth.js";
import { config }        from "../config.js";

const router = Router();
router.use(requireAuth);

// Alerts are checked by the engine against every stored M1 bar of the service's symbol.
const SUPPORTED = [config.SYMBOL];

// ─── GET /api/alerts ──────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(priceAlertsTable)
      .where(eq(priceAlertsTable.userId, req.userId))
      .orderBy(desc(priceAlertsTable.createdAt));

    res.json({ ok: true, alerts: rows });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to load alerts." });
  }
});

// ─── POST /api/alerts ─────────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  const { symbol, condition, targetPrice, label } = req.body ?? {};

  const sym = String(symbol ?? "").toUpperCase();
  if (!SUPPORTED.includes(sym)) {
    res.status(400).json({ ok: false, error: `Unsupported symbol. Use: ${SUPPORTED.join(", ")}.` });
    return;
  }
  if (condition !== "above" && condition !== "below") {
    res.status(400).json({ ok: false, error: "condition must be 'above' or 'below'." });
    return;
  }
  const price = parseFloat(String(targetPrice ?? ""));
  if (!isFinite(price) || price <= 0) {
    res.status(400).json({ ok: false, error: "targetPrice must be a positive number." });
    return;
  }

  try {
    const [row] = await db
      .insert(priceAlertsTable)
      .values({
        userId:      req.userId,
        symbol:      sym,
        condition,
        targetPrice: String(price),
        label:       label ? String(label).slice(0, 100) : null,
      })
      .returning();

    res.status(201).json({ ok: true, alert: row });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to create alert." });
  }
});

// ─── DELETE /api/alerts/:id ───────────────────────────────────────────────────

router.delete("/:id", async (req, res) => {
  try {
    const deleted = await db
      .delete(priceAlertsTable)
      .where(and(
        eq(priceAlertsTable.id, req.params["id"]!),
        eq(priceAlertsTable.userId, req.userId),
      ))
      .returning();

    if (!deleted.length) {
      res.status(404).json({ ok: false, error: "Alert not found." });
      return;
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to delete alert." });
  }
});

// ─── PATCH /api/alerts/:id/rearm ─────────────────────────────────────────────

router.patch("/:id/rearm", async (req, res) => {
  try {
    const updated = await db
      .update(priceAlertsTable)
      .set({ active: true, triggeredAt: null })
      .where(and(
        eq(priceAlertsTable.id, req.params["id"]!),
        eq(priceAlertsTable.userId, req.userId),
      ))
      .returning();

    if (!updated.length) {
      res.status(404).json({ ok: false, error: "Alert not found." });
      return;
    }
    res.json({ ok: true, alert: updated[0] });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to re-arm alert." });
  }
});

export default router;
