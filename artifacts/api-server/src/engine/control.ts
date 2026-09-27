/** Engine controls and status, shared by the admin API and the Telegram commands. */

import { count, desc, eq, and } from "drizzle-orm";
import { candlesTable, db, engineStateTable, feedersTable, notificationOutboxTable, strategyConfigsTable } from "@workspace/db";
import { writeAudit } from "../lib/audit.js";
import { goldMarketOpen } from "./marketHours.js";
import { openSignal } from "../services/signals.js";

export async function setPaused(symbol: string, paused: boolean, actor: { id: string; name: string }, reason?: string): Promise<void> {
  await db.insert(engineStateTable).values({ symbol }).onConflictDoNothing();
  await db
    .update(engineStateTable)
    .set({ paused, pausedReason: paused ? (reason ?? null) : null, pausedBy: paused ? actor.name : null, updatedAt: new Date() })
    .where(eq(engineStateTable.symbol, symbol));
  writeAudit({ actorId: actor.id, actorUsername: actor.name, action: paused ? "engine.pause" : "engine.resume", details: reason ? { reason } : undefined });
}

export interface EngineStatus {
  symbol: string;
  mode: string;
  paused: boolean;
  pausedReason: string | null;
  pausedBy: string | null;
  marketOpen: boolean;
  lastBarT: number | null;
  lastBarAgeS: number | null;
  engineCursorT: number;
  engineHeartbeatAgeS: number | null;
  engineHealthy: boolean;
  feedHealthy: boolean;
  feeders: Array<{ id: string; lastSeenAgeS: number | null; terminalConnected: boolean | null; serverUtcOffsetMin: number | null; version: string | null }>;
  newsFetchedAgeS: number | null;
  outboxPending: number;
  outboxFailed: number;
  cooldownUntil: number;
  openSignal: { publicNo: string; direction: string; state: string } | null;
  strategy: { configId: number; id: string; version: number } | null;
}

export async function engineStatus(symbol: string, mode: string, feedSilentMin: number): Promise<EngineStatus> {
  const nowS = Math.floor(Date.now() / 1000);
  const [state] = await db.select().from(engineStateTable).where(eq(engineStateTable.symbol, symbol));
  const [last] = await db.select({ t: candlesTable.t }).from(candlesTable).where(eq(candlesTable.symbol, symbol)).orderBy(desc(candlesTable.t)).limit(1);
  const feeders = await db.select().from(feedersTable);
  const [pending] = await db.select({ n: count() }).from(notificationOutboxTable).where(eq(notificationOutboxTable.status, "pending"));
  const [failed] = await db.select({ n: count() }).from(notificationOutboxTable).where(eq(notificationOutboxTable.status, "failed"));
  const [cfg] = await db.select().from(strategyConfigsTable).where(and(eq(strategyConfigsTable.symbol, symbol), eq(strategyConfigsTable.isActive, true)));
  const open = await openSignal(symbol, mode);
  const age = (d: Date | null | undefined) => (d ? Math.round((Date.now() - d.getTime()) / 1000) : null);
  const lastBarAgeS = last ? nowS - (last.t + 60) : null;
  const marketOpen = goldMarketOpen(nowS);
  const hbAge = age(state?.heartbeatAt);
  return {
    symbol,
    mode,
    paused: state?.paused ?? false,
    pausedReason: state?.pausedReason ?? null,
    pausedBy: state?.pausedBy ?? null,
    marketOpen,
    lastBarT: last?.t ?? null,
    lastBarAgeS,
    engineCursorT: state?.lastBarT ?? 0,
    engineHeartbeatAgeS: hbAge,
    engineHealthy: Boolean(state && (state.lastBarT >= (last?.t ?? 0) - 120)),
    feedHealthy: !marketOpen || (lastBarAgeS !== null && lastBarAgeS < feedSilentMin * 60),
    feeders: feeders.map((f) => ({ id: f.id, lastSeenAgeS: age(f.lastSeenAt), terminalConnected: f.terminalConnected, serverUtcOffsetMin: f.serverUtcOffsetMin, version: f.version })),
    newsFetchedAgeS: age(state?.newsFetchedAt),
    outboxPending: pending?.n ?? 0,
    outboxFailed: failed?.n ?? 0,
    cooldownUntil: state?.cooldownUntil ?? 0,
    openSignal: open ? { publicNo: open.publicNo, direction: open.direction, state: open.state } : null,
    strategy: cfg ? { configId: cfg.id, id: cfg.strategyId, version: cfg.strategyVersion } : null,
  };
}

export function formatAge(s: number | null): string {
  if (s === null) return "never";
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172_800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} days ago`;
}
