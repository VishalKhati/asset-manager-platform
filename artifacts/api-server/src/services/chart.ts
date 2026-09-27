import { and, asc, eq, gte, lte } from "drizzle-orm";
import { candlesTable, db } from "@workspace/db";
import { Aggregator, Ema, M5, M15, type IndBar } from "@workspace/strategy";

/**
 * M5 candles with EMA fast/slow and the M15 trend EMA, built from stored M1 bars.
 * Loads extra history before `from` so the EMAs are warmed up.
 */
export async function m5Chart(symbol: string, fromS: number, toS: number, p: { emaFast: number; emaSlow: number; emaTrend: number }) {
  const warmFrom = fromS - 3 * 86_400;
  const rows = await db
    .select({ t: candlesTable.t, o: candlesTable.o, h: candlesTable.h, l: candlesTable.l, c: candlesTable.c, spread: candlesTable.spread })
    .from(candlesTable)
    .where(and(eq(candlesTable.symbol, symbol), gte(candlesTable.t, warmFrom), lte(candlesTable.t, toS)))
    .orderBy(asc(candlesTable.t));

  const agg5 = new Aggregator(M5);
  const agg15 = new Aggregator(M15);
  const fast = new Ema(p.emaFast);
  const slow = new Ema(p.emaSlow);
  const trend = new Ema(p.emaTrend);
  let trendValue = NaN;
  const out: Array<{ t: number; o: number; h: number; l: number; c: number; emaFast: number | null; emaSlow: number | null; emaTrend: number | null }> = [];
  const n = (x: number) => (Number.isFinite(x) ? x : null);

  const onM5 = (b: IndBar) => {
    const f = fast.update(b.c);
    const s = slow.update(b.c);
    if (b.t >= fromS) out.push({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, emaFast: n(f), emaSlow: n(s), emaTrend: n(trendValue) });
  };
  const close = (now: number) => {
    const h = agg15.closeIfDone(now);
    if (h) trendValue = trend.update(h.c);
    const b = agg5.closeIfDone(now);
    if (b) onM5(b);
  };
  for (const r of rows) {
    close(r.t);
    agg15.push(r);
    agg5.push(r);
    close(r.t + 60);
  }
  return out;
}
