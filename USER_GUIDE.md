# SMC Gold Bot — User Guide

Smart Money Concepts (SMC) trading bot for **XAUUSD (Gold)** and **BTCUSD (Bitcoin)**.
Provides a live dashboard, signal engine, backtesting, optimizer, price alerts, and an MT5 bridge.

---

## Table of Contents

1. [What This Bot Does](#1-what-this-bot-does)
2. [Getting Started — First Login](#2-getting-started--first-login)
3. [Dashboard Overview](#3-dashboard-overview)
4. [Switching Symbols (Gold vs BTC)](#4-switching-symbols-gold-vs-btc)
5. [Bot Configuration](#5-bot-configuration)
6. [Backtesting](#6-backtesting)
7. [Optimizer](#7-optimizer)
8. [Price Alerts](#8-price-alerts)
9. [Notifications (Telegram + Email)](#9-notifications-telegram--email)
10. [MT5 Connection](#10-mt5-connection)
11. [Admin Panel](#11-admin-panel)
12. [API Reference](#12-api-reference)
13. [Architecture](#13-architecture)
14. [Security](#14-security)
15. [Deployment](#15-deployment)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. What This Bot Does

The SMC Bot analyses real-time OHLCV candle data from **Yahoo Finance** (Gold futures GC=F) and **Binance** (BTCUSDT) and applies a Smart Money Concepts signal engine consisting of six independent strategies:

| Strategy | What it detects |
|---|---|
| Liquidity Sweep | Equal highs/lows swept and reversed — institutional accumulation |
| Fair Value Gap | 3-candle imbalance — price often returns to fill the gap |
| MA Filter | Price position relative to 25/50/100-period moving averages |
| Order Block | Last opposite-direction candle before a strong move |
| Market Structure | Break of Structure (BOS) and Change of Character (CHoCH) |
| Session Filter | Restricts signals to London (08:00–17:00 UTC) and New York (13:00–22:00 UTC) sessions |

Signals are aggregated in one of three **modes**:

- **STRICT** — all enabled strategies must agree on the same direction
- **FLEX** — majority direction wins
- **WEIGHTED** — each strategy has a confidence score and weight; the weighted average must exceed a configurable threshold

---

## 2. Getting Started — First Login

### Register your account

1. Open the dashboard (your Replit preview URL or published domain).
2. Click **Register**.
3. Enter a username and a password (minimum 8 characters).
4. Click **Register** — you will be logged in automatically.

> **The first account created is automatically promoted to admin.** All subsequent accounts start as regular users with access to their own isolated bot state.

### Log in on subsequent visits

1. Enter your username and password on the Login page.
2. Your session lasts **30 days** — you stay logged in automatically.
3. If your session expires (or is revoked by an admin), you will be redirected to the login page.

### Passwords

- Minimum 8 characters.
- Stored as bcrypt hashes — never in plain text.
- If you forget your password, an admin can suspend/reactivate your account but cannot recover a password. Use the admin panel to delete and re-create the account if needed.

---

## 3. Dashboard Overview

The main dashboard has six sections:

### Header
- Current symbol badge (XAUUSD / BTCUSD) with live price.
- Bot status (Running / Stopped) and Start/Stop button.
- Signal mode badge (STRICT / FLEX / WEIGHTED).

### Live Signal Card
Shows the current signal (BUY / SELL / None), confidence score, contributing strategies, and a brief reason string.

### Live Price Chart
- 60-candle OHLCV line chart with MA25, MA50, MA100 overlays.
- BUY signals appear as green triangles, SELL signals as red triangles.
- Chart refreshes automatically every 30 seconds while the bot is running.

### Strategy Status
Visual indicators for each strategy showing enabled/disabled state and weight (for WEIGHTED mode).

### Daily P&L Chart
- 30-day bar chart: green bars for profitable days, red for losing days.
- Blue cumulative P&L line overlaid.
- Period stats: total P&L, trades, win rate.
- Use the 7d / 30d / 90d selector to change the window.

### Recent Trades
Last 10 closed trades with direction, open/close price, P&L, and outcome badge.

---

## 4. Switching Symbols (Gold vs BTC)

Click the symbol selector in the top-left sidebar:
- **XAUUSD** — Gold futures (GC=F via Yahoo Finance, 1-minute candles)
- **BTCUSD** — Bitcoin/USD (BTCUSDT via Binance, 1-minute candles)

Each symbol has its own:
- Isolated bot state (running/stopped independently)
- Trade history
- Configuration (strategies, risk parameters, mode)
- Signal and candle data

All API calls automatically append `?symbol=XAUUSD` or `?symbol=BTCUSD`.

---

## 5. Bot Configuration

Go to **Config** in the sidebar.

### Engine Settings

| Setting | Description |
|---|---|
| Mode | STRICT / FLEX / WEIGHTED signal aggregation |
| Confidence Threshold | Minimum weighted score to fire a signal (WEIGHTED mode) |
| Max Trades / Day | Resets at midnight UTC; prevents over-trading |
| Require Session | When on, only allows trades during London or New York session hours |

### Risk Settings

| Setting | Default (Gold) | Default (BTC) |
|---|---|---|
| Stop Loss | 15 pts | 500 USD |
| Take Profit | 30 pts | 1,000 USD |
| Lot size | 0.01 | 0.001 |

### Strategies

Each strategy can be toggled on/off independently. In WEIGHTED mode, each active strategy also has a numeric weight (1–5).

**Session Filter sessions**: Choose which sessions to allow — `london` and/or `new_york`.

Click **Save Config** to persist changes to the database. Changes survive server restarts.

---

## 6. Backtesting

Go to **Backtest** → **Backtest** tab.

### How it works

1. The server fetches **historical hourly candles** (60 days / ~1,100 bars for Gold; 30 days / 720 bars for BTC) from Yahoo Finance / Binance.
2. After a 110-candle warm-up (required for MA100 calculation), the signal engine runs on each remaining candle in walk-forward fashion.
3. When a signal fires, a simulated trade opens at the candle's close price using your configured SL and TP.
4. Trades close when either SL or TP is hit on a subsequent candle.
5. Equity curve, drawdown, and per-strategy stats are computed.

### Configuring a backtest

- **Mode** — STRICT / FLEX / WEIGHTED
- **Confidence threshold** — minimum score (only applies to WEIGHTED)
- **Initial equity** — starting balance for equity curve
- **Strategies** — toggle each strategy on/off for this backtest (does not affect live config)

### Results

| Metric | Description |
|---|---|
| Candle Count | Total historical bars processed |
| Total Trades | Number of completed simulated trades |
| Win Rate | % of trades that hit Take Profit |
| Net P&L | Total profit/loss in USD |
| Max Drawdown | Largest peak-to-trough equity decline |
| Profit Factor | Gross profit / gross loss (>1 = profitable) |
| Avg Confidence | Mean signal confidence across all trades |
| Equity Curve | Interactive chart showing equity and drawdown over time |

Per-strategy breakdown shows how many signals each strategy contributed and its individual win rate.

---

## 7. Optimizer

Go to **Backtest** → **Optimizer** tab.

The optimizer runs **96 combinations** of parameters automatically:
- 3 modes × 4 confidence levels × 8 strategy presets

### Strategy presets tested

| Preset | Strategies enabled |
|---|---|
| Core | LiquiditySweep + FairValueGap + MAFilter |
| Core + Session | Core + SessionFilter |
| Core + OrderBlock | Core + OrderBlock |
| Core + MarketStructure | Core + MarketStructure |
| All + No Session | All except SessionFilter |
| All Strategies | All 6 strategies |
| + 2 more variations | ... |

### Sort options

Rank results by: Profit Factor, Win Rate, Total P&L, or Total Trades.

### Applying results

Each result row has two buttons:

- **▶** — Loads the configuration into the Backtest tab and immediately re-runs the simulation. Use this to inspect the equity curve of a promising combo.
- **⚡** — **Applies the configuration to your live bot** (calls `PUT /api/bot/config`, persisted to DB). A green confirmation toast confirms the update. The Config page will reflect the new settings.

The best-configuration banner at the top has the same two buttons in larger form.

---

## 8. Price Alerts

Go to **Alerts** in the sidebar.

### Creating an alert

1. Select a symbol (XAUUSD or BTCUSD).
2. Choose condition: **Above** or **Below**.
3. Enter the target price.
4. Optionally enter a label (e.g. "Key resistance").
5. Click **+ Add Alert**.

> API field name: `targetPrice` (not `price`).

### How alerts fire

The server polls live prices every **30 seconds**. When price crosses the threshold:
- The alert is marked as triggered (shown in the table with a badge).
- A notification is sent via your configured channels (Telegram / email).
- The alert is automatically **disarmed** — it will not fire again until you rearm it.

### Rearming an alert

Click the **↺ Rearm** button next to a triggered alert to reset it so it can fire again.

### Deleting an alert

Click **✕ Delete** to permanently remove an alert.

---

## 9. Notifications (Telegram + Email)

Go to **Notifications** in the sidebar.

### Telegram setup

1. Create a Telegram bot via [@BotFather](https://t.me/botfather) — copy the bot token.
2. Find your personal chat ID: send any message to your bot, then call `https://api.telegram.org/bot<TOKEN>/getUpdates` — the `id` in the result is your chat ID.
3. Enter the token and chat ID in the Notifications page and click **Save**.
4. Click **Test Notification** to verify delivery.

### Email setup (SMTP)

Requires an SMTP server. Works with Gmail (use an App Password), Mailgun, SendGrid, etc.

| Field | Example |
|---|---|
| SMTP Host | smtp.gmail.com |
| SMTP Port | 587 |
| User | yourname@gmail.com |
| Password | your-app-password |
| From | SMC Bot \<yourname@gmail.com\> |
| To | yourname@gmail.com |

> **Gmail users:** Enable 2FA and generate an [App Password](https://support.google.com/accounts/answer/185833) — do not use your main Google password.

### Event filters

Choose which events trigger notifications:

| Event | Description |
|---|---|
| Bot Started | Bot was started by a user |
| Bot Stopped | Bot was stopped |
| Trade Opened | A new trade was registered |
| Trade Closed | A trade closed with P&L |
| Price Alert | A configured price alert fired |
| User Login | Someone logged into your account |

---

## 10. MT5 Connection

Go to **MT5 Setup** in the sidebar for a guided 5-step wizard.

### Overview

The MT5 bridge connects your MetaTrader 5 Expert Advisor (EA) to the bot API:

```
Bot API (/signal) ←── EA polls every N seconds
                  ──→ EA opens trade in MT5
                  ──→ POST /api/bot/trades  (registers trade in bot)
                  ──→ Trade closes (SL/TP hit or manual)
                  ──→ POST /api/bot/history/:id/close  (records P&L)
```

### Step 1 — Get your API token

On the MT5 Setup page, your `BOT_API_TOKEN` is displayed. This token identifies the MT5 bridge as a machine client (no username/password needed). **Keep this secret.**

If `BOT_API_TOKEN` is not set as an environment variable, the default value `changeme` is used — **change this before going live.**

### Step 2 — Configure the EA

In your MetaTrader 5 EA, set:

| Parameter | Value |
|---|---|
| API_URL | `https://your-domain/api` |
| BOT_TOKEN | Your `BOT_API_TOKEN` from Step 1 |
| SYMBOL | `XAUUSD` or `BTCUSD` |
| POLL_INTERVAL_SEC | 30 (recommended) |

### Step 3 — EA workflow

The EA should:

1. **Poll for signal**: `GET /api/bot/signal?symbol=XAUUSD` (Authorization: Bearer BOT_API_TOKEN)
2. **Check** `result.signal` — `"BUY"`, `"SELL"`, or `null`
3. **If signal**: open the trade in MT5 and register it:
   ```
   POST /api/bot/trades?symbol=XAUUSD
   { "direction": "BUY", "openPrice": 3245.50, "lots": 0.01 }
   → { "ok": true, "id": "<trade-id>" }
   ```
4. **When trade closes**: report the result:
   ```
   POST /api/bot/history/<trade-id>/close?symbol=XAUUSD
   { "closePrice": 3275.80, "pnl": 30.30 }
   ```

### Bridge heartbeat (optional)

Send periodic heartbeats so the dashboard shows bridge connection status:
```
POST /api/bot/bridge-heartbeat
Authorization: Bearer BOT_API_TOKEN
```

Check status: `GET /api/bot/bridge-status`

### Demo vs Live mode

Set `mode` in your bot config (`Config` page):
- **demo** — signals are generated and logged, no real trades
- **live** — signals are forwarded to MT5 and real positions are opened

---

## 11. Admin Panel

The admin panel is visible only to users with the **admin** role (gold avatar in sidebar).

### Overview page

- Total users, total trades, active alerts.
- Per-user status table showing bot state, symbol, trade count, and last activity.

### User management

- View all registered users.
- **Promote** a user to admin (they gain access to the Admin Panel).
- **Demote** an admin back to regular user.
- **Suspend** a user — they are immediately logged out and cannot log back in until reactivated.
- **Reactivate** a suspended user.

> Note: You cannot demote yourself. Another admin must do it.

### Audit log

Every role change, suspension, promotion, and login is recorded. The audit log shows who did what and when.

### System info

Live server stats: uptime, memory usage (RSS / heap), database latency.

### Emergency admin bootstrap

If all admins are accidentally demoted, any logged-in user can call:
```
POST /api/admin/init
Authorization: Bearer <your-jwt>
```
This self-promotes the caller to admin, but only if no admins currently exist.

---

## 12. API Reference

All routes require `Authorization: Bearer <token>` unless marked **public**.

**Two token types:**
- **JWT** — obtained from `POST /api/auth/login` or `POST /api/auth/register`. Used by human dashboard users. 30-day expiry.
- **BOT_API_TOKEN** — static secret set as an environment variable. Used by the MT5 EA / automation. Maps to a special `_system` user.

### Auth (public)

| Method | Route | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account. First user becomes admin. Returns JWT. |
| POST | `/api/auth/login` | Login. Returns JWT + user object. |
| GET | `/api/auth/me` | Returns current user profile (reads role from DB). |

### Bot

| Method | Route | Description |
|---|---|---|
| GET | `/api/bot/status?symbol=` | Bot state, last signal, trade counts |
| GET | `/api/bot/signal?symbol=` | Run SMC engine; returns signal + 60 candles |
| GET | `/api/bot/price?symbol=` | Current live price |
| GET | `/api/bot/symbols` | List supported symbols |
| POST | `/api/bot/start?symbol=` | Start bot |
| POST | `/api/bot/stop?symbol=` | Stop bot |
| GET | `/api/bot/config?symbol=` | Full bot config |
| PUT | `/api/bot/config?symbol=` | Update config (partial merge) |
| GET | `/api/bot/history?symbol=` | Trade history (last 50) |
| POST | `/api/bot/trades?symbol=` | Register a new trade (MT5 bridge) |
| POST | `/api/bot/history/:id/close?symbol=` | Close a trade with P&L |
| GET | `/api/bot/log?symbol=` | System logs (last 100, filterable by level) |
| GET | `/api/bot/pnl-daily?symbol=&days=` | Daily P&L data (7–90 days) |
| POST | `/api/bot/backtest?symbol=` | Run backtest on historical candles |
| POST | `/api/bot/optimize?symbol=` | Run optimizer (96 combos) |
| GET | `/api/bot/bridge-status` | MT5 bridge connection status |
| POST | `/api/bot/bridge-heartbeat` | MT5 bridge heartbeat (BOT_API_TOKEN only) |
| GET | `/api/bot/webhooks` | List registered webhooks |
| POST | `/api/bot/webhooks` | Register a webhook |
| DELETE | `/api/bot/webhooks/:id` | Remove a webhook |

### Notifications

| Method | Route | Description |
|---|---|---|
| GET | `/api/notifications` | Current notification settings (secrets masked) |
| PUT | `/api/notifications` | Save Telegram + email config + event filters |
| POST | `/api/notifications/test` | Send a test notification via all enabled channels |

### Alerts

| Method | Route | Description |
|---|---|---|
| GET | `/api/alerts` | List all active price alerts |
| POST | `/api/alerts` | Create a price alert (`symbol`, `condition`, `targetPrice`, `label`) |
| DELETE | `/api/alerts/:id` | Delete a price alert |
| PATCH | `/api/alerts/:id/rearm` | Rearm a triggered alert |

### Admin (admin role required)

| Method | Route | Description |
|---|---|---|
| GET | `/api/admin/overview` | System stats + per-user bot status |
| GET | `/api/admin/users` | All registered users |
| PATCH | `/api/admin/users/:id` | Update role or active state |
| POST | `/api/admin/init` | Emergency admin bootstrap |
| GET | `/api/admin/audit` | Recent audit log entries |
| GET | `/api/admin/system` | Server uptime + memory + DB latency |

### Health

| Method | Route | Description |
|---|---|---|
| GET | `/api/healthz` | Health check with DB ping, uptime, version |

### Backtest request body

```json
POST /api/bot/backtest?symbol=XAUUSD
{
  "initialEquity": 10000,
  "config": {
    "engine": {
      "mode": "WEIGHTED",
      "minConfidence": 0.4
    },
    "strategies": {
      "liquiditySweep":  { "enabled": true },
      "fairValueGap":    { "enabled": true },
      "maFilter":        { "enabled": true },
      "orderBlock":      { "enabled": true },
      "marketStructure": { "enabled": false },
      "sessionFilter":   { "enabled": true }
    }
  }
}
```

### Config update body

```json
PUT /api/bot/config?symbol=XAUUSD
{
  "engine": {
    "mode": "WEIGHTED",
    "minConfidence": 0.35,
    "weightThreshold": 0.35,
    "maxTradesPerDay": 5
  },
  "risk": {
    "sl": 15,
    "tp": 30,
    "lots": 0.01
  },
  "strategies": {
    "maFilter": { "enabled": true, "weight": 3 },
    "sessionFilter": { "enabled": false }
  }
}
```

---

## 13. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      PNPM Monorepo                          │
│                                                             │
│  artifacts/dashboard  ──→  Vue 3 + Vite + Tailwind          │
│       (port from $PORT, path: /)                            │
│                                                             │
│  artifacts/api-server ──→  Express 5 + TypeScript + esbuild │
│       (port from $PORT, path: /api)                         │
│                                                             │
│  lib/db               ──→  Drizzle ORM + PostgreSQL schema  │
│  lib/api-zod          ──→  Zod validation schemas           │
└─────────────────────────────────────────────────────────────┘
```

### Data flow — live signal

```
Browser (30s poll) → GET /api/bot/signal
  → fetchCandles() (Yahoo Finance / Binance, 30s cache)
  → evaluate(candles, config)
    → runLiquiditySweep()
    → runFVG()
    → runMAFilter()
    → runOrderBlock()
    → runMarketStructure()
    → runSessionFilter(candleTimeSec)   ← uses candle's UTC hour
    → aggregate by mode (STRICT|FLEX|WEIGHTED)
  → SignalResult { signal, confidence, agreeing, reason }
  ← response includes candles[] for chart rendering
```

### Data flow — backtest

```
POST /api/bot/backtest
  → fetchHistoricalCandles()  (hourly, ~720–1100 bars)
  → runBacktest(candles, mergedConfig, initialEquity)
    → warm-up 110 candles (for MA100)
    → for each remaining candle:
        evaluate(slice, config, candle.time)  ← historical timestamp
        if signal → open simulated trade
        else check SL/TP hit on open trade
  → BacktestResult { trades[], stats, equityCurve[], strategyStats }
```

### State model

Each user × symbol combination has an independent `SymbolState`:
- `running` / `mode` / `config` — in-memory (fast) + persisted to `bot_status` / `bot_config`
- `trades[]` / `logs[]` — in-memory (last 50/500) + persisted to `bot_trades` / `bot_logs`

State is hydrated from the database on server start, so no data is lost on restart.

### Database tables

| Table | Purpose |
|---|---|
| `users` | Accounts: id, username, email, passwordHash, role, active, createdAt |
| `bot_status` | Per (user, symbol): running, mode, tradesToday, startedAt |
| `bot_config` | Per (user, symbol): full JSON config blob |
| `bot_trades` | All trades: direction, openPrice, closePrice, pnl, symbol, userId |
| `bot_logs` | System log entries with level, message, timestamp |
| `bot_webhooks` | Registered webhook URLs with event filters |
| `notification_settings` | Per-user Telegram + SMTP configuration |
| `price_alerts` | Per-user price alerts with symbol, condition, target, active flag |
| `audit_logs` | Admin audit trail: actorId, action, targetId, details |

---

## 14. Security

| Feature | Detail |
|---|---|
| Password hashing | bcrypt (cost factor 12) |
| JWT signing | HS256, `SESSION_SECRET` env var (Replit-managed secret) |
| Role verification | Role is read from DB on every request — JWT does not cache role |
| Account suspension | `requireAuth` middleware checks `active = true` on every request |
| Rate limiting | Auth routes: 30 req / 15 min. Global API: 300 req / min |
| CORS | Open in development; restricted to `REPLIT_DOMAINS` in production |
| Helmet | Sets 11 security headers (X-Frame-Options, HSTS, CSP, etc.) |
| Request body limit | 256 KB max |
| Machine auth | `BOT_API_TOKEN` kept server-side; never sent to the browser |
| Webhook HMAC | Optional `secret` per webhook for HMAC-SHA256 payload signing |
| Supply chain | `minimumReleaseAge: 1440` in pnpm workspace — packages must be 1 day old before install |

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (managed by Replit) |
| `SESSION_SECRET` | Yes | JWT signing key (managed by Replit secrets) |
| `BOT_API_TOKEN` | Recommended | Static token for MT5 bridge machine auth |
| `PORT` | Auto | Set by Replit per artifact; do not hardcode |

---

## 15. Deployment

### Publish on Replit

1. Click **Deploy** in the Replit toolbar (or use the Publish button).
2. Replit handles TLS, health checks, and `REPLIT_DOMAINS` assignment automatically.
3. The dashboard will be accessible at `https://your-app.replit.app`.
4. The API will be at `https://your-app.replit.app/api`.

### Post-deployment checklist

- [ ] Ensure `SESSION_SECRET` is set as a Replit secret.
- [ ] Set `BOT_API_TOKEN` as a Replit secret (change the default `changeme` value).
- [ ] Register your first account — it will automatically become admin.
- [ ] Configure Telegram / email notifications if desired.
- [ ] Create price alerts for your key levels.
- [ ] Run the optimizer to find the best config for current market conditions.
- [ ] Apply the best config to the live bot with ⚡ Apply to Live Bot.
- [ ] Configure your MT5 EA with the published API URL and your BOT_API_TOKEN.

### Scaling

The bot uses an in-memory + database hybrid state model:
- Each server instance has its own in-memory state, hydrated from PostgreSQL on startup.
- Horizontal scaling (multiple instances) is **not** currently supported without a shared cache layer (e.g. Redis for in-memory state sync).
- For single-server deployments (standard Replit reserved VMs), the current architecture is production-ready.

---

## 16. Troubleshooting

### "0 trades" in backtest

- This is expected when the confidence threshold is too high or strategies are too restrictive.
- Try **FLEX** mode with only **MAFilter + FairValueGap** enabled as a baseline.
- Use the **Optimizer** to find a combination that produces trades on the current candle data.
- If session filter is on, it restricts to London/NY hours — disable it to see if that's the blocker.

### Live signal says "null"

- The signal engine evaluates the last candle of the fetched window. If no strategy conditions are met, the signal is null — this is correct behaviour, not a bug.
- The bot only signals when all conditions align. Low-signal periods are normal.

### MT5 bridge not connecting

- Verify `BOT_API_TOKEN` matches on both sides.
- Test manually: `curl -H "Authorization: Bearer YOUR_TOKEN" https://your-domain/api/bot/status?symbol=XAUUSD`
- Check the MT5 Setup page for the bridge connection status indicator.
- Ensure your EA is sending the `Authorization: Bearer` header, not a query parameter.

### Price chart not loading

- The dashboard polls `/api/bot/signal` which fetches live candles. If Yahoo Finance or Binance is temporarily unavailable, the server falls back to realistic mock data.
- Check the system logs (Logs page) for any "fetch failed" messages.

### Email notifications not sending

- Gmail requires an **App Password** (not your regular Gmail password).
- Ensure port 587 (STARTTLS) is used, not 465 (SSL directly).
- Click **Test Notification** to see the exact error in the system logs.

### Session expired / auto-logged-out

- JWT sessions last 30 days. If you were inactive for longer, log in again.
- If an admin suspended your account, contact the admin to reactivate it.
- If the server was redeployed with a new `SESSION_SECRET`, all existing JWTs are invalidated — all users must log in again.

---

*SMC Gold Bot — built on Express 5 + Vue 3 + Drizzle ORM + PostgreSQL*
