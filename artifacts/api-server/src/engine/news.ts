import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, newsEventsTable } from "@workspace/db";

/**
 * Economic calendar. The live source is the ForexFactory weekly JSON export (unofficial,
 * fetched at most hourly). The feeder can also push the MT5 calendar via /api/ingest/news.
 */

export interface FfEvent {
  title: string;
  country: string;
  date: string; // ISO 8601 with offset
  impact: string; // High | Medium | Low | Holiday
}

export interface NewsRow {
  extId: string;
  currency: string;
  title: string;
  impact: "high" | "medium" | "low";
  t: number;
}

export function parseForexFactory(events: FfEvent[]): NewsRow[] {
  const out: NewsRow[] = [];
  for (const e of events) {
    const impact = e.impact?.toLowerCase();
    if (impact !== "high" && impact !== "medium" && impact !== "low") continue;
    const ms = Date.parse(e.date);
    if (!Number.isFinite(ms) || !e.country || !e.title) continue;
    out.push({ extId: `${e.date}|${e.country}|${e.title}`.slice(0, 100), currency: e.country.toUpperCase().slice(0, 3), title: e.title.slice(0, 200), impact, t: Math.floor(ms / 1000) });
  }
  return out;
}

export async function fetchForexFactory(url: string, fetchImpl: typeof fetch = fetch): Promise<NewsRow[]> {
  const res = await fetchImpl(url, { headers: { "User-Agent": "asset-manager-signal-service/1.0" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`news feed HTTP ${res.status}`);
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) throw new Error("news feed: expected an array");
  return parseForexFactory(body as FfEvent[]);
}

export async function upsertNews(source: string, rows: NewsRow[]): Promise<void> {
  if (!rows.length) return;
  await db
    .insert(newsEventsTable)
    .values(rows.map((r) => ({ source, ...r })))
    .onConflictDoUpdate({
      target: [newsEventsTable.source, newsEventsTable.extId],
      set: { t: sql`excluded.t`, impact: sql`excluded.impact`, title: sql`excluded.title`, fetchedAt: sql`now()` },
    });
}

/** High-impact USD event times around `now`, for the engine's news filter. */
export async function loadNewsTimes(nowS: number, currencies = ["USD"]): Promise<number[]> {
  const rows = await db
    .select({ t: newsEventsTable.t, currency: newsEventsTable.currency })
    .from(newsEventsTable)
    .where(and(eq(newsEventsTable.impact, "high"), gte(newsEventsTable.t, nowS - 3 * 86_400), lte(newsEventsTable.t, nowS + 21 * 86_400)));
  return [...new Set(rows.filter((r) => currencies.includes(r.currency)).map((r) => r.t))].sort((a, b) => a - b);
}
