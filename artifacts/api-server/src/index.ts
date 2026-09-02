import http                  from "node:http";
import app                   from "./app.js";
import { logger }            from "./lib/logger.js";
import { hydrateFromDb }     from "./lib/hydrate.js";
import { startAlertChecker, stopAlertChecker } from "./lib/alertChecker.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Hydrate in-memory state from the database before accepting requests.
await hydrateFromDb();

// Start background price alert checker (polls every 30 s).
startAlertChecker();

const server = http.createServer(app);

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

const SHUTDOWN_TIMEOUT_MS = 10_000;

function shutdown(signal: string): void {
  logger.info({ signal }, "Shutdown signal received — closing server");
  stopAlertChecker();
  server.close((err) => {
    if (err) {
      logger.error({ err }, "Error during server close");
      process.exit(1);
    }
    logger.info("HTTP server closed cleanly");
    process.exit(0);
  });

  // Force-kill if graceful close takes too long
  setTimeout(() => {
    logger.warn("Graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// ─── Unhandled rejections / exceptions ───────────────────────────────────────

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — exiting");
  process.exit(1);
});
