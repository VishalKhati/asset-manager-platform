import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { Bar } from "@workspace/strategy";

export const hasDb = Boolean(process.env.TEST_DATABASE_URL);
const here = path.dirname(fileURLToPath(import.meta.url));
export const GOLDEN = path.resolve(here, "../../../fixtures/golden");

export function readFixtureBars(name: string): Bar[] {
  const lines = readFileSync(path.join(GOLDEN, name, "m1.csv"), "utf8").trim().split("\n").slice(1);
  return lines.map((l) => {
    const [t, o, h, lo, c, s] = l.split(",").map(Number);
    return { t: t!, o: o!, h: h!, l: lo!, c: c!, spread: s! };
  });
}

export function readFixture<T>(name: string, file: string): T {
  return JSON.parse(readFileSync(path.join(GOLDEN, name, file), "utf8")) as T;
}

/** Empty every table except the migration journal. */
export async function resetDb(): Promise<void> {
  await db.execute(sql`truncate table candles, feeders, news_events, strategy_configs, signals, signal_events, engine_evaluations,
    engine_state, notification_outbox, backtest_runs, users, audit_logs, price_alerts, notification_settings restart identity cascade`);
}
