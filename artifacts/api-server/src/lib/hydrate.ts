/**
 * Startup hydration — restores all per-user, per-symbol in-memory state
 * from the database before the HTTP server accepts connections.
 *
 * Failures are non-fatal; the bot starts with empty state rather than crashing.
 */

import { db }             from "@workspace/db";
import {
  botTradesTable,
  botLogsTable,
  botConfigTable,
  botStatusTable,
  botWebhooksTable,
} from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { botRegistry }   from "./botState.js";
import { notifier }      from "./notifier.js";
import { logger }        from "./logger.js";
import type { Trade, LogEntry, BotConfig } from "./botState.js";

export async function hydrateFromDb(): Promise<void> {
  try {
    // ── 1. Discover all (userId, symbol) pairs from both tables ───────────
    const cfgPairs = await db
      .select({ userId: botConfigTable.userId, symbol: botConfigTable.symbol })
      .from(botConfigTable);

    const statusPairs = await db
      .select({ userId: botStatusTable.userId, symbol: botStatusTable.symbol })
      .from(botStatusTable);

    // Merge into a deduplicated set
    const pairSet = new Map<string, { userId: string; symbol: string }>();
    for (const p of [...cfgPairs, ...statusPairs]) {
      if (botRegistry.isSupported(p.symbol)) {
        pairSet.set(`${p.userId}:${p.symbol}`, p);
      }
    }

    logger.info({ count: pairSet.size }, "Hydrating user/symbol pairs from DB");

    for (const { userId, symbol } of pairSet.values()) {
      const state = botRegistry.getOrCreate(userId, symbol);

      // ── 2. Config ──────────────────────────────────────────────────────
      const [cfgRow] = await db
        .select()
        .from(botConfigTable)
        .where(and(eq(botConfigTable.userId, userId), eq(botConfigTable.symbol, symbol)));
      if (cfgRow) {
        const saved = cfgRow.config as unknown as Partial<BotConfig>;
        if (saved.mode)       state.config.mode       = saved.mode;
        if (saved.engine)     Object.assign(state.config.engine,     saved.engine);
        if (saved.risk)       Object.assign(state.config.risk,       saved.risk);
        if (saved.strategies) Object.assign(state.config.strategies, saved.strategies);
      }

      // ── 3. Status ──────────────────────────────────────────────────────
      const [statusRow] = await db
        .select()
        .from(botStatusTable)
        .where(and(eq(botStatusTable.userId, userId), eq(botStatusTable.symbol, symbol)));
      if (statusRow) {
        state.running       = statusRow.running;
        state.startedAt     = statusRow.startedAt  ?? undefined;
        state.stoppedAt     = statusRow.stoppedAt  ?? undefined;
        state.tradesToday   = statusRow.tradesToday;
        state.lastResetDate = statusRow.lastResetDate;
      }

      // ── 4. Last 200 trades ─────────────────────────────────────────────
      const tradeRows = await db
        .select()
        .from(botTradesTable)
        .where(and(eq(botTradesTable.userId, userId), eq(botTradesTable.symbol, symbol)))
        .orderBy(desc(botTradesTable.openedAt))
        .limit(200);
      state.trades = tradeRows.map(r => ({
        id:         r.id,
        symbol:     r.symbol,
        direction:  r.direction  as Trade["direction"],
        entry:      r.entry,
        sl:         r.sl,
        tp:         r.tp,
        lots:       r.lots,
        slPips:     r.slPips,
        tpPips:     r.tpPips,
        confidence: r.confidence,
        strategies: (r.strategies ?? []) as string[],
        openedAt:   r.openedAt,
        closedAt:   r.closedAt  ?? undefined,
        pnl:        r.pnl       ?? undefined,
        status:     r.status    as Trade["status"],
        reason:     r.reason    ?? undefined,
      }));

      // ── 5. Last 500 logs ───────────────────────────────────────────────
      const logRows = await db
        .select()
        .from(botLogsTable)
        .where(and(eq(botLogsTable.userId, userId), eq(botLogsTable.symbol, symbol)))
        .orderBy(desc(botLogsTable.id))
        .limit(500);
      state.logs = logRows.map(r => ({
        level:   r.level   as LogEntry["level"],
        message: r.message,
        ts:      r.ts,
        meta:    r.meta    as Record<string, unknown> | undefined,
      }));
    }

    logger.info({ pairs: pairSet.size }, "User/symbol state hydrated");

    // ── 6. Webhooks (global — not per-user scoped for n8n/bridge) ─────────
    const whRows = await db.select().from(botWebhooksTable);
    for (const wh of whRows) {
      if (!wh.active) continue;
      notifier.registerFromDb({
        id:        wh.id,
        url:       wh.url,
        events:    (wh.events ?? []) as string[],
        name:      wh.name,
        secret:    wh.secret ?? undefined,
        createdAt: wh.createdAt.toISOString(),
      });
    }
    logger.info({ count: whRows.length }, "Webhooks hydrated from DB");

    logger.info("✓ Full state hydrated from database");
  } catch (err) {
    logger.warn({ err }, "Hydration failed — starting with empty in-memory state");
  }
}
