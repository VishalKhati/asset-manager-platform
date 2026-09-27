import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

/**
 * Authenticates the MT5 feeder. Each request carries:
 *   X-Feeder-Id:  feeder name (free text, recorded for monitoring)
 *   X-Timestamp:  unix seconds; rejected if outside ±FEEDER_CLOCK_SKEW_S
 *   X-Signature:  hex HMAC-SHA256(FEEDER_HMAC_SECRET, `${timestamp}\n${raw body}`)
 * Feeder credentials only work on /api/ingest/* and never map to a user.
 */
export function signFeederRequest(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}\n${body}`).digest("hex");
}

export function feederAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = config.FEEDER_HMAC_SECRET;
  if (!secret) {
    res.status(503).json({ ok: false, error: "Ingest is disabled (FEEDER_HMAC_SECRET not set)." });
    return;
  }
  const feederId = String(req.headers["x-feeder-id"] ?? "");
  const ts = Number(req.headers["x-timestamp"]);
  const sig = String(req.headers["x-signature"] ?? "");
  if (!/^[\w.-]{1,64}$/.test(feederId) || !Number.isInteger(ts) || !/^[0-9a-f]{64}$/.test(sig)) {
    res.status(401).json({ ok: false, error: "Missing or malformed feeder signature headers." });
    return;
  }
  if (Math.abs(Date.now() / 1000 - ts) > config.FEEDER_CLOCK_SKEW_S) {
    res.status(401).json({ ok: false, error: "Timestamp outside the allowed clock skew." });
    return;
  }
  const expected = Buffer.from(signFeederRequest(secret, ts, req.rawBody?.toString("utf8") ?? ""), "hex");
  const given = Buffer.from(sig, "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    res.status(401).json({ ok: false, error: "Bad signature." });
    return;
  }
  res.locals["feederId"] = feederId;
  next();
}
