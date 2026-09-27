> **Outdated: describes the old prototype.** This file is kept only until the Phase 0 cleanup deletes it (see [PLAN.md](PLAN.md)). The current system is documented in `README.md` and `docs/`.

# SMC Bot — Workspace

## Overview

pnpm workspace monorepo. Smart Money Concept (SMC) trading bot for XAUUSD (Gold) and BTCUSD (Bitcoin) with live dashboard, strategy engine, backtesting/optimizer, MT5 bridge, price alerts, and notifications. Multi-user, production-ready.

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 24 / TypeScript 5.9
- **API**: Express 5 + esbuild
- **Frontend**: Vue 3 + Vite + Pinia + Tailwind CSS + Chart.js
- **Database**: PostgreSQL (Replit managed) + Drizzle ORM
- **State**: Hybrid — in-memory cache (fast reads) + PostgreSQL persistence (survives restarts)

## Artifacts

| Artifact | Path | Description |
|---|---|---|
| `artifacts/api-server` | `/api` | Express 5 REST API + SMC signal engine |
| `artifacts/dashboard` | `/` | Vue 3 live dashboard (Gold + BTC) |

## Supported Symbols

| Symbol | Price Source | Default SL/TP | Lots |
|---|---|---|---|
| XAUUSD | Yahoo Finance (GC=F, hourly) | 15 / 30 pts | 0.01 |
| BTCUSD | Binance REST (BTCUSDT, hourly) | 500 / 1000 USD | 0.001 |

Live candles: 1-minute (Yahoo Finance) and 1-minute (Binance) — signal engine uses most recent 60-candle window.
Historical candles for backtesting: ~1,122 hourly bars (Gold) / 720 hourly bars (BTC).

## Multi-Symbol Architecture

All `/api/bot/*` routes accept `?symbol=XAUUSD` or `?symbol=BTCUSD`.
Each user × symbol has an independent `SymbolState` (running, config, trades, logs, signal).
The dashboard switches symbols via sidebar tabs — Pinia store `activeSymbol` drives all API calls.

## SMC Strategies

| Strategy | Description |
|---|---|
| LiquiditySweep | Equal highs/lows swept and reversed |
| FairValueGap | 3-candle OHLCV imbalance |
| MAFilter | Price relative to MA25/50/100 |
| OrderBlock | Last opposite candle before a strong impulse |
| MarketStructure | BOS / CHoCH detection |
| SessionFilter | London (08–17 UTC) + New York (13–22 UTC) filter |

Signal modes: **STRICT** (all agree) | **FLEX** (majority) | **WEIGHTED** (weighted average ≥ threshold)

## Auth & Role System

- First registered user → `admin` role automatically
- All subsequent users → `user` role
- Admin can promote/demote users, suspend/reactivate accounts
- JWT does **not** cache role — role is re-read from DB on every authenticated request
- `POST /api/admin/init` — emergency bootstrap: self-promotes caller to admin if none exist
- Two auth token types:
  - **JWT** — human users, 30-day expiry, from `POST /api/auth/login`
  - **BOT_API_TOKEN** — machine auth for MT5 bridge, static env var, maps to `_system` user

## Key API Endpoints

### Bot (all require JWT or BOT_API_TOKEN)

| Method | Route | Notes |
|---|---|---|
| GET | `/api/bot/status?symbol=` | Running state, last signal, trade counts |
| GET | `/api/bot/signal?symbol=` | Run SMC engine, returns signal + 60 candles |
| GET | `/api/bot/price?symbol=` | Live price |
| GET | `/api/bot/symbols` | List of supported symbols |
| POST | `/api/bot/start?symbol=` | Start bot |
| POST | `/api/bot/stop?symbol=` | Stop bot |
| GET/PUT | `/api/bot/config?symbol=` | Get / update config (partial merge) |
| GET | `/api/bot/history?symbol=` | Last 50 trades |
| POST | `/api/bot/trades?symbol=` | MT5 bridge: register a new trade |
| POST | `/api/bot/history/:id/close?symbol=` | Close trade with P&L |
| GET | `/api/bot/log?symbol=` | System logs (last 100) |
| GET | `/api/bot/pnl-daily?symbol=&days=` | Daily P&L data (7–90 days) |
| POST | `/api/bot/backtest?symbol=` | Run backtest (historical hourly candles) |
| POST | `/api/bot/optimize?symbol=` | Run optimizer (96 combos) |
| GET | `/api/bot/bridge-status` | MT5 bridge heartbeat status |
| POST | `/api/bot/bridge-heartbeat` | MT5 bridge heartbeat (BOT_API_TOKEN only) |
| GET/POST/DELETE | `/api/bot/webhooks[/:id]` | Webhook CRUD |

### Auth (public)

| Method | Route | Notes |
|---|---|---|
| POST | `/api/auth/register` | Create account, returns JWT |
| POST | `/api/auth/login` | Returns JWT + user |
| GET | `/api/auth/me` | Current user profile (role from DB) |

### Notifications (JWT)

| Method | Route | Notes |
|---|---|---|
| GET/PUT | `/api/notifications` | Telegram + SMTP config (secrets masked in GET) |
| POST | `/api/notifications/test` | Fire test notification |

### Alerts (JWT)

| Method | Route | Notes |
|---|---|---|
| GET | `/api/alerts` | List price alerts |
| POST | `/api/alerts` | Create alert (`symbol`, `condition`, `targetPrice`, `label`) |
| DELETE | `/api/alerts/:id` | Delete alert |
| PATCH | `/api/alerts/:id/rearm` | Rearm triggered alert |

### Admin (admin role)

| Method | Route | Notes |
|---|---|---|
| GET | `/api/admin/overview` | System stats + per-user bot status |
| GET | `/api/admin/users` | All users |
| PATCH | `/api/admin/users/:id` | Update role or active state |
| POST | `/api/admin/init` | Emergency admin bootstrap |
| GET | `/api/admin/audit` | Recent audit log entries |
| GET | `/api/admin/system` | Uptime, memory, DB latency |

## Security Hardening

- **Helmet** — X-Frame-Options, HSTS, CSP, Referrer-Policy, etc.
- **Rate limiting** — auth routes 30 req/15min; global API 300 req/min (dev: off)
- **CORS** — scoped to `REPLIT_DOMAINS` in production, open in development
- **Active account check** — `requireAuth` middleware verifies `active = true` in DB on every request
- **bcrypt** — cost factor 12 for password hashing
- **JWT** — HS256 signed with `SESSION_SECRET` (Replit-managed secret)
- **Role from DB** — JWT does not cache role; re-read on every request
- **Webhook HMAC** — optional `secret` per webhook (HMAC-SHA256)
- **Request body limit** — 256 KB
- **Graceful shutdown** — SIGTERM/SIGINT → 10s force-exit fallback
- **Global error handler** — no stack traces in production
- **Supply chain** — `minimumReleaseAge: 1440` in pnpm workspace

## Database Schema

9 tables, 19 indices:

| Table | Primary Key | Notable Indices |
|---|---|---|
| `users` | `id` (uuid) | unique `username`, unique `email` |
| `bot_status` | `(user_id, symbol)` | — |
| `bot_config` | `(user_id, symbol)` | — |
| `bot_trades` | `id` | `(user_id, symbol)`, `symbol`, `opened_at DESC` |
| `bot_logs` | `id` | `(user_id, symbol)`, `symbol`, `id DESC` |
| `bot_webhooks` | `id` | — |
| `notification_settings` | `user_id` | — |
| `price_alerts` | `id` | `user_id`, `active` (partial) |
| `audit_logs` | `id` | `actor_id`, `created_at DESC`, `action` |

## Dashboard Features

- Live signal + 60-candle price chart with MA25/50/100 overlays and signal markers
- Daily P&L bar chart — 30-day history, green/red per-day bars, cumulative line, period stats
- Trade history (last 50 per symbol)
- Backtesting engine (walk-forward on ~720–1,100 historical hourly candles)
- Optimizer (96 combos × 3 modes × 4 confidence levels × 8 strategy presets)
- Apply to Live Bot (⚡ button on optimizer results → PUT /api/bot/config → toast confirmation)
- Configuration page (full config per symbol, per user)
- MT5 Setup wizard (5-step guided)
- Notifications page (Telegram + email, per-event filter)
- Price Alerts page (create/delete/rearm, 30s background poller)
- Admin Panel (user management, audit log, system stats — admin only)
- Offline detection banner, session refresh every 5 min, auto-logout on suspension
- 404 page for unknown routes
- Role-aware sidebar (Admin Panel link only visible to admins, gold avatar for admins)

## Backtesting Engine

- **Historical data**: `fetchHistoricalCandles()` — Yahoo Finance `GC=F` `interval=1h&range=60d` (~1,122 bars) or Binance `BTCUSDT` `interval=1h&limit=720` (720 bars). Falls back to 1,000-candle mock on fetch failure.
- **Warm-up**: first 110 candles skipped (required for MA100 calculation)
- **Session filter**: uses `candle.time` (historical Unix seconds), not wall clock — backtest correctly respects historical session hours
- **WEIGHTED threshold**: prefers `config.engine.minConfidence` over `weightThreshold`
- **Walk-forward**: evaluates each candle sequentially; opens simulated trade on signal; checks SL/TP on subsequent candles
- **Optimizer**: tests 96 parameter combinations (~500 ms); sortable by PF, WR, P&L, or trades

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (Replit managed) |
| `SESSION_SECRET` | Yes | JWT signing key (Replit secret) |
| `BOT_API_TOKEN` | Recommended | Static token for MT5 bridge machine auth (default: `changeme` — **must change in production**) |
| `PORT` | Auto | Set per artifact by Replit; do not hardcode |

## Deployment Checklist

- [ ] `SESSION_SECRET` set as Replit secret
- [ ] `BOT_API_TOKEN` changed from default `changeme`
- [ ] First account registered (auto-becomes admin)
- [ ] Notifications configured (Telegram / email)
- [ ] Optimizer run; best config applied to live bot with ⚡
- [ ] MT5 EA configured with published URL + BOT_API_TOKEN

## Code Quality

- **TypeScript**: 0 errors across all 4 workspace packages (`pnpm run typecheck`)
- **Vue SFC**: typechecked with `vue-tsc` (switched from plain `tsc`)
- **No `console.log`** in server code — all logging via `req.log` / pino `logger`
- **No unhandled promise rejections** in routes
- **Import hygiene**: all priceService functions imported from `priceService.ts` directly (botEngine.ts no longer re-exports them)
- **Pinia auto-unwrap**: computed refs accessed without `.value` outside setup (App.vue fixed)
- **Chart.js null safety**: `parsed.y ?? 0` guards in all tooltip callbacks

## Comprehensive Documentation

See `USER_GUIDE.md` in the repo root for the full user-facing documentation including:
- Getting started, registration, login
- Dashboard walkthrough
- Bot configuration reference
- Backtesting and optimizer guide
- Price alerts usage
- Telegram + email notification setup
- MT5 connection guide (5-step wizard + EA wiring)
- Admin panel guide
- Full API reference with request/response examples
- Architecture diagrams
- Security model
- Deployment checklist
- Troubleshooting guide
