/**
 * Engine process entrypoint. Exactly one engine per symbol runs at a time: it takes a
 * Postgres advisory lock and stands by while another instance holds it.
 */

import http from "node:http";
import { desc, eq } from "drizzle-orm";
import { db, engineStateTable, pool, signalsTable } from "@workspace/db";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { registry } from "./lib/metrics.js";
import { LiveEngine } from "./engine/liveEngine.js";
import { engineStatus, formatAge, setPaused } from "./engine/control.js";
import { fetchForexFactory, loadNewsTimes, upsertNews } from "./engine/news.js";
import { pruneEvaluations, watchdogTick } from "./engine/watchdog.js";
import { OutboxDispatcher } from "./telegram/outbox.js";
import { startCommandBot, telegramApi } from "./telegram/bot.js";
import { signalStats } from "./services/signals.js";

const log = logger.child({ proc: "engine", symbol: config.SYMBOL });
const nowS = () => Math.floor(Date.now() / 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let stopping = false;

async function acquireLeadership(): Promise<import("pg").PoolClient> {
  const client = await pool.connect();
  for (;;) {
    const res = await client.query<{ ok: boolean }>("select pg_try_advisory_lock(hashtext($1)) as ok", [`amp-engine:${config.SYMBOL}`]);
    if (res.rows[0]?.ok) return client;
    log.info("another engine holds the lock; standing by");
    await sleep(10_000);
    if (stopping) process.exit(0);
  }
}

function signalChats(): string[] {
  if (config.SIGNAL_MODE === "live") return [config.TG_CHANNEL_PUBLIC_ID, config.TG_CHANNEL_PRIVATE_ID].filter((c): c is string => Boolean(c));
  if (config.SIGNAL_MODE === "forward") return [config.TG_CHANNEL_PRIVATE_ID].filter((c): c is string => Boolean(c));
  return [];
}

async function syncNews(): Promise<void> {
  try {
    const rows = await fetchForexFactory(config.NEWS_FEED_URL);
    await upsertNews("forexfactory", rows);
    await db.update(engineStateTable).set({ newsFetchedAt: new Date() }).where(eq(engineStateTable.symbol, config.SYMBOL));
    log.info({ events: rows.length, high: rows.filter((r) => r.impact === "high").length }, "news calendar updated");
  } catch (err) {
    log.warn({ err }, "news calendar fetch failed");
  }
}

async function main(): Promise<void> {
  const lockClient = await acquireLeadership();
  log.info({ mode: config.SIGNAL_MODE }, "engine is leader");

  await db.insert(engineStateTable).values({ symbol: config.SYMBOL }).onConflictDoNothing();
  await syncNews();

  let live = new LiveEngine({
    symbol: config.SYMBOL,
    mode: config.SIGNAL_MODE,
    lateSeconds: config.LATE_SIGNAL_S,
    warmupDays: config.WARMUP_DAYS,
    now: nowS,
    log,
    loadNews: (t) => loadNewsTimes(t),
  });
  await live.init();

  // Serialised processing: notifications and the poll timer only set a flag.
  let wake = true;
  const listen = await pool.connect();
  await listen.query("LISTEN bars");
  listen.on("notification", () => {
    wake = true;
  });

  const api = config.TELEGRAM_BOT_TOKEN ? telegramApi(config.TELEGRAM_BOT_TOKEN) : null;
  const outbox = new OutboxDispatcher({ api, signalChats: signalChats(), adminChats: config.TG_ADMIN_IDS, siteUrl: config.PUBLIC_SITE_URL, log });
  if (!api) log.warn("TELEGRAM_BOT_TOKEN not set: messages are recorded but not sent");

  if (config.TELEGRAM_BOT_TOKEN && config.TG_ADMIN_IDS.length) {
    const modes = config.SIGNAL_MODE === "shadow" ? ["shadow"] : [config.SIGNAL_MODE];
    startCommandBot(
      config.TELEGRAM_BOT_TOKEN,
      config.TG_ADMIN_IDS,
      {
        pause: async (actor, reason) => {
          await setPaused(config.SYMBOL, true, { id: actor, name: actor }, reason);
          return `⏸ Paused. No new signals until /resume. Open signals are still tracked.`;
        },
        resume: async (actor) => {
          await setPaused(config.SYMBOL, false, { id: actor, name: actor });
          return "▶️ Resumed.";
        },
        stats: async (period) => {
          const days = period === "7d" ? 7 : period === "all" ? 0 : 30;
          const st = await signalStats(config.SYMBOL, modes, true, days ? nowS() - days * 86_400 : undefined);
          const s = st.summary;
          return [
            `<b>${config.SYMBOL} · ${days ? `last ${days} days` : "all time"}</b>`,
            `Trades ${s.trades} (expired ${s.expired})`,
            `Win rate ${(s.winRate * 100).toFixed(1)}%`,
            `Total ${s.totalR.toFixed(2)}R · Expectancy ${s.expectancyR.toFixed(3)}R`,
            `Profit factor ${s.profitFactor === null ? "∞" : s.profitFactor.toFixed(2)} · Max DD ${s.maxDrawdownR.toFixed(2)}R`,
          ].join("\n");
        },
        health: async () => {
          const st = await engineStatus(config.SYMBOL, config.SIGNAL_MODE, config.FEED_SILENT_ALERT_MIN);
          return [
            `<b>Health · ${config.SYMBOL} · ${st.mode}</b>`,
            `${st.feedHealthy ? "✅" : "⚠️"} Last bar ${formatAge(st.lastBarAgeS)}${st.marketOpen ? "" : " (market closed)"}`,
            `${st.engineHealthy ? "✅" : "⚠️"} Engine heartbeat ${formatAge(st.engineHeartbeatAgeS)}`,
            ...st.feeders.map((f) => `Feeder ${f.id}: seen ${formatAge(f.lastSeenAgeS)}, terminal ${f.terminalConnected ? "connected" : "disconnected"}, UTC offset ${f.serverUtcOffsetMin ?? "?"} min`),
            `News calendar ${formatAge(st.newsFetchedAgeS)}`,
            `Queue: ${st.outboxPending} pending, ${st.outboxFailed} failed`,
            st.paused ? `⏸ Paused: ${st.pausedReason ?? ""}` : "▶️ Running",
            st.openSignal ? `Open: #${st.openSignal.publicNo} ${st.openSignal.direction} (${st.openSignal.state})` : "No open signal",
          ].join("\n");
        },
        last: async () => {
          const rows = await db.select().from(signalsTable).where(eq(signalsTable.symbol, config.SYMBOL)).orderBy(desc(signalsTable.id)).limit(5);
          if (!rows.length) return "No signals yet.";
          return rows
            .map((r) => `#${r.publicNo} ${r.direction} ${r.state}${r.rNet !== null ? ` ${r.rNet >= 0 ? "+" : ""}${r.rNet.toFixed(2)}R` : ""}${r.published ? "" : " (not posted)"}`)
            .join("\n");
        },
        mode: async () => `Mode: <b>${config.SIGNAL_MODE}</b>. Posting to ${signalChats().length} chat(s).`,
      },
      log,
    );
  }

  // Engine metrics on an internal port.
  const metricsServer = http.createServer(async (req, res) => {
    if (req.url === "/metrics" && (!config.METRICS_TOKEN || req.headers.authorization === `Bearer ${config.METRICS_TOKEN}`)) {
      res.setHeader("Content-Type", registry.contentType);
      res.end(await registry.metrics());
    } else if (req.url === "/healthz") {
      res.end("ok");
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  metricsServer.listen(Number(process.env["ENGINE_METRICS_PORT"] ?? 9464));

  let lastControl = 0;
  let lastNews = Date.now();
  let lastWatchdog = 0;
  let lastPrune = 0;
  let lastOutbox = 0;

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "engine shutting down");
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  while (!stopping) {
    const now = Date.now();
    try {
      if (now - lastControl > 5_000) {
        lastControl = now;
        if (await live.refreshControl()) {
          log.info("active strategy config changed; reinitialising");
          live = new LiveEngine(live.o);
          await live.init();
        }
        wake = true; // safety poll every 5 s in case a notification was missed
      }
      if (wake) {
        wake = false;
        const n = await live.step();
        if (n === 2000) wake = true; // more backlog
      }
      if (now - lastOutbox > 2_000) {
        lastOutbox = now;
        await outbox.runOnce();
      }
      if (now - lastWatchdog > 30_000) {
        lastWatchdog = now;
        await watchdogTick(config.SYMBOL, config.FEED_SILENT_ALERT_MIN, nowS(), log);
        await live.refreshNews();
      }
      if (now - lastNews > config.NEWS_REFRESH_MIN * 60_000) {
        lastNews = now;
        await syncNews();
      }
      if (now - lastPrune > 6 * 3_600_000) {
        lastPrune = now;
        await pruneEvaluations(config.SYMBOL, nowS());
      }
    } catch (err) {
      log.error({ err }, "engine loop error; reinitialising from the database");
      await sleep(5_000);
      try {
        live = new LiveEngine(live.o);
        await live.init();
      } catch (err2) {
        log.error({ err: err2 }, "reinitialisation failed");
      }
    }
    await sleep(250);
  }
  listen.release();
  lockClient.release();
  metricsServer.close();
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  log.fatal({ err }, "engine crashed");
  process.exit(1);
});
