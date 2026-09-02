/**
 * Price Alert Checker — background job that polls live prices every 30 s
 * and fires per-user Telegram/email notifications when a threshold is crossed.
 *
 * Design:
 *  - Single interval, shared across the process.
 *  - Only loads active alerts from DB. After triggering, marks `active = false`
 *    and records `triggered_at` so the user can re-arm it from the dashboard.
 *  - All DB/network errors are swallowed to keep the process alive.
 */

import { db }               from "@workspace/db";
import { priceAlertsTable } from "@workspace/db/schema";
import { eq, and }          from "drizzle-orm";
import { fetchCurrentPrice } from "./priceService.js";
import { notifyUser }        from "./notificationService.js";
import { logger }            from "./logger.js";

const POLL_MS   = 30_000;
const SYMBOLS   = ["XAUUSD", "BTCUSD"] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(price: number, symbol: string): string {
  return symbol === "BTCUSD"
    ? price.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : price.toFixed(2);
}

// ─── Main tick ───────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  // Fetch prices for all symbols in parallel
  const prices = await Promise.all(
    SYMBOLS.map(sym => fetchCurrentPrice(sym).then(p => ({ sym, p }))),
  );
  const priceMap: Record<string, number> = {};
  for (const { sym, p } of prices) {
    if (p != null) priceMap[sym] = p;
  }

  if (Object.keys(priceMap).length === 0) return;

  // Load all active alerts
  let alerts;
  try {
    alerts = await db
      .select()
      .from(priceAlertsTable)
      .where(eq(priceAlertsTable.active, true));
  } catch (err) {
    logger.warn({ err }, "alertChecker: failed to load alerts");
    return;
  }

  if (!alerts.length) return;

  for (const alert of alerts) {
    const currentPrice = priceMap[alert.symbol.toUpperCase()];
    if (currentPrice == null) continue;

    const target = parseFloat(String(alert.targetPrice));
    const fired  =
      (alert.condition === "above" && currentPrice >= target) ||
      (alert.condition === "below" && currentPrice <= target);

    if (!fired) continue;

    // Mark as triggered first to avoid double-fire on concurrent ticks
    try {
      await db
        .update(priceAlertsTable)
        .set({ active: false, triggeredAt: new Date() })
        .where(and(eq(priceAlertsTable.id, alert.id), eq(priceAlertsTable.active, true)));
    } catch (err) {
      logger.warn({ err, alertId: alert.id }, "alertChecker: failed to mark alert triggered");
      continue;
    }

    const symbol   = alert.symbol.toUpperCase();
    const arrow    = alert.condition === "above" ? "↑" : "↓";
    const icon     = alert.condition === "above" ? "📈" : "📉";
    const labelStr = alert.label ? ` — <i>${alert.label}</i>` : "";

    notifyUser(alert.userId, "price_alert", {
      symbol,
      currentPrice,
      targetPrice:  target,
      condition:    alert.condition,
      label:        alert.label ?? null,
      message:      `${icon} <b>PRICE ALERT</b> [${symbol}]${labelStr}\nPrice ${arrow} <b>${fmt(currentPrice, symbol)}</b> crossed target <b>${fmt(target, symbol)}</b>`,
    }).catch(() => {});

    logger.info(
      { userId: alert.userId, symbol, condition: alert.condition, target, currentPrice },
      "alertChecker: price alert triggered",
    );
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let handle: ReturnType<typeof setInterval> | null = null;

export function startAlertChecker(): void {
  if (handle) return;
  logger.info("alertChecker: starting (interval 30 s)");
  handle = setInterval(() => { tick().catch(() => {}); }, POLL_MS);
  handle.unref(); // don't prevent graceful shutdown
}

export function stopAlertChecker(): void {
  if (handle) { clearInterval(handle); handle = null; }
}
