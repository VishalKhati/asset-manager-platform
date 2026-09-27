/**
 * Public, read-only track record. No authentication; cacheable for 30 s.
 *
 * GET /api/public/summary               headline stats, equity curve, feed status
 * GET /api/public/signals               published signals, newest first (?before=id&limit=)
 * GET /api/public/signals/:publicNo     one signal with its event timeline
 * GET /api/public/signals/:publicNo/chart  M5 candles and EMAs around the signal
 * GET /api/public/chart                 recent M5 candles (?hours=, max 48)
 * GET /api/public/backtest              latest public walk-forward report summary
 */

import { Router } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { backtestRunsTable, db, signalsTable, strategyConfigsTable } from "@workspace/db";
import { parseParams } from "@workspace/strategy";
import { config } from "../config.js";
import { parseQuery } from "../middlewares/validate.js";
import { eventsFor, listSignals, signalStats, toView } from "../services/signals.js";
import { m5Chart } from "../services/chart.js";
import { engineStatus } from "../engine/control.js";

const router = Router();
const nowS = () => Math.floor(Date.now() / 1000);

/** Which modes count toward the public record: live signals, plus the forward test while it runs. */
export function publicModes(): string[] {
  return config.SIGNAL_MODE === "live" ? ["live", "forward"] : ["forward"];
}

/**
 * Minutes an open signal stays hidden from public endpoints. During the forward test the
 * signals belong to the private channel, so the public page only shows closed ones.
 */
export function publicOpenDelayMin(): number {
  return config.SIGNAL_MODE === "live" ? config.PUBLIC_DELAY_MIN : 1_000_000_000;
}

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "public, max-age=30");
  next();
});

async function activeParams() {
  const [cfg] = await db
    .select()
    .from(strategyConfigsTable)
    .where(and(eq(strategyConfigsTable.symbol, config.SYMBOL), eq(strategyConfigsTable.isActive, true)));
  return { cfg, params: parseParams(cfg?.params ?? {}) };
}

router.get("/summary", async (_req, res, next) => {
  try {
    const modes = publicModes();
    const [all, last30, status, { cfg, params }] = await Promise.all([
      signalStats(config.SYMBOL, modes, true),
      signalStats(config.SYMBOL, modes, true, nowS() - 30 * 86_400),
      engineStatus(config.SYMBOL, config.SIGNAL_MODE, config.FEED_SILENT_ALERT_MIN),
      activeParams(),
    ]);
    res.json({
      ok: true,
      symbol: config.SYMBOL,
      mode: config.SIGNAL_MODE,
      strategy: cfg ? { id: cfg.strategyId, version: cfg.strategyVersion } : null,
      rules: {
        trend: `M15 close vs EMA${params.emaTrend}, EMA${params.emaFast} vs EMA${params.emaSlow}`,
        trigger: `M5 Stochastic(${params.stochK},${params.stochSmooth},${params.stochD}) cross out of ${params.stochLow}/${params.stochHigh} after a pullback to the EMA${params.emaFast}-EMA${params.emaSlow} zone`,
        risk: `Stop ${params.slAtrMult}×ATR(${params.atrPeriod}) or beyond the swing; TP1 ${params.tp1R}R (close ${Math.round(params.tp1Fraction * 100)}%, stop to entry); TP2 ${params.tp2R}R`,
        filters: "London and New York sessions, no signals 15 min around high-impact USD news, spread and volatility limits, one signal at a time, cooldown after a loss",
      },
      stats: { all: all.summary, last30Days: last30.summary },
      since: all.since,
      equity: all.equity,
      byMonth: all.byMonth,
      feed: { healthy: status.feedHealthy, marketOpen: status.marketOpen, lastBarAgeS: status.lastBarAgeS },
      paused: status.paused,
    });
  } catch (err) {
    next(err);
  }
});

const listQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

router.get("/signals", async (req, res, next) => {
  const q = parseQuery(listQuery, req, res);
  if (!q) return;
  try {
    const signals = await listSignals({
      symbol: config.SYMBOL,
      modes: publicModes(),
      publishedOnly: true,
      beforeId: q.before,
      limit: q.limit,
      openDelayMin: publicOpenDelayMin(),
      nowS: nowS(),
    });
    res.json({ ok: true, signals });
  } catch (err) {
    next(err);
  }
});

async function findPublic(publicNo: string) {
  const [s] = await db.select().from(signalsTable).where(eq(signalsTable.publicNo, publicNo));
  if (!s || !s.published || !publicModes().includes(s.mode)) return null;
  const open = ["pending", "active", "be"].includes(s.state);
  if (open && s.t > nowS() - publicOpenDelayMin() * 60) return null;
  return s;
}

router.get("/signals/:publicNo", async (req, res, next) => {
  try {
    const s = await findPublic(String(req.params["publicNo"]));
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

router.get("/signals/:publicNo/chart", async (req, res, next) => {
  try {
    const s = await findPublic(String(req.params["publicNo"]));
    if (!s) {
      res.status(404).json({ ok: false, error: "Signal not found." });
      return;
    }
    const { params } = await activeParams();
    const from = s.t - 8 * 3600;
    const to = Math.min((s.closedT ?? nowS()) + 2 * 3600, nowS());
    res.json({ ok: true, bars: await m5Chart(config.SYMBOL, from, to, params) });
  } catch (err) {
    next(err);
  }
});

const chartQuery = z.object({ hours: z.coerce.number().int().min(1).max(48).default(12) });

router.get("/chart", async (req, res, next) => {
  const q = parseQuery(chartQuery, req, res);
  if (!q) return;
  try {
    const { params } = await activeParams();
    const to = nowS();
    const bars = await m5Chart(config.SYMBOL, to - q.hours * 3600, to, params);
    // Public chart is delayed by PUBLIC_DELAY_MIN so it never leaks a hidden open signal.
    const cutoff = to - config.PUBLIC_DELAY_MIN * 60;
    res.json({ ok: true, bars: bars.filter((b) => b.t + 300 <= cutoff) });
  } catch (err) {
    next(err);
  }
});

router.get("/backtest", async (_req, res, next) => {
  try {
    const [run] = await db.select().from(backtestRunsTable).where(eq(backtestRunsTable.isPublic, true)).orderBy(desc(backtestRunsTable.id)).limit(1);
    res.json({ ok: true, backtest: run ? { id: run.id, kind: run.kind, strategy: `${run.strategyId} v${run.strategyVersion}`, createdAt: run.createdAt, summary: run.summary, report: run.report } : null });
  } catch (err) {
    next(err);
  }
});

export default router;
