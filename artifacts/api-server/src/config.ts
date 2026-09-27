import { z } from "zod";

/**
 * All configuration comes from environment variables, validated once at startup.
 * In production, missing or weak secrets stop the process instead of falling back to defaults.
 */

const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : v === "true" || v === "1"));

const list = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1),

  /** HMAC key for session JWTs. At least 32 characters in production. */
  JWT_SECRET: z.string().optional(),
  SESSION_HOURS: z.coerce.number().positive().max(24 * 30).default(12),
  COOKIE_SECURE: bool(false),
  REGISTRATION_ENABLED: bool(false),
  /** Extra origins allowed to call the API cross-site. Empty = same-origin only. */
  ALLOWED_ORIGINS: list,
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(300),
  LOGIN_RATE_LIMIT_PER_15MIN: z.coerce.number().int().positive().default(20),

  /** Shared secret for the MT5 feeder's HMAC signatures. Ingest is disabled when unset. */
  FEEDER_HMAC_SECRET: z.string().optional(),
  FEEDER_CLOCK_SKEW_S: z.coerce.number().int().positive().default(60),

  SYMBOL: z.string().default("XAUUSD"),
  /** shadow = record only; forward = private channel (demo forward test); live = public channel. */
  SIGNAL_MODE: z.enum(["shadow", "forward", "live"]).default("forward"),
  /** Signals decided more than this many seconds after the bar closed are recorded but never posted. */
  LATE_SIGNAL_S: z.coerce.number().int().positive().default(120),
  WARMUP_DAYS: z.coerce.number().int().positive().default(15),
  FEED_SILENT_ALERT_MIN: z.coerce.number().int().positive().default(10),
  /** Open signals are hidden from public endpoints until this many minutes after they were posted. */
  PUBLIC_DELAY_MIN: z.coerce.number().int().min(0).default(0),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TG_CHANNEL_PRIVATE_ID: z.string().optional(),
  TG_CHANNEL_PUBLIC_ID: z.string().optional(),
  TG_ADMIN_IDS: list,

  NEWS_FEED_URL: z.string().url().default("https://nfs.faireconomy.media/ff_calendar_thisweek.json"),
  NEWS_REFRESH_MIN: z.coerce.number().int().positive().default(60),

  /** Bearer token for /api/metrics. Metrics are disabled when unset. */
  METRICS_TOKEN: z.string().optional(),
  FEATURE_USER_NOTIFICATIONS: bool(false),
  PUBLIC_SITE_URL: z.string().url().optional(),
});

export type Config = z.infer<typeof schema> & { JWT_SECRET: string };

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const cfg = parsed.data;
  let secret = cfg.JWT_SECRET;
  if (cfg.NODE_ENV === "production") {
    if (!secret || secret.length < 32) throw new Error("JWT_SECRET must be set to at least 32 characters in production.");
    if (!cfg.COOKIE_SECURE) throw new Error("COOKIE_SECURE=true is required in production.");
  } else if (!secret) {
    // Development/test only: a per-process random secret. Sessions do not survive restarts.
    secret = crypto.randomUUID() + crypto.randomUUID();
  }
  return { ...cfg, JWT_SECRET: secret };
}

export const config: Config = load();
export const isProd = config.NODE_ENV === "production";
