import { desc, eq, lt, and } from "drizzle-orm";
import { candlesTable, db, engineEvaluationsTable, engineStateTable } from "@workspace/db";
import type { Logger } from "pino";
import { metrics } from "../lib/metrics.js";
import { queueAdmin } from "../telegram/outbox.js";
import { goldMarketOpen } from "./marketHours.js";

/**
 * Alerts the admins once when the market is open and no new M1 bar has arrived for
 * `silentMin` minutes, and once more when data flows again. Also warns when the news
 * calendar is stale and pauses publishing if it stays stale for 72 hours.
 */
export async function watchdogTick(symbol: string, silentMin: number, nowS: number, log: Logger): Promise<void> {
  const [state] = await db.select().from(engineStateTable).where(eq(engineStateTable.symbol, symbol));
  if (!state) return;
  // Heartbeat even when no bars arrive (weekends), so /readyz reflects the engine, not the market.
  await db.update(engineStateTable).set({ heartbeatAt: new Date() }).where(eq(engineStateTable.symbol, symbol));
  const [last] = await db.select({ t: candlesTable.t }).from(candlesTable).where(eq(candlesTable.symbol, symbol)).orderBy(desc(candlesTable.t)).limit(1);
  const ageS = last ? nowS - (last.t + 60) : Infinity;
  if (Number.isFinite(ageS)) metrics.feedLastBarAge.set(ageS);
  const silent = goldMarketOpen(nowS) && ageS > silentMin * 60;

  if (silent && !state.feedAlertOpen) {
    const mins = Number.isFinite(ageS) ? Math.round(ageS / 60) : null;
    await queueAdmin(`⚠️ ${symbol} feed silent${mins !== null ? ` for ${mins} min` : ": no bars received yet"}. Check the MT5 terminal and feeder.`);
    await db.update(engineStateTable).set({ feedAlertOpen: true }).where(eq(engineStateTable.symbol, symbol));
    log.warn({ ageS }, "feed silent");
  } else if (!silent && state.feedAlertOpen && ageS <= silentMin * 60) {
    await queueAdmin(`✅ ${symbol} feed recovered.`);
    await db.update(engineStateTable).set({ feedAlertOpen: false }).where(eq(engineStateTable.symbol, symbol));
    log.info("feed recovered");
  }

  // News freshness.
  const newsAgeH = state.newsFetchedAt ? (Date.now() - state.newsFetchedAt.getTime()) / 3_600_000 : null;
  if (newsAgeH !== null && newsAgeH > 72 && !state.paused) {
    await db
      .update(engineStateTable)
      .set({ paused: true, pausedReason: "news_stale", pausedBy: "watchdog", updatedAt: new Date() })
      .where(eq(engineStateTable.symbol, symbol));
    await queueAdmin(`⏸ Signals paused: the news calendar has not updated for ${Math.round(newsAgeH)} hours. /resume after fixing it.`);
  }
}

/** Keep 90 days of "why no signal" rows. */
export async function pruneEvaluations(symbol: string, nowS: number): Promise<void> {
  await db.delete(engineEvaluationsTable).where(and(eq(engineEvaluationsTable.symbol, symbol), lt(engineEvaluationsTable.t, nowS - 90 * 86_400)));
}
