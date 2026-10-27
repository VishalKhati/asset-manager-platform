/**
 * Telegram Bot API relay for networks that block api.telegram.org.
 *
 * Deploy as a Cloudflare Worker (free plan) with ALLOWED_BOT_ID set to the number before the ":"
 * in your bot token, either by editing the constant below (dashboard) or with
 *   npx wrangler deploy --var ALLOWED_BOT_ID:<id>
 * then set TELEGRAM_API_ROOT=https://<worker>.<you>.workers.dev on the engine.
 *
 * It forwards only Bot API method calls for that one bot, so it cannot be used as an open
 * proxy. It stores and logs nothing. The bot token still travels inside the URL, as it does
 * when calling Telegram directly, so only deploy it on an account you control.
 */

const ALLOWED_BOT_ID = "PUT_YOUR_BOT_ID_HERE";

export default {
  async fetch(request, env) {
    const allowed = env?.ALLOWED_BOT_ID || ALLOWED_BOT_ID;
    const url = new URL(request.url);
    // /bot<id>:<secret>/<method>
    const m = url.pathname.match(/^\/bot(\d+):[A-Za-z0-9_-]+\/[A-Za-z]+$/);
    if (!m || m[1] !== allowed) return new Response("Not found", { status: 404 });
    if (request.method !== "GET" && request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const headers = new Headers();
    const type = request.headers.get("content-type");
    if (type) headers.set("content-type", type);
    return fetch(`https://api.telegram.org${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === "POST" ? request.body : undefined,
    });
  },
};
