# Target Design: XAUUSD Signal Service

This is the target architecture that [PLAN.md](../PLAN.md) builds toward. PLAN.md tracks *what is done*; this file explains *how it should work*. When the two disagree, fix whichever one is wrong in the same PR.

Status (2026-09-26): the gold MVP described here is **implemented** except Phases 8–11 (SMC, BTC, execution, subscribers). Where the build differs from the first draft of this document, the text below has been updated:
- The feeder sends **only closed M1 bars**; the engine builds M5 and M15 itself, so research, golden tests and live share one aggregation path.
- Bar and signal times are stored as **UTC epoch seconds** (`bigint`), audit columns as `timestamptz`.
- Folders keep their original names (`artifacts/api-server`, `artifacts/dashboard`); the `apps/` rename is optional.
- The engine processes each M1 bar in **one transaction** (signals, events, evaluations, outbox, cursor).

---

## 1. Where things run

```
 Windows VPS (from Phase 4)                    Linux VPS (Docker Compose)
 ┌──────────────────────────────┐              ┌────────────────────────────────────────────┐
 │ MT5 terminal (Vantage demo)  │              │ caddy   :443 TLS, static SPA, /api proxy   │
 │ feeder (Python service, NSSM)│  HTTPS+HMAC  │ api     Node, stateless HTTP + SSE          │
 │  - closed M1 bars + spread   │─────────────▶│ engine  Node, single leader: strategy,      │
 │  - bid/ask/spread at close   │  over        │         tracker, Telegram, watchdog, news   │
 │  - heartbeat                 │  Tailscale   │ migrate one-shot Drizzle migrator           │
 │  - SQLite outbox (retries)   │              │ postgres:16 (never published)               │
 │  - [P10] executor order_send │◀── intents ──│ backup  pg_dump → local + R2/B2             │
 └──────────────────────────────┘              │ [profile obs] prometheus + grafana          │
                                               └────────────────────────────────────────────┘
 Dev laptop (Linux): research/ (Python, Dukascopy parquet, walk-forward) → uploads report JSON to the API
 Off-box: UptimeRobot / Better Stack free tier hitting /api/healthz and the public page
 Telegram: private forward-test channel → public channel; admin DM for commands and alerts
```

**Key decisions**
- **One API image, three roles.** `api` (HTTP + SSE), `engine` (strategy, tracker, Telegram, watchdog) and `migrate` share one image with different entrypoints. The engine is a separate process so CPU work and Telegram polling never block HTTP. The API can scale; the engine never does.
- **Single engine leader.** The engine takes `pg_try_advisory_lock` at boot. A second copy stands by instead of double-posting.
- **Postgres LISTEN/NOTIFY, no Redis.** Ingest commits bars then `NOTIFY bars`. The engine writes events then `NOTIFY signal_event`, and the API fans those out over SSE. A 5 s safety poll covers missed notifications.
- **Candles in the DB are the only market data.** No Yahoo, no Binance, no random-walk fallback. If data is missing the engine records `data_unavailable` and stays silent.
- **Ingest is private.** `/api/ingest/*` is reachable only over Tailscale (or a Cloudflare Tunnel) and requires an HMAC signature: `X-Feeder-Id`, `X-Timestamp`, `X-Signature = HMAC_SHA256(secret, ts + "\n" + body)`, ±60 s window.

## 2. Data flow for one M5 close (target: under 5 s from bar close to Telegram)

1. **Feeder** (every second): `copy_rates_from_pos(sym, M1, 1, n)`. Position 1 is the last *closed* bar, so nothing repaints. Converts broker server time to UTC, samples `symbol_info_tick` for bid/ask/spread, and POSTs one batch per cycle.
2. **API `POST /api/ingest/bars`:** zod validation (TF alignment, rejects bars that have not closed, OHLC sanity, quarantines a >3 % jump). Upserts `candles`, updates `feeders.last_seen_at`, commits, then NOTIFY.
3. **Engine, serial per symbol:**
   1. Tracker applies new M1 bars to open signals first, so a loss at time T sets the cooldown before bar T is evaluated.
   2. For each newly closed M5 bar: data-gap check → policy pre-gates → strategy → post-gates.
   3. Writes `engine_evaluations`. On a signal, inserts `signals`, a `created` event and a `notification_outbox` row in **one transaction**.
4. **Outbox dispatcher** sends through grammY, stores `telegram_message_id`, and edits the message on later events.
5. **SSE** pushes events to the dashboard and the public track-record page.

## 3. Database (Drizzle, `lib/db/src/schema/`)

All timestamps are `timestamptz`. Add FKs and indexes. New files: `market.ts`, `signals.ts`, `research.ts`, `ops.ts`.

| Table | Key columns | Notes |
|---|---|---|
| `candles` | PK(symbol, tf, t); o,h,l,c; tick_volume; spread_pts; source (`mt5:vantage-demo`, `dukascopy`); ingested_at; revised_at | `t` = bar open, UTC. |
| `feeders` | id, name, secret_hash, last_seen_at, last_bar_t jsonb, server_utc_offset_min, terminal_connected, build | Heartbeat target. Replaces `/bridge-heartbeat`. |
| `strategy_configs` | id, symbol, strategy_id, strategy_version, params jsonb, is_active, created_by, created_at, note | Append-only. Partial unique index on (symbol) WHERE is_active. Replaces `bot_config`. |
| `signals` | id, public_no (shown as `XAU-000123`), strategy_id/version, config_id, symbol, mode (`shadow`/`forward`/`live`), direction, trigger_bar_t, entry_ref, entry_fill, fill_t, sl_initial, sl_current, tp1, tp2, risk_px, valid_until, status, outcome, r_gross, r_cost, r_net, closed_at, diagnostics jsonb, tg_chat_id, tg_message_id | UNIQUE(strategy_id, symbol, mode, trigger_bar_t) = per-bar dedup. Partial unique index on (symbol, mode) WHERE status is open = **the DB enforces one open signal**. |
| `signal_events` | id bigserial, signal_id, type, market_t, price, payload, created_at, prev_hash, hash | Append-only. SSE `id:`. Optional hash chain makes the track record tamper-evident. |
| `engine_evaluations` | PK(symbol, strategy_id, bar_t), decision, reason_code, gates jsonb, duration_ms | Answers "why no signal?". Keep 90 days. |
| `engine_state` | PK(symbol, mode), paused, paused_reason, cooldown_until, last_eval_bar_t, last_m1_t | Replaces the in-memory `botRegistry`. Survives restarts. |
| `news_events` | id, source, ext_id, currency, title, impact, scheduled_at, fetched_at | UNIQUE(source, ext_id). |
| `notification_outbox` | id, target, kind (`send`/`edit`/`reply`), signal_id, payload, status, attempts, next_attempt_at, result | Telegram retries survive restarts. |
| `backtest_runs` | id, kind, strategy_id/version, params, dataset (source, range, sha256), git_sha, metrics, equity_r, is_public | Uploaded from `research/`. |
| `metrics_daily` | SQL **view** over `signals` | Materialize later if slow. |
| `users` (changed) | + token_version, password_changed_at, failed_logins, locked_until; role ∈ admin/viewer | |

Dropped in the baseline migration: `bot_trades`, `bot_logs`, `bot_status`, `bot_config` (no production data exists). `bot_trades` returns as `executions` in P10. `bot_webhooks` stays behind a feature flag. `price_alerts`, `notification_settings`, `audit_logs` are kept.

**Migrations:** `drizzle-kit generate` into `lib/db/migrations/`, applied by a `migrate` entrypoint. Remove `push`/`push-force`. CI applies all migrations to an empty DB, then fails if `drizzle-kit generate` produces a diff.

## 4. Repo layout (target)

```
PLAN.md  README.md  CLAUDE.md  .mcp.json  .nvmrc
docs/        DESIGN.md STRATEGY_SPEC.md RUNBOOK.md SECURITY.md DATA.md LEGAL.md adr/ legacy/
apps/api/    (was artifacts/api-server) src/{config,index,engine,migrate}.ts, http/, routes/, engine/, telegram/, realtime/
apps/web/    (was artifacts/dashboard) Vue 3 + Caddyfile
lib/db/      schema + migrations
lib/strategy/  NEW: pure TS, no I/O, no Date.now()
  indicators/{sma,ema,atr,stoch,swing}  strategies/{emaStochAtr, smc/*}  policy/  tracker/  stats/  registry
lib/api-spec, lib/api-zod   extend OpenAPI to /public/* and /ingest/*
research/    Python "xausig": data/dukascopy, indicators, strategy, policy, sim, stats, walkforward, montecarlo, report
feeder/      Python MT5 feeder (Windows): mt5_client, clock, bars, outbox, api_client, heartbeat; executor/ in P10
fixtures/golden/<case>/   shared candles + expected indicators/decisions/outcomes for pytest AND vitest
deploy/      compose.yml, compose.obs.yml, Caddyfile, .env.example, backup/
.github/     workflows/{ci,deploy,codeql}.yml, dependabot.yml
```

**Rewrite, don't patch:** `botEngine.ts` → `lib/strategy`; `backtester.ts` → deleted (research is Python; a TS replay CLI exists only for parity); `priceService.ts` → deleted (read from DB); `botState.ts`, `hydrate.ts`, `persistence.ts` → deleted (DB-first engine); `routes/bot.ts` → `signals`, `engine`, `strategyConfigs` routes; `lib/telegram.ts` → grammY.

**Keep and patch:** `app.ts`, `index.ts`, `logger.ts`, `audit.ts`, `jwtAuth.ts`, `middlewares/auth.ts` (split user and feeder auth), `routes/auth.ts`, `routes/admin.ts`, `routes/alerts.ts` + `alertChecker.ts` (price from latest DB candle), `notificationService.ts` + `emailer.ts` (per-user delivery in P11), `routes/health.ts`.

## 5. Strategy contract (`lib/strategy`, mirrored in `research/xausig`)

`docs/STRATEGY_SPEC.md` freezes every choice where Python and TypeScript could disagree:

- **EMA:** seeded with the SMA of the first n values, then α = 2/(n+1). Warmup ≥ 3n bars.
- **ATR(14):** Wilder smoothing. (MT5's iATR uses SMA, so it will differ slightly from the MT5 chart.)
- **Stoch(5,3,3):** raw %K over 5 bars, slow %K = SMA3, %D = SMA3 of slow %K.
- **Cross:** long when `K[t-1] ≤ D[t-1] && K[t] > D[t] && K[t-1] < 20`; short mirrored with `K[t-1] > 80`.
- **Pullback:** within the last 3 M5 bars including the trigger, `low ≤ max(EMA20, EMA50)`, and the trigger closes above `min(EMA20, EMA50)` (mirrored for shorts).
- **Swing stop:** lowest low of the last 10 M5 bars minus a small ATR buffer. SL distance = max(1.5 × ATR, swing distance).
- **M15 alignment:** at M5 close T, use the last M15 bar whose close ≤ T.
- **Entry:** trigger close plus spread for longs. Filled at the next M1 open if within 0.25 R, otherwise `expired`.
- **TP1:** close a fixed fraction (proposal: 50 %) and move SL to breakeven. **Freeze this before the walk-forward.**
- **Time exit:** at `maxHoldMin`, or Friday 20:45 UTC.
- **Costs:** longs exit on bid, shorts on ask; commission per symbol.
- **Versioning:** any rule change bumps the strategy version and starts a new track-record segment.

```ts
export type Timeframe = "M1" | "M5" | "M15" | "H1";
export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number; spread?: number }
export interface SymbolSpec { symbol: string; digits: number; point: number; contractSize: number;
  commissionPerLotRT: number; tz: "fx" | "crypto24x7" }        // XAU contract 100, BTC 1 (fixes the P&L bug)
export interface MarketSnapshot { symbol: string; now: number;
  bars: Partial<Record<Timeframe, readonly Bar[]>>;            // CLOSED bars only
  quote?: { bid: number; ask: number; t: number } }
export interface SignalPlan { direction: "long" | "short"; entryRef: number; sl: number; tp1: number; tp2: number;
  riskPx: number; validForMin: number }
export type Decision =
  | { kind: "none"; reason: ReasonCode; diag: Record<string, number | string | boolean> }
  | { kind: "signal"; plan: SignalPlan; reasons: string[]; diag: Record<string, number | string | boolean> };

export interface Strategy<P> {
  id: string; version: number;                     // "ema_stoch_atr", 1
  trigger: Timeframe; context: Timeframe[];        // "M5", ["M15"]
  warmup(p: P): Partial<Record<Timeframe, number>>;
  params: z.ZodType<P>; defaults(spec: SymbolSpec): P;
  evaluate(snap: MarketSnapshot, p: P, spec: SymbolSpec): Decision;   // pure, deterministic
}
// Stateful gating lives OUTSIDE strategies:
preGates(ctx, policy): ReasonCode | null   // paused, session, news, spread, one_open, cooldown, data_gap
postGates(decision, ctx, policy): Decision // atr_range, max_sl_distance
advance(signal, m1Bar, spreadPx, spec): { next, events }   // tracker, shared by live engine and replay
```

- **Sessions** are defined in local time (`Europe/London 07:00–16:00`, `America/New_York`) and converted with `Intl` / `zoneinfo`, so DST is handled. Golden cases cover the March and October weeks when UK and US clocks are out of step.
- **Registry:** `"ema_stoch_atr@1"` is the XAUUSD default.
- **SMC (P8):** each detector becomes a voter. `smc_confluence` fixes the voting bug: the denominator is **all enabled voters, including abstainers**; `minVotes` defaults to 2; the MA filter and session become gates, not voters. SMC uses the same ATR/swing risk model so results compare in R.

**Golden parity:** `research/scripts/make_golden.py` writes `fixtures/golden/<case>/`. pytest and vitest both consume them. Indicators must match to 1e-9 relative; decisions and outcomes must match exactly. CI fails if regenerating produces a diff. Cases include `long_basic`, `short_basic`, `bias_none`, `stoch_cross_not_extreme`, `pullback_absent`, `m15_boundary_alignment`, `outside_session`, `dst_gap_week_mar/oct`, `news_blackout`, `spread_too_wide`, `atr_out_of_range`, `one_open_suppression`, `cooldown_after_loss`, `tp1_then_be`, `tp1_then_tp2`, `same_bar_sl_and_tp1` (SL wins), `expired_gap_fill`, `time_exit_friday`, `weekend_gap`, `data_gap_skip`, plus one two-week real-data case.

## 6. Engine loop

- **Trigger:** NOTIFY `bars` plus a 5 s poll. Nothing is triggered by HTTP GETs.
- **Pre-gates, in order:** `paused` → `session` → `news` → `spread` → `one_open` → `cooldown` (after an SL or losing time exit; optional daily loss cap in R).
- **Late-bar guard:** if the bar is more than 120 s old when evaluated (backfill after an outage), store the signal as `shadow` and never publish it.
- **Tracker (conservative intrabar):** `pending` → fill at next M1 open or `expired`. `active`: SL wins if SL and TP print in the same bar; TP1 → partial close + SL to BE (`be`); if the same bar also touches BE, close at BE. `be`: BE wins over TP2 on ambiguous bars. Shorts evaluate against ask. Optional later: resolve ambiguous bars with ticks from the feeder.
- **Stats** (`stats.ts`, mirrored in `stats.py`): trades, win rate, profit factor in R, net expectancy in R, average win/loss, max drawdown in R, longest losing streak, R by month / session hour / direction, bootstrap 95 % CI for expectancy.
- **News:** live from the ForexFactory weekly JSON (`nfs.faireconomy.media/ff_calendar_thisweek.json`, unofficial; fetch at most hourly), high-impact USD. Backup and history from an MQL5 script exporting the MT5 economic calendar. Stale for 36 h → admin alert; 72 h → auto-pause.
- **Watchdog (30 s):** market open and last M1 bar older than 10 min, or feeder heartbeat older than 2 min → one admin alert, then a recovery message when it clears.

## 7. Telegram (grammY, inside the engine)

- Packages: `grammy`, `@grammyjs/auto-retry`, `@grammyjs/transformer-throttler`. Long polling only.
- Env: `TELEGRAM_BOT_TOKEN`, `TG_CHANNEL_PRIVATE_ID`, `TG_CHANNEL_PUBLIC_ID`, `TG_ADMIN_IDS`, `PUBLISH_TARGET=private|public|both`.
- One message per signal. On each event: `editMessageText` to append a status line, **plus** a threaded reply, because edits don't notify subscribers.
- Admin commands (private chat, `from.id` in `TG_ADMIN_IDS`): `/pause [reason]`, `/resume`, `/stats [7d|30d|all]`, `/health`, `/last`, `/mode`. Pause and resume are written to `audit_logs`.

Example post:
```
🟢 XAUUSD LONG  #XAU-000123   (M5, M15 trend: up)
Entry 2381.40
SL    2376.90  (−1R, 1.5×ATR)
TP1   2385.90  (1R, close 50%, SL → BE)
TP2   2390.40  (2R)
Valid until 10:35 UTC · ema_stoch_atr v1 · Not financial advice
```

## 8. Realtime, public pages, charts

- **SSE** over WebSockets: `GET /api/stream` (cookie auth) and `GET /api/public/stream` (published signals only). `id:` = `signal_events.id`, `: ping` every 15 s, replay from `Last-Event-ID`. Remove the dashboard's 20 s polling.
- **Public pages:** `/track-record` (headline stats, cumulative R curve, monthly R, every signal including losses and expired ones, separate labelled tabs for "Forward test" and "Backtest (hypothetical)", disclaimer) and `/signals/:publicNo` (event timeline and chart). `PUBLIC_DELAY_MIN` can hide open signals for monetisation later.
- **Charts:** `lightweight-charts` v5 (keep the TradingView attribution). `SignalChart.vue` shows M5 candles, EMA20/50, the M15 EMA200, entry marker, SL/TP1/TP2 lines, and a Stoch pane. `EquityCurve.vue` in R. Chart.js is removed after both are replaced.
- **Dashboard views:** keep the shell, Login, Admin, Alerts, Notifications. Rewrite Dashboard (live card, feed health, today's R), History → Signals, Logs → evaluations ("why no signal"), Config → versioned strategy-config editor, Backtest → read-only Research viewer (**no optimizer, no "apply to live"**), MT5Setup → Feeder status. One API client (`useApi.ts`) for every view.

## 9. Security (must be done before anything is public)

1. `src/config.ts` parses env with zod and fails fast. Remove the `"changeme"` token fallback and the hardcoded JWT secret fallback.
2. Feeder credentials work only on `/api/ingest/*` and never map to a user.
3. Registration off by default. Remove "first user becomes admin" and `POST /admin/init`. Create the admin from a CLI. Roles: `admin`, `viewer`.
4. JWT in an httpOnly `Secure; SameSite=Strict` cookie (12 h, sliding), `token_version` revocation, logout. Nothing in localStorage.
5. `trust proxy`, rate limits always on, login lockout, same-origin through Caddy (CORS off, or an explicit `ALLOWED_ORIGINS`).
6. zod validation on every body, query and param. No more `Object.assign` config updates.
7. Webhooks and user SMTP behind feature flags until P11 (then: per-user scoping, masked secrets, SSRF checks, AES-256-GCM secrets at rest).
8. Remove every mock-data fallback. Track-record integrity depends on it.
9. HSTS and strict CSP at Caddy; helmet on the API; `/metrics` internal only.
10. CodeQL, gitleaks, Dependabot, `pnpm audit --prod`.
11. Postgres never published; SSH keys only; Windows VPS RDP only over Tailscale.

**Staged multi-user:** keep `users` and roles now, but signals are global and owned by the operator. P11 adds *subscribers* (Telegram DM or email delivery, preferences, history), not per-user engines.

## 10. MT5 demo execution (P10)

- Replaces the old file-based bridge (`mt5_bridge/`, broken end to end).
- The engine writes `executions` intents. The feeder's executor long-polls `GET /api/exec/intents`, acks with `POST /api/exec/intents/:id/result`.
- Idempotent: magic number per strategy, comment = public signal number; check open positions and deal history before sending; unique (signal_id, action) on the API side.
- `order_check` then `order_send`; filling mode from `symbol_info().filling_mode`; volume from equity × risk % / SL distance, clamped; SL/TP recomputed from the actual fill.
- TP1 partial close and SL→BE are managed locally by the executor, so they keep working if the API is unreachable.
- Refuses to trade unless the account is demo, unless `EXECUTION_ALLOW_REAL=true` plus a typed confirmation. `/pause` stops new intents; `/flatten` closes everything. Daily loss cap; 60 s reconciliation with alerts on mismatch.
- Tested against a `FakeMT5` with scripted failure codes on Linux and `windows-latest`.

## 11. DevOps

- **Compose:** `caddy`, `api`, `engine`, `migrate`, `postgres:16-alpine`, `backup` (daily/weekly/monthly retention + offsite to R2 or B2). Log rotation, `restart: unless-stopped`, memory limits. Optional `obs` profile with Prometheus and Grafana.
- **Images:** built only in CI (Docker does not work on the dev machine). Non-root, healthchecks. Pushed to GHCR as `sha-<short>` and `main`.
- **CI** (`ci.yml`): TypeScript (lint, typecheck, vitest incl. golden, build) · integration against a Postgres service (ingest → engine → tracker → outbox, SSE, auth) · Python (ruff, pytest incl. golden, `make_golden.py --check`) · feeder tests on `windows-latest` · migration drift check · Docker build · Playwright smoke tests on `main`.
- **Deploy** (`deploy.yml`): manual or on `v*` tag, protected `production` environment, SSH → `docker compose pull && up -d`, smoke curl. Rollback = redeploy the previous tag.
- **Observability:** pino JSON logs with `reqId`/`signalId`/`barT`; `prom-client` metrics such as `feed_last_bar_age_seconds`, `engine_decisions_total{reason}`, `signals_total{outcome}`, `outbox_pending`, `telegram_errors_total`; `/api/healthz` (liveness) and `/api/readyz` (DB, migrations, engine heartbeat).
- **Backups:** monthly restore drill into a local pgserver, logged in PLAN.md.

## 12. Risks

1. **No edge after costs.** This is the most likely outcome for a textbook EMA/Stoch pullback on gold M5, where the spread is large relative to the stop. Pre-registered variants, a "graveyard" of failed attempts, and publishing an honest negative result protect the portfolio value. Do not turn this into endless tuning.
2. **Broker time vs UTC and DST.** MT5 bar times are broker time (often GMT+2/+3 following US DST). The feeder must detect and report the offset.
3. **Dukascopy vs broker data** differ in price level, spread and gaps. The forward test is the real validation.
4. **Python/TS drift.** The golden check in CI is mandatory. A rule change without a version bump must fail review.
5. **Windows VPS / MT5 reliability** (disconnects, Windows Update reboots). Mitigated by NSSM auto-restart, auto-login, the outbox and the watchdog.
6. **Unofficial news feed.** Second source from MT5, stale alert, auto-pause.
7. **Scope creep** from keeping SMC, BTC, execution and multi-user. PLAN.md gates each behind the gold MVP.
8. **Legal** (SEBI, FEMA/RBI). See Gate 3 in PLAN.md.
9. **Telegram** spam flags and 429s; **licences** (lightweight-charts attribution; never redistribute raw Dukascopy data or broker prices beyond small delayed windows).
