/**
 * Per-user notification service.
 *
 * Loads settings from DB, caches for 60 s, then fires Telegram / email
 * for subscribed events. All sends are fire-and-forget — failures are
 * silently swallowed so they never affect the trading flow.
 *
 * Supported events:
 *   signal | trade_opened | trade_closed | bot_started | bot_stopped | user.login
 */

import { db }            from "@workspace/db";
import { notificationSettingsTable } from "@workspace/db/schema";
import { eq }            from "drizzle-orm";
import { sendTelegram }  from "./telegram.js";
import { sendEmail }     from "./emailer.js";
import { logger }        from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotificationSettings {
  telegramEnabled: boolean;
  telegramToken:   string | null;
  telegramChatId:  string | null;
  emailEnabled:    boolean;
  emailTo:         string | null;
  smtpHost:        string | null;
  smtpPort:        number;
  smtpUser:        string | null;
  smtpPass:        string | null;
  events:          string[];
}

// ─── Settings cache (60 s TTL) ────────────────────────────────────────────────

interface CacheEntry { settings: NotificationSettings; expiresAt: number }
const cache = new Map<string, CacheEntry>();

async function getSettings(userId: string): Promise<NotificationSettings | null> {
  const now = Date.now();
  const hit  = cache.get(userId);
  if (hit && hit.expiresAt > now) return hit.settings;

  try {
    const [row] = await db
      .select()
      .from(notificationSettingsTable)
      .where(eq(notificationSettingsTable.userId, userId));

    if (!row) return null;

    const settings: NotificationSettings = {
      telegramEnabled: row.telegramEnabled,
      telegramToken:   row.telegramToken,
      telegramChatId:  row.telegramChatId,
      emailEnabled:    row.emailEnabled,
      emailTo:         row.emailTo,
      smtpHost:        row.smtpHost,
      smtpPort:        row.smtpPort ?? 587,
      smtpUser:        row.smtpUser,
      smtpPass:        row.smtpPass,
      events:          (row.events as string[]) ?? [],
    };
    cache.set(userId, { settings, expiresAt: now + 60_000 });
    return settings;
  } catch {
    return null;
  }
}

/** Invalidate the cache for a user when settings are saved. */
export function invalidateCache(userId: string): void {
  cache.delete(userId);
}

// ─── Message formatters ───────────────────────────────────────────────────────

function formatTelegram(event: string, payload: Record<string, unknown>): string {
  switch (event) {
    case "signal": {
      const s  = (payload["signal"] as Record<string,unknown>) ?? {};
      const dir = String(s["signal"] ?? "");
      const sym = String(payload["symbol"] ?? "");
      const px  = payload["price"] != null ? ` @ <b>${Number(payload["price"]).toFixed(2)}</b>` : "";
      const conf = s["confidence"] != null ? ` | Confidence: ${Math.round(Number(s["confidence"]) * 100)}%` : "";
      const icon = dir === "BUY" ? "📈" : dir === "SELL" ? "📉" : "🔔";
      return `${icon} <b>SIGNAL</b> [${sym}] <b>${dir}</b>${px}${conf}`;
    }
    case "trade_opened": {
      const sym = String(payload["symbol"] ?? "");
      const dir = String(payload["direction"] ?? "");
      const ent = Number(payload["entry"] ?? 0).toFixed(2);
      const sl  = Number(payload["sl"] ?? 0).toFixed(2);
      const tp  = Number(payload["tp"] ?? 0).toFixed(2);
      return `📂 <b>TRADE OPENED</b> [${sym}] <b>${dir}</b> @ ${ent}\nSL: ${sl} | TP: ${tp}`;
    }
    case "trade_closed": {
      const sym = String(payload["symbol"] ?? "");
      const dir = String(payload["direction"] ?? "");
      const pnl = Number(payload["pnl"] ?? 0);
      const icon = pnl >= 0 ? "✅" : "❌";
      const sign = pnl >= 0 ? "+" : "";
      return `${icon} <b>TRADE CLOSED</b> [${sym}] ${dir} | P&amp;L: <b>${sign}${pnl.toFixed(2)}</b>`;
    }
    case "bot_started":
      return `🚀 <b>BOT STARTED</b> [${payload["symbol"]}] Mode: ${payload["mode"]}`;
    case "bot_stopped":
      return `🛑 <b>BOT STOPPED</b> [${payload["symbol"]}]`;
    case "user.login":
      return `🔐 <b>Login</b> — ${String(payload["username"] ?? "")} just logged in.`;
    case "price_alert": {
      const msg = payload["message"];
      if (typeof msg === "string") return msg;
      const sym  = String(payload["symbol"] ?? "");
      const cond = String(payload["condition"] ?? "");
      const cur  = Number(payload["currentPrice"] ?? 0);
      const tgt  = Number(payload["targetPrice"] ?? 0);
      const icon = cond === "above" ? "📈" : "📉";
      return `${icon} <b>PRICE ALERT</b> [${sym}]\nPrice hit <b>${cur.toFixed(2)}</b> (target: ${tgt.toFixed(2)})`;
    }
    default:
      return `🤖 <b>SMC Bot</b>: ${event}`;
  }
}

function formatEmailSubject(event: string, payload: Record<string, unknown>): string {
  switch (event) {
    case "signal":       return `SMC Bot — Signal: ${payload["symbol"]} ${(payload["signal"] as Record<string,unknown>)?.["signal"]}`;
    case "trade_opened": return `SMC Bot — Trade Opened: ${payload["symbol"]} ${payload["direction"]}`;
    case "trade_closed": return `SMC Bot — Trade Closed: ${payload["symbol"]} P&L ${Number(payload["pnl"] ?? 0).toFixed(2)}`;
    case "bot_started":  return `SMC Bot — Bot Started [${payload["symbol"]}]`;
    case "bot_stopped":  return `SMC Bot — Bot Stopped [${payload["symbol"]}]`;
    case "user.login":   return `SMC Bot — New Login`;
    case "price_alert":  return `SMC Bot — Price Alert [${payload["symbol"]}]`;
    default:             return `SMC Bot — ${event}`;
  }
}

function formatEmailHtml(event: string, payload: Record<string, unknown>): string {
  const body = formatTelegram(event, payload)
    .replace(/<b>/g, "<strong>").replace(/<\/b>/g, "</strong>")
    .replace(/<br>/g, "<br/>").replace(/&amp;/g, "&");

  return `
    <div style="font-family:sans-serif;max-width:480px;padding:24px;background:#0d1117;color:#e6edf3;border-radius:12px">
      <div style="font-size:13px;font-weight:600;color:#7d8590;margin-bottom:16px">SMC Gold Bot Notification</div>
      <div style="font-size:15px;line-height:1.6">${body}</div>
      <hr style="border:none;border-top:1px solid #21262d;margin:20px 0"/>
      <div style="font-size:11px;color:#7d8590">${new Date().toUTCString()}</div>
    </div>`;
}

// ─── Main dispatch ─────────────────────────────────────────────────────────────

export async function notifyUser(
  userId:   string,
  event:    string,
  payload:  Record<string, unknown>,
): Promise<void> {
  let settings: NotificationSettings | null;
  try {
    settings = await getSettings(userId);
  } catch {
    return;
  }
  if (!settings) return;
  // price_alert is always allowed (it's user-created; no event-toggle required)
  if (event !== "price_alert" && !settings.events.includes(event) && !settings.events.includes("*")) return;

  const tgText   = formatTelegram(event, payload);
  const emailSub = formatEmailSubject(event, payload);
  const emailHtml = formatEmailHtml(event, payload);

  const tasks: Promise<unknown>[] = [];

  if (settings.telegramEnabled && settings.telegramToken && settings.telegramChatId) {
    tasks.push(
      sendTelegram({ token: settings.telegramToken, chatId: settings.telegramChatId }, tgText)
        .then(ok => { if (!ok) logger.warn({ userId, event }, "Telegram send failed"); })
    );
  }

  if (settings.emailEnabled && settings.emailTo && settings.smtpHost && settings.smtpUser && settings.smtpPass) {
    tasks.push(
      sendEmail(
        { host: settings.smtpHost, port: settings.smtpPort, user: settings.smtpUser, pass: settings.smtpPass, to: settings.emailTo },
        emailSub, emailHtml,
      ).then(ok => { if (!ok) logger.warn({ userId, event }, "Email send failed"); })
    );
  }

  await Promise.allSettled(tasks);
}
