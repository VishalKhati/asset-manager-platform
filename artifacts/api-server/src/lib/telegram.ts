/**
 * Telegram Bot API — thin wrapper around sendMessage.
 * No external packages; uses the built-in fetch API.
 */

export interface TelegramConfig {
  token:  string;
  chatId: string;
}

/**
 * Send a plain-text or Markdown message to a Telegram chat.
 * Returns true on success, false on any failure (never throws).
 */
export async function sendTelegram(cfg: TelegramConfig, text: string): Promise<boolean> {
  if (!cfg.token || !cfg.chatId) return false;
  try {
    const url = `https://api.telegram.org/bot${cfg.token}/sendMessage`;
    const res  = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: "HTML" }),
      signal:  AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
