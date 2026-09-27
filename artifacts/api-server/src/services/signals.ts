/** Signal read models and statistics shared by the API, SSE and Telegram commands. */

import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db, signalEventsTable, signalsTable, SIGNAL_OPEN_STATES, type DbSignal, type DbSignalEvent } from "@workspace/db";
import { equityCurve, summarize, type Summary } from "@workspace/strategy";

export type SignalView = ReturnType<typeof toView>;

export function toView(s: DbSignal, events: DbSignalEvent[] = []) {
  return {
    id: s.id,
    publicNo: s.publicNo,
    symbol: s.symbol,
    strategy: `${s.strategyId} v${s.strategyVersion}`,
    mode: s.mode,
    published: s.published,
    direction: s.direction,
    t: s.t,
    entry: s.entryRef,
    sl: s.sl,
    slCurrent: s.slCurrent,
    tp1: s.tp1,
    tp2: s.tp2,
    risk: s.risk,
    atr: s.atr,
    spread: s.spread,
    validUntil: s.validUntil,
    state: s.state,
    fill: s.fill,
    fillT: s.fillT,
    outcome: s.outcome,
    closedT: s.closedT,
    rNet: s.rNet,
    rGross: s.rGross,
    events: events.map((e) => ({ id: e.id, type: e.type, t: e.t, price: e.price })),
  };
}

export async function eventsFor(ids: number[]): Promise<Map<number, DbSignalEvent[]>> {
  const out = new Map<number, DbSignalEvent[]>();
  if (!ids.length) return out;
  const rows = await db.select().from(signalEventsTable).where(inArray(signalEventsTable.signalId, ids)).orderBy(asc(signalEventsTable.id));
  for (const r of rows) {
    const list = out.get(r.signalId) ?? [];
    list.push(r);
    out.set(r.signalId, list);
  }
  return out;
}

export interface ListOptions {
  symbol: string;
  modes: string[];
  publishedOnly: boolean;
  beforeId?: number;
  limit: number;
  /** Hide open signals younger than this many minutes (public delay). */
  openDelayMin?: number;
  nowS?: number;
}

export async function listSignals(o: ListOptions): Promise<SignalView[]> {
  const conds = [eq(signalsTable.symbol, o.symbol), inArray(signalsTable.mode, o.modes)];
  if (o.publishedOnly) conds.push(eq(signalsTable.published, true));
  if (o.beforeId) conds.push(lt(signalsTable.id, o.beforeId));
  if (o.openDelayMin && o.nowS) {
    const cutoff = o.nowS - o.openDelayMin * 60;
    conds.push(sql`(${signalsTable.state} not in ('pending','active','be') or ${signalsTable.t} <= ${cutoff})`);
  }
  const rows = await db.select().from(signalsTable).where(and(...conds)).orderBy(desc(signalsTable.id)).limit(o.limit);
  const events = await eventsFor(rows.map((r) => r.id));
  return rows.map((r) => toView(r, events.get(r.id)));
}

export async function openSignal(symbol: string, mode: string): Promise<DbSignal | undefined> {
  const [row] = await db
    .select()
    .from(signalsTable)
    .where(and(eq(signalsTable.symbol, symbol), eq(signalsTable.mode, mode), inArray(signalsTable.state, [...SIGNAL_OPEN_STATES])))
    .limit(1);
  return row;
}

export interface StatsResult {
  summary: Summary;
  equity: Array<[number, number]>;
  since: number | null;
  byMonth: Array<{ month: string; trades: number; totalR: number }>;
}

/** Stats over filled, closed signals (expired ones are counted separately). */
export async function signalStats(symbol: string, modes: string[], publishedOnly: boolean, sinceS?: number): Promise<StatsResult> {
  const conds = [
    eq(signalsTable.symbol, symbol),
    inArray(signalsTable.mode, modes),
    isNotNull(signalsTable.outcome),
  ];
  if (publishedOnly) conds.push(eq(signalsTable.published, true));
  if (sinceS) conds.push(gte(signalsTable.t, sinceS));
  const rows = await db
    .select({ t: signalsTable.t, outcome: signalsTable.outcome, rNet: signalsTable.rNet })
    .from(signalsTable)
    .where(and(...conds))
    .orderBy(asc(signalsTable.t));
  const filled = rows.filter((r) => r.outcome !== "expired" && r.rNet !== null) as Array<{ t: number; outcome: string; rNet: number }>;
  const expired = rows.length - filled.length;
  const months = new Map<string, { trades: number; totalR: number }>();
  for (const r of filled) {
    const m = new Date(r.t * 1000).toISOString().slice(0, 7);
    const cur = months.get(m) ?? { trades: 0, totalR: 0 };
    cur.trades += 1;
    cur.totalR += r.rNet;
    months.set(m, cur);
  }
  return {
    summary: summarize(
      filled.map((r) => r.rNet),
      filled.map((r) => r.outcome),
      expired,
    ),
    equity: equityCurve(filled),
    since: rows[0]?.t ?? null,
    byMonth: [...months.entries()].map(([month, v]) => ({ month, ...v })),
  };
}
