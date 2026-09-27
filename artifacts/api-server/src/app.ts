import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { rateLimit } from "express-rate-limit";
import { config, isProd } from "./config.js";
import { logger } from "./lib/logger.js";
import { metrics, registry } from "./lib/metrics.js";
import { csrfGuard } from "./middlewares/auth.js";
import healthRouter from "./routes/health.js";
import authRouter from "./routes/auth.js";
import adminRouter from "./routes/admin.js";
import alertsRouter from "./routes/alerts.js";
import notificationsRouter from "./routes/notifications.js";
import ingestRouter from "./routes/ingest.js";
import publicRouter from "./routes/public.js";
import operatorRouter from "./routes/operator.js";
import type { SseHub } from "./realtime/sse.js";
import { requireAuth } from "./middlewares/auth.js";

export function createApp(opts: { sse?: SseHub } = {}): Express {
  const app = express();
  app.set("trust proxy", config.TRUST_PROXY);
  app.disable("x-powered-by");

  // The API serves JSON only; the SPA's CSP is set by the web server (Caddy).
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

  // Same-origin by default (Caddy serves the SPA and proxies /api). Extra origins are opt-in.
  if (config.ALLOWED_ORIGINS.length) {
    app.use(
      cors({
        origin: (origin, cb) => cb(null, !origin || config.ALLOWED_ORIGINS.includes(origin)),
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
      }),
    );
  }

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === "/api/healthz" || req.url?.startsWith("/api/metrics") === true },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url?.split("?")[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use((req, res, next) => {
    const end = metrics.httpDuration.startTimer();
    res.on("finish", () => end({ method: req.method, route: (req.route?.path as string | undefined) ?? "unmatched", status: String(res.statusCode) }));
    next();
  });

  // Keep the raw body: the feeder's HMAC signature covers the exact bytes sent.
  app.use(
    express.json({
      limit: "2mb",
      verify: (req, _res, buf) => {
        (req as Request).rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());
  app.use(csrfGuard);

  const limiter = (windowMs: number, max: number, message: string) =>
    rateLimit({ windowMs, limit: max, standardHeaders: "draft-7", legacyHeaders: false, message: { ok: false, error: message } });
  app.use("/api/auth/login", limiter(15 * 60_000, config.LOGIN_RATE_LIMIT_PER_15MIN, "Too many sign-in attempts. Try again in 15 minutes."));
  app.use("/api", limiter(60_000, config.RATE_LIMIT_PER_MIN, "Too many requests. Slow down."));

  app.get("/api/metrics", async (req, res) => {
    if (!config.METRICS_TOKEN || req.headers.authorization !== `Bearer ${config.METRICS_TOKEN}`) {
      res.status(404).json({ ok: false, error: "Not found." });
      return;
    }
    res.setHeader("Content-Type", registry.contentType);
    res.end(await registry.metrics());
  });

  app.use("/api", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/alerts", alertsRouter);
  if (config.FEATURE_USER_NOTIFICATIONS) app.use("/api/notifications", notificationsRouter);
  app.use("/api/ingest", ingestRouter);
  app.use("/api/public", publicRouter);
  if (opts.sse) {
    app.get("/api/public/stream", opts.sse.handler(true));
    app.get("/api/stream", requireAuth, opts.sse.handler(false));
  }
  app.use("/api", operatorRouter);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ ok: false, error: "Not found." });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error & { status?: number; type?: string }, req: Request, res: Response, _next: NextFunction) => {
    if (err.type === "entity.parse.failed") {
      res.status(400).json({ ok: false, error: "Malformed JSON body." });
      return;
    }
    if (err.type === "entity.too.large") {
      res.status(413).json({ ok: false, error: "Request body too large." });
      return;
    }
    req.log?.error({ err }, "unhandled error");
    res.status(500).json({ ok: false, error: isProd ? "Internal server error." : err.message });
  });

  return app;
}
