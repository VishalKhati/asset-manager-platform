/** API process entrypoint: HTTP + server-sent events. The engine runs as a separate process. */

import http from "node:http";
import { pool } from "@workspace/db";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { SseHub } from "./realtime/sse.js";
import { publicModes, publicOpenDelayMin } from "./routes/public.js";

const sse = new SseHub({ symbol: config.SYMBOL, modes: publicModes(), publicDelayMin: publicOpenDelayMin() }, logger);
await sse.start();

const server = http.createServer(createApp({ sse }));
server.listen(config.PORT, () => logger.info({ port: config.PORT, mode: config.SIGNAL_MODE }, "API listening"));

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  setTimeout(() => process.exit(1), 10_000).unref();
  void sse.stop().finally(() =>
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    }),
  );
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => logger.error({ reason }, "unhandled promise rejection"));
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception");
  process.exit(1);
});
