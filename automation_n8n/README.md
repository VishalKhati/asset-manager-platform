# n8n Automation — SMC Gold Bot

Connects your deployed Replit bot to **n8n** for automated Telegram and email alerts when signals fire or trades open/close.

---

## How it works

```
[Bot API] ──(POST webhook)──> [n8n Workflow] ──> Telegram / Email
```

When the bot detects a BUY or SELL signal, it immediately POSTs to your n8n webhook URL. n8n processes the payload and sends alerts to any configured channel.

---

## Quick start

### 1. Register a webhook in the Bot API

After the bot is deployed and running, register your n8n webhook URL:

```bash
curl -X POST https://your-app.replit.app/api/bot/webhooks \
  -H "Authorization: Bearer changeme" \
  -H "Content-Type: application/json" \
  -d '{
    "url":    "https://your-n8n.app.n8n.cloud/webhook/smc-signal",
    "events": ["signal", "trade_opened", "trade_closed"],
    "name":   "n8n Alerts"
  }'
```

You can register multiple webhooks (Telegram, Discord, email, Slack, etc.).

**Manage webhooks:**
```bash
# List
GET /api/bot/webhooks

# Delete
DELETE /api/bot/webhooks/:id
```

### 2. Import the n8n workflows

1. Open your n8n instance
2. Go to **Workflows → Import**
3. Import `workflows/signal_alert.json` — handles signal alerts
4. Import `workflows/trade_monitor.json` — handles trade open/close alerts

### 3. Configure Telegram credentials in n8n

1. In n8n go to **Credentials → Add credential → Telegram**
2. Enter your `TELEGRAM_BOT_TOKEN` (from @BotFather)
3. Connect the credential to both Telegram nodes in the workflows

Get your `TELEGRAM_CHAT_ID`:
```
https://api.telegram.org/bot<TOKEN>/getUpdates
```
Then set `TELEGRAM_CHAT_ID` as an n8n environment variable.

### 4. Activate the workflows

1. Click **Activate** on each workflow
2. Copy the webhook URL from the Webhook trigger node (e.g. `https://your-n8n.app/webhook/smc-signal`)
3. Register that URL with the bot (step 1 above)

---

## Webhook payload format

### Signal event (`event: "signal"`)
```json
{
  "event":   "signal",
  "ts":      "2025-05-02T17:00:00.000Z",
  "source":  "smc-gold-bot",
  "payload": {
    "signal": {
      "signal":     "BUY",
      "confidence": 0.75,
      "mode":       "STRICT",
      "agreeing":   ["LiquiditySweep", "MAFilter"],
      "reason":     "STRICT: BUY confirmed by [MAFilter]",
      "timestamp":  "2025-05-02T17:00:00.000Z"
    },
    "price": 2644.50,
    "mas":   { "25": 2626.35, "50": 2625.28, "100": 2626.51 }
  }
}
```

### Trade opened (`event: "trade_opened"`)
```json
{
  "event":   "trade_opened",
  "payload": {
    "id":         "uuid",
    "direction":  "BUY",
    "entry":      2644.50,
    "sl":         2629.50,
    "tp":         2659.50,
    "lots":       0.01,
    "confidence": 0.75,
    "openedAt":   "2025-05-02T17:00:00.000Z"
  }
}
```

### Trade closed (`event: "trade_closed"`)
```json
{
  "event":   "trade_closed",
  "payload": {
    "id":        "uuid",
    "direction": "BUY",
    "entry":     2644.50,
    "pnl":       15.00,
    "closedAt":  "2025-05-02T18:30:00.000Z"
  }
}
```

---

## Webhook security

Optionally sign your webhooks with an HMAC-SHA256 secret:

```bash
curl -X POST .../api/bot/webhooks \
  -d '{ "url": "...", "events": ["*"], "name": "n8n", "secret": "my-secret-123" }'
```

The bot will include `X-Bot-Signature: sha256=<hmac>` in every request. Verify this in n8n using a **Code** node:

```javascript
const crypto = require('crypto');
const secret = 'my-secret-123';
const body   = JSON.stringify($input.all()[0].json);
const sig    = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
return sig === $input.all()[0].headers['x-bot-signature'];
```

---

## Other integrations

Because webhooks are plain HTTP POSTs, you can connect to any platform:

| Platform | How |
|----------|-----|
| **Discord** | Use n8n's Discord node or register a Discord webhook URL directly |
| **Slack** | n8n Slack node or Slack Incoming Webhooks URL |
| **Make (Integromat)** | Use a Make webhook URL as the registered endpoint |
| **Zapier** | Use a Zapier Catch Hook URL |
| **Custom script** | Any HTTP server that accepts POST |

---

## Files

| File | Purpose |
|------|---------|
| `workflows/signal_alert.json` | n8n workflow — signal → Telegram + email |
| `workflows/trade_monitor.json` | n8n workflow — trade opened/closed → Telegram |
| `.env.example` | Environment variable template |
