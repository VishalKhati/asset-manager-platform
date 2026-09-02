/**
 * Outbound notification service.
 * Fires registered webhook URLs when bot events occur.
 *
 * Events: signal | trade_opened | trade_closed | bot_started | bot_stopped
 */

import crypto from "crypto";

export interface WebhookReg {
  id:          string;
  name:        string;
  url:         string;
  events:      string[];
  secret?:     string;
  createdAt:   string;
  lastFired?:  string;
  lastStatus?: number;
}

class Notifier {
  private hooks: WebhookReg[] = [];

  // ─── Registration ─────────────────────────────────────────────────

  register(url: string, events: string[], name: string, secret?: string): WebhookReg {
    const reg: WebhookReg = {
      id:        crypto.randomUUID(),
      name,
      url,
      events,
      secret,
      createdAt: new Date().toISOString(),
    };
    this.hooks.push(reg);
    return reg;
  }

  /** Re-registers a webhook loaded from the database (preserves original ID). */
  registerFromDb(reg: WebhookReg): void {
    if (!this.hooks.find(h => h.id === reg.id)) {
      this.hooks.push(reg);
    }
  }

  unregister(id: string): boolean {
    const before = this.hooks.length;
    this.hooks = this.hooks.filter(h => h.id !== id);
    return this.hooks.length < before;
  }

  list(): WebhookReg[] {
    return this.hooks;
  }

  // ─── Firing ───────────────────────────────────────────────────────

  async fire(event: string, payload: unknown): Promise<void> {
    const targets = this.hooks.filter(h => h.events.includes("*") || h.events.includes(event));
    if (!targets.length) return;

    const body = JSON.stringify({
      event,
      ts:      new Date().toISOString(),
      source:  "smc-gold-bot",
      payload,
    });

    await Promise.allSettled(targets.map(h => this._send(h, event, body)));
  }

  private async _send(hook: WebhookReg, event: string, body: string): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent":   "SMC-Gold-Bot/1.0",
      "X-Bot-Event":  event,
    };

    if (hook.secret) {
      const sig = crypto.createHmac("sha256", hook.secret).update(body).digest("hex");
      headers["X-Bot-Signature"] = `sha256=${sig}`;
    }

    try {
      const res = await fetch(hook.url, { method: "POST", headers, body, signal: AbortSignal.timeout(8_000) });
      hook.lastFired  = new Date().toISOString();
      hook.lastStatus = res.status;
    } catch {
      hook.lastFired  = new Date().toISOString();
      hook.lastStatus = 0;
    }
  }
}

export const notifier = new Notifier();
