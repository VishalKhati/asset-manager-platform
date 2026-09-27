/**
 * Market data ingest from the MT5 feeder (HMAC-signed, see middlewares/feederAuth.ts).
 *
 * POST /api/ingest/bars       closed M1 bars (bid OHLC + spread), up to 5000 per call
 * POST /api/ingest/heartbeat  feeder liveness and broker clock offset
 * POST /api/ingest/news       optional economic-calendar events exported from MT5
 */

import { Router } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { candlesTable, db, feedersTable, newsEventsTable } from "@workspace/db";
import { config } from "../config.js";
import { feederAuth } from "../middlewares/feederAuth.js";
import { validateBody } from "../middlewares/validate.js";
import { metrics } from "../lib/metrics.js";

const router = Router();
router.use(feederAuth);

const MAX_JUMP = 0.05; // a bar more than 5% from the previous close is quarantined

const barSchema = z.object({
  t: z.number().int().positive(),
  o: z.number().positive(),
  h: z.number().positive(),
  l: z.number().positive(),
  c: z.number().positive(),
  spread: z.number().min(0).max(1000),
  volume: z.number().min(0).optional(),
});
const feederInfo = z
  .object({
    serverUtcOffsetMin: z.number().int().min(-24 * 60).max(24 * 60).optional(),
    terminalConnected: z.boolean().optional(),
    version: z.string().max(64).optional(),
  })
  .optional();
const barsSchema = z.object({
  symbol: z.string().min(1).max(20),
  bars: z.array(barSchema).max(5000),
  feeder: feederInfo,
});

export interface BarCheck {
  accepted: z.infer<typeof barSchema>[];
  rejected: Array<{ t: number; reason: string }>;
}

/** Pure validation: closed, minute-aligned, consistent OHLC, no wild jumps. */
export function checkBars(bars: z.infer<typeof barSchema>[], nowS: number, prevClose: number | null): BarCheck {
  const out: BarCheck = { accepted: [], rejected: [] };
  const sorted = [...bars].sort((a, b) => a.t - b.t);
  let prev = prevClose;
  for (const b of sorted) {
    let reason = "";
    if (b.t % 60 !== 0) reason = "not_minute_aligned";
    else if (b.t + 60 > nowS + 5) reason = "bar_not_closed";
    else if (b.l > Math.min(b.o, b.c) || b.h < Math.max(b.o, b.c) || b.l > b.h) reason = "inconsistent_ohlc";
    else if (prev !== null && Math.abs(b.c - prev) / prev > MAX_JUMP) reason = "price_jump";
    if (reason) {
      out.rejected.push({ t: b.t, reason });
      continue;
    }
    out.accepted.push(b);
    prev = b.c;
  }
  return out;
}

async function touchFeeder(feederId: string, info: z.infer<typeof feederInfo>, lastBarT?: number): Promise<void> {
  await db
    .insert(feedersTable)
    .values({
      id: feederId,
      lastSeenAt: new Date(),
      lastBarT: lastBarT ?? null,
      serverUtcOffsetMin: info?.serverUtcOffsetMin ?? null,
      terminalConnected: info?.terminalConnected ?? null,
      version: info?.version ?? null,
    })
    .onConflictDoUpdate({
      target: feedersTable.id,
      set: {
        lastSeenAt: new Date(),
        ...(lastBarT ? { lastBarT: sql`greatest(coalesce(${feedersTable.lastBarT}, 0), ${lastBarT})` } : {}),
        ...(info?.serverUtcOffsetMin !== undefined ? { serverUtcOffsetMin: info.serverUtcOffsetMin } : {}),
        ...(info?.terminalConnected !== undefined ? { terminalConnected: info.terminalConnected } : {}),
        ...(info?.version !== undefined ? { version: info.version } : {}),
      },
    });
}

router.post("/bars", validateBody(barsSchema), async (req, res, next) => {
  const body = req.body as z.infer<typeof barsSchema>;
  const feederId = String(res.locals["feederId"]);
  if (body.symbol !== config.SYMBOL) {
    res.status(400).json({ ok: false, error: `This service only accepts ${config.SYMBOL}.` });
    return;
  }
  try {
    const first = body.bars.reduce((m, b) => Math.min(m, b.t), Infinity);
    const prevRows = Number.isFinite(first)
      ? await db.execute<{ c: number }>(
          sql`select c from ${candlesTable} where symbol = ${body.symbol} and t < ${first} order by t desc limit 1`,
        )
      : { rows: [] };
    const prevClose = prevRows.rows[0]?.c ?? null;
    const check = checkBars(body.bars, Math.floor(Date.now() / 1000), prevClose === null ? null : Number(prevClose));

    let inserted = 0;
    let revised = 0;
    if (check.accepted.length) {
      const source = `mt5:${feederId}`;
      await db.transaction(async (tx) => {
        const result = await tx
          .insert(candlesTable)
          .values(check.accepted.map((b) => ({ symbol: body.symbol, t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, spread: b.spread, volume: b.volume ?? 0, source })))
          .onConflictDoUpdate({
            target: [candlesTable.symbol, candlesTable.t],
            set: {
              o: sql`excluded.o`,
              h: sql`excluded.h`,
              l: sql`excluded.l`,
              c: sql`excluded.c`,
              spread: sql`excluded.spread`,
              volume: sql`excluded.volume`,
              revisedAt: sql`now()`,
            },
            // Only rewrite rows whose prices actually changed (a broker revision).
            setWhere: sql`(${candlesTable.o}, ${candlesTable.h}, ${candlesTable.l}, ${candlesTable.c}) is distinct from (excluded.o, excluded.h, excluded.l, excluded.c)`,
          })
          .returning({ t: candlesTable.t, revisedAt: candlesTable.revisedAt });
        for (const r of result) {
          if (r.revisedAt) revised += 1;
          else inserted += 1;
        }
        await tx.execute(sql`select pg_notify('bars', ${body.symbol})`);
      });
    }
    const lastBarT = check.accepted.length ? check.accepted[check.accepted.length - 1]!.t : undefined;
    await touchFeeder(feederId, body.feeder, lastBarT);
    metrics.ingestBars.inc({ result: "accepted" }, check.accepted.length);
    metrics.ingestBars.inc({ result: "rejected" }, check.rejected.length);
    metrics.barRevisions.inc(revised);
    if (check.rejected.length) req.log.warn({ rejected: check.rejected.slice(0, 20) }, "ingest: bars rejected");
    res.json({ ok: true, inserted, revised, rejected: check.rejected });
  } catch (err) {
    next(err);
  }
});

const heartbeatSchema = z.object({
  feeder: feederInfo,
});

router.post("/heartbeat", validateBody(heartbeatSchema), async (req, res, next) => {
  try {
    await touchFeeder(String(res.locals["feederId"]), (req.body as z.infer<typeof heartbeatSchema>).feeder);
    res.json({ ok: true, serverTime: Math.floor(Date.now() / 1000) });
  } catch (err) {
    next(err);
  }
});

const newsSchema = z.object({
  events: z
    .array(
      z.object({
        extId: z.string().min(1).max(100),
        currency: z.string().length(3),
        title: z.string().min(1).max(200),
        impact: z.enum(["high", "medium", "low"]),
        t: z.number().int().positive(),
      }),
    )
    .max(2000),
});

router.post("/news", validateBody(newsSchema), async (req, res, next) => {
  const { events } = req.body as z.infer<typeof newsSchema>;
  try {
    if (events.length) {
      await db
        .insert(newsEventsTable)
        .values(events.map((e) => ({ source: "mt5", ...e })))
        .onConflictDoUpdate({
          target: [newsEventsTable.source, newsEventsTable.extId],
          set: { t: sql`excluded.t`, impact: sql`excluded.impact`, title: sql`excluded.title`, fetchedAt: sql`now()` },
        });
    }
    res.json({ ok: true, upserted: events.length });
  } catch (err) {
    next(err);
  }
});

export default router;
