import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors       from "cors";
import helmet     from "helmet";
import pinoHttp   from "pino-http";
import { rateLimit } from "express-rate-limit";
import router     from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();
const isProd = process.env["NODE_ENV"] === "production";

// ─── Security headers ─────────────────────────────────────────────────────────

app.use(
  helmet({
    contentSecurityPolicy: false, // handled by the SPA; would break the API otherwise
    crossOriginEmbedderPolicy: false,
  }),
);

// ─── CORS ─────────────────────────────────────────────────────────────────────

const rawDomains = process.env["REPLIT_DOMAINS"] ?? "";
const prodOrigins = rawDomains
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean)
  .flatMap((d) => [`https://${d}`, `http://${d}`]);

app.use(
  cors({
    origin: isProd && prodOrigins.length > 0
      ? (origin, cb) => {
          if (!origin || prodOrigins.includes(origin)) cb(null, true);
          else cb(new Error(`CORS: origin not allowed — ${origin}`));
        }
      : "*",
    methods:      ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// ─── Logging ──────────────────────────────────────────────────────────────────

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ─── Body parsing ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true, limit: "256kb" }));

// ─── Rate limiting ────────────────────────────────────────────────────────────

// Strict limiter for authentication endpoints — prevents brute-force
const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000, // 15 minutes
  max:             30,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { ok: false, error: "Too many requests — please try again in 15 minutes." },
  skip: () => !isProd,
});

// General limiter for all other API routes
const apiLimiter = rateLimit({
  windowMs:        60 * 1000, // 1 minute
  max:             300,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { ok: false, error: "Rate limit exceeded — slow down." },
  skip: () => !isProd,
});

app.use("/api/auth", authLimiter);
app.use("/api",      apiLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use("/api", router);

// ─── 404 handler ─────────────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: "Not found." });
});

// ─── Global error handler ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  req.log?.error({ err }, "Unhandled error");
  res.status(500).json({
    ok:    false,
    error: isProd ? "Internal server error." : (err.message ?? "Unknown error"),
  });
});

export default app;
