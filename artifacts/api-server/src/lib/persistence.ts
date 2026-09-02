/**
 * Persistence layer — thin Drizzle ORM wrappers.
 * Every call is fire-and-forget from the route handler:
 *   persist.something(...).catch(err => req.log.error(err))
 */

import { db } from "@workspace/db";
import {
  botTradesTable,
  botLogsTable,
  botConfigTable,
  botStatusTable,
  botWebhooksTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import type { Trade, LogEntry, BotConfig } from "./botState.js";

// ─── Trades ───────────────────────────────────────────────────────────────────

export async function persistTrade(userId: string, trade: Trade): Promise<void> {
  await db
    .insert(botTradesTable)
    .values({ ...trade, userId, strategies: trade.strategies })
    .onConflictDoNothing();
}

export async function updateTradeClose(trade: Trade): Promise<void> {
  await db
    .update(botTradesTable)
    .set({ status: trade.status, closedAt: trade.closedAt ?? null, pnl: trade.pnl ?? null })
    .where(eq(botTradesTable.id, trade.id));
}

// ─── Config ───────────────────────────────────────────────────────────────────

export async function persistConfig(userId: string, symbol: string, config: BotConfig): Promise<void> {
  await db
    .insert(botConfigTable)
    .values({ userId, symbol, config: config as unknown as Record<string, unknown> })
    .onConflictDoUpdate({
      target: [botConfigTable.userId, botConfigTable.symbol],
      set:    { config: config as unknown as Record<string, unknown>, updatedAt: new Date() },
    });
}

// ─── Bot status ───────────────────────────────────────────────────────────────

export async function persistStatus(opts: {
  userId:        string;
  symbol:        string;
  running:       boolean;
  startedAt?:    string;
  stoppedAt?:    string;
  tradesToday:   number;
  lastResetDate: string;
}): Promise<void> {
  await db
    .insert(botStatusTable)
    .values({
      userId:        opts.userId,
      symbol:        opts.symbol,
      running:       opts.running,
      startedAt:     opts.startedAt ?? null,
      stoppedAt:     opts.stoppedAt ?? null,
      tradesToday:   opts.tradesToday,
      lastResetDate: opts.lastResetDate,
    })
    .onConflictDoUpdate({
      target: [botStatusTable.userId, botStatusTable.symbol],
      set: {
        running:       opts.running,
        startedAt:     opts.startedAt ?? null,
        stoppedAt:     opts.stoppedAt ?? null,
        tradesToday:   opts.tradesToday,
        lastResetDate: opts.lastResetDate,
      },
    });
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

export async function persistLog(userId: string, symbol: string, entry: LogEntry): Promise<void> {
  if (entry.level === "debug") return;
  await db.insert(botLogsTable).values({
    userId,
    symbol,
    level:   entry.level,
    message: entry.message,
    ts:      entry.ts,
    meta:    (entry.meta ?? null) as unknown as Record<string, unknown>,
  });
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

export async function persistWebhook(opts: {
  id:      string;
  userId:  string;
  url:     string;
  events:  string[];
  name:    string;
  secret?: string;
}): Promise<void> {
  await db.insert(botWebhooksTable).values({
    id:     opts.id,
    userId: opts.userId,
    url:    opts.url,
    events: opts.events,
    name:   opts.name,
    secret: opts.secret ?? null,
    active: true,
  });
}

export async function removeWebhook(id: string): Promise<void> {
  await db.delete(botWebhooksTable).where(eq(botWebhooksTable.id, id));
}

// ─── Bulk status update (tradesToday counter) ─────────────────────────────────

export async function incrementTradesToday(userId: string, symbol: string, newCount: number, lastResetDate: string): Promise<void> {
  await db
    .update(botStatusTable)
    .set({ tradesToday: newCount, lastResetDate })
    .where(and(eq(botStatusTable.userId, userId), eq(botStatusTable.symbol, symbol)));
}
