import client from "prom-client";

/** Prometheus metrics shared by the API and engine processes (each exposes its own registry). */
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const metrics = {
  httpDuration: new client.Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration",
    labelNames: ["method", "route", "status"],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [registry],
  }),
  ingestBars: new client.Counter({
    name: "ingest_bars_total",
    help: "M1 bars received from the feeder",
    labelNames: ["result"],
    registers: [registry],
  }),
  barRevisions: new client.Counter({
    name: "bar_revisions_total",
    help: "Stored bars whose prices were revised by the broker",
    registers: [registry],
  }),
  feedLastBarAge: new client.Gauge({
    name: "feed_last_bar_age_seconds",
    help: "Seconds since the close of the newest stored M1 bar",
    registers: [registry],
  }),
  engineDecisions: new client.Counter({
    name: "engine_decisions_total",
    help: "M5 evaluations by reason",
    labelNames: ["reason"],
    registers: [registry],
  }),
  signals: new client.Counter({
    name: "signals_total",
    help: "Signals created and resolved",
    labelNames: ["event"],
    registers: [registry],
  }),
  outboxPending: new client.Gauge({
    name: "outbox_pending",
    help: "Telegram messages waiting to be sent",
    registers: [registry],
  }),
  telegramErrors: new client.Counter({
    name: "telegram_errors_total",
    help: "Failed Telegram API calls",
    registers: [registry],
  }),
  sseClients: new client.Gauge({
    name: "sse_clients",
    help: "Connected server-sent-event clients",
    registers: [registry],
  }),
};
