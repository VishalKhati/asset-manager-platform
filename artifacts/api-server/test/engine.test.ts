import { beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import pino from "pino";
import {
  candlesTable,
  db,
  engineEvaluationsTable,
  engineStateTable,
  notificationOutboxTable,
  signalEventsTable,
  signalsTable,
  strategyConfigsTable,
} from "@workspace/db";
import { STRATEGY_ID, STRATEGY_VERSION, type Bar } from "@workspace/strategy";
import { LiveEngine, type Mode } from "../src/engine/liveEngine.js";
import { OutboxDispatcher, type TelegramApi } from "../src/telegram/outbox.js";
import { hasDb, readFixture, readFixtureBars, resetDb } from "./helpers.js";

const CASE = "dst_gap_mar_2021";
const log = pino({ level: "silent" });

interface ExpectedSignal {
  t: number;
  direction: string;
  outcome: string;
  rNet: number;
  entryRef: number;
  sl: number;
  state: string;
}

async function insertBars(bars: Bar[]): Promise<void> {
  for (let i = 0; i < bars.length; i += 2000) {
    await db.insert(candlesTable).values(bars.slice(i, i + 2000).map((b) => ({ symbol: "XAUUSD", ...b, source: "fixture" })));
  }
}

function engine(now: () => number, mode: Mode = "forward"): LiveEngine {
  return new LiveEngine({ symbol: "XAUUSD", mode, lateSeconds: 120, warmupDays: 60, now, log, loadNews: async () => readFixture<number[]>(CASE, "news.json") });
}

async function seedConfig(): Promise<void> {
  const params = readFixture<Record<string, unknown>>(CASE, "params.json");
  await db.insert(strategyConfigsTable).values({ symbol: "XAUUSD", strategyId: STRATEGY_ID, strategyVersion: STRATEGY_VERSION, params, isActive: true, note: "fixture" });
}

async function runAll(e: LiveEngine): Promise<void> {
  while ((await e.step(500)) > 0) {
    /* drain */
  }
}

describe.skipIf(!hasDb)("live engine against the golden fixture", () => {
  const bars = readFixtureBars(CASE);
  const expected = readFixture<{ signals: ExpectedSignal[]; reasons: Record<string, number> }>(CASE, "expected.json");

  beforeEach(async () => {
    await resetDb();
    await seedConfig();
  });

  it("produces exactly the Python reference signals and outcomes", async () => {
    // Engine starts before any data exists, then every bar arrives "live".
    const e = engine(() => bars[bars.length - 1]!.t + 3600);
    await e.init();
    await insertBars(bars);
    await runAll(e);

    const rows = await db.select().from(signalsTable).orderBy(asc(signalsTable.t));
    expect(rows.map((r) => [r.t, r.direction, r.outcome ?? "", r.state])).toEqual(
      expected.signals.map((s) => [s.t, s.direction, s.outcome, s.state]),
    );
    rows.forEach((r, i) => expect(r.rNet ?? 0).toBeCloseTo(expected.signals[i]!.rNet, 9));

    const evals = await db.select({ reason: engineEvaluationsTable.reason }).from(engineEvaluationsTable);
    const counts: Record<string, number> = {};
    for (const r of evals) counts[r.reason] = (counts[r.reason] ?? 0) + 1;
    expect(counts).toEqual(expected.reasons);

    // All of these were decided long after their bar closed, so none may be posted.
    expect(rows.every((r) => !r.published)).toBe(true);
    expect(await db.select().from(notificationOutboxTable)).toHaveLength(0);
  });

  it("survives a restart halfway through without changing any result", async () => {
    const now = () => bars[bars.length - 1]!.t + 3600;
    const half = Math.floor(bars.length / 2);
    const first = engine(now);
    await first.init();
    await insertBars(bars.slice(0, half));
    await runAll(first);

    // New process: rebuilds indicators from candles and restores open signals + cooldown.
    await insertBars(bars.slice(half));
    const second = engine(now);
    await second.init();
    await runAll(second);

    const rows = await db.select().from(signalsTable).orderBy(asc(signalsTable.t));
    expect(rows.map((r) => [r.t, r.outcome ?? "", r.state])).toEqual(expected.signals.map((s) => [s.t, s.outcome, s.state]));
    const [state] = await db.select().from(engineStateTable).where(eq(engineStateTable.symbol, "XAUUSD"));
    expect(state!.lastBarT).toBe(bars[bars.length - 1]!.t);
  });

  it("posts fresh signals, edits them on every outcome, and never posts twice", async () => {
    // Each bar is processed 10 s after it closed: the clock follows the engine's cursor.
    let e: LiveEngine | null = null;
    e = engine(() => (e?.engine ? e.engine.lastBarT + 70 : 0));
    await e.init();
    await insertBars(bars);
    await runAll(e);
    const signals = await db.select().from(signalsTable);
    expect(signals.length).toBe(expected.signals.length);
    expect(signals.every((s) => s.published)).toBe(true);

    const sent: Array<{ chat: string; text: string; replyTo?: number }> = [];
    const edits: Array<{ chat: string; id: number }> = [];
    let nextId = 100;
    const api: TelegramApi = {
      async sendMessage(chat, text, replyTo) {
        sent.push({ chat, text, replyTo });
        return { message_id: nextId++ };
      },
      async editMessageText(chat, id) {
        edits.push({ chat, id });
      },
    };
    const outbox = new OutboxDispatcher({ api, signalChats: ["@private"], adminChats: ["42"], log });
    while ((await outbox.runOnce(100)) > 0) {
      /* drain */
    }
    const posts = sent.filter((m) => m.replyTo === undefined && m.chat === "@private");
    expect(posts).toHaveLength(signals.length);
    expect(posts[0]!.text).toContain("XAUUSD");
    const closedCount = expected.signals.filter((s) => s.outcome).length;
    expect(sent.filter((m) => m.replyTo !== undefined).length).toBeGreaterThanOrEqual(closedCount);
    expect(edits.length).toBeGreaterThanOrEqual(closedCount);

    // Running the dispatcher again sends nothing new.
    const before = sent.length;
    await outbox.runOnce(100);
    expect(sent.length).toBe(before);
    const pending = await db.select().from(notificationOutboxTable).where(eq(notificationOutboxTable.status, "pending"));
    expect(pending).toHaveLength(0);
  });

  it("records suppressed signals while paused", async () => {
    await db.insert(engineStateTable).values({ symbol: "XAUUSD", paused: true });
    const e = engine(() => bars[bars.length - 1]!.t + 3600);
    await e.init();
    await insertBars(bars);
    await runAll(e);
    expect(await db.select().from(signalsTable)).toHaveLength(0);
    const paused = await db.select().from(engineEvaluationsTable).where(eq(engineEvaluationsTable.reason, "paused"));
    expect(paused.length).toBeGreaterThan(0);
    expect(await db.select().from(signalEventsTable)).toHaveLength(0);
  });
});
