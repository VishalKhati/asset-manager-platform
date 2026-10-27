# Gold Signals: an honest XAUUSD signal service

A production-style trading-signal service for gold (XAUUSD). A server-side engine turns live spot-gold prices into trade signals, posts them to Telegram, and tracks every one to its outcome automatically. A public page shows the complete record, losses included. Every strategy is backtested with pre-registered walk-forward validation before anything is published, and a live forward test is running now.

> Research and engineering project, not financial advice. See [docs/LEGAL.md](docs/LEGAL.md).

![Public track record](docs/screenshots/track-record.png)

## What it does

- **Rules-based strategy.** It uses the M15 trend (EMA 20/50/200), an M5 pullback plus a Stochastic(5,3,3) cross out of the extreme zone, and ATR/swing stops with 1R and 2R targets. It filters by session (London and New York, DST-aware), news, spread and volatility, allows one signal at a time, and cools down after a loss. Frozen in [docs/STRATEGY_SPEC.md](docs/STRATEGY_SPEC.md).
- **Backtest first.** The Python research package runs a walk-forward test on 7+ years of Dukascopy M1 bid/ask data, with spread, commission and slippage. The parameter grid is pre-registered, 2026 is a locked holdout, Monte Carlo drawdown is reported, and pass/fail gates are fixed before looking. Results: [research/reports/WALKFORWARD.md](research/reports/WALKFORWARD.md).
- **One strategy, two languages, zero drift.** The rules exist in Python for research and TypeScript for the live engine. Shared golden fixtures prove they make the same decision at every M5 close and resolve every signal to the same R.
- **Live engine.** It processes each closed M1 bar in a single Postgres transaction covering signals, events, the "why no signal" log, the Telegram outbox and the cursor. Restarts and outages can't double-post or lose a signal. A single leader runs via an advisory lock.
- **Outcome tracking.** Every signal is resolved on M1 data with conservative intrabar rules: the stop wins ties, TP1 closes half and moves the stop to entry, then TP2. There is also a time exit. Results are in R after costs.
- **Telegram.** Each signal is one message, edited in place as TP1, TP2 or the stop hits, plus a threaded reply. Admin commands: `/pause /resume /stats /health /last /mode /yes`. The admins are alerted if the feed goes silent. On networks that block Telegram, the bot goes through a tiny Cloudflare Worker relay (`deploy/telegram-relay`) that only forwards calls for that one bot.
- **Trade tools.** Every signal comes with a ticket: a lot size from the account balance and risk per trade, and a PASS/BLOCK check covering risk per trade, the daily loss limit, trades per day, reward-to-risk, the entry window and one position at a time. The ticket also shows the odds of the stop or targets being hit, from 10,000 replays of past sessions at the same time of day plus real look-alike days. The operator approves a trade by typing YES on the dashboard or sending `/yes` in Telegram. Nothing is sent to a broker automatically.
- **Web.** A public track record with an equity curve, every signal, and candlestick charts showing entry, stop and targets (TradingView Lightweight Charts). The operator overview shows a live spot price streamed every second and an embedded TradingView chart (OANDA:XAUUSD). The other operator pages cover health, the "why no signal" log, versioned strategy parameters, account and risk settings, research reports, price alerts, users and the audit log. Updates stream over server-sent events.
- **Price feeds.** In production, a small Python MT5 feeder on a Windows VPS pushes closed bars and spread over Tailscale with HMAC-signed requests. It detects the broker's UTC offset and keeps a local SQLite outbox, so outages lose nothing. Until the VPS exists, `mt5feeder.spot` builds 1-minute bars from Swissquote's public spot quotes. These match TradingView's OANDA:XAUUSD and the broker's MT5 price within about 0.1. Both feeders go through the same signed ingest API.

| Signal detail | Operator overview |
|---|---|
| ![Signal](docs/screenshots/signal-detail.png) | ![Overview](docs/screenshots/ops-overview.png) |

## Architecture

```
Windows VPS                                   Linux VPS (Docker Compose)
MT5 terminal ─► feeder (Python) ──HTTPS+HMAC──► Caddy ─► api (Express, SSE) ◄── browsers
               closed M1 bars      Tailscale         │        │ LISTEN/NOTIFY
                                                     │        ▼
                                                  Postgres ◄── engine (strategy, tracker,
                                                               Telegram outbox, watchdog, news)
Laptop: research/ (Python) ── walk-forward report ──► uploaded to the API

Interim (no VPS yet): Swissquote spot quotes ─► mt5feeder.spot ─► same ingest API
                      engine ─► Cloudflare Worker relay ─► Telegram (where the ISP blocks it)
```

Details: [docs/DESIGN.md](docs/DESIGN.md). Operations: [docs/RUNBOOK.md](docs/RUNBOOK.md). Roadmap and status: [PLAN.md](PLAN.md).

## Tech

TypeScript (Express 5, Vue 3, Pinia, Tailwind 4, Drizzle ORM, zod, grammY, prom-client, Lightweight Charts, TradingView widget) · PostgreSQL 16 · Python (pandas, pyarrow, pytest) · esbuild, Vite, pnpm workspaces · Docker, Caddy, Cloudflare Workers, GitHub Actions, GHCR.

## Repository

| Path | What |
|---|---|
| `lib/strategy` | Pure TypeScript strategy, indicators, tracker and stats: the live engine's core |
| `research/` | Python reference implementation, data pipeline, walk-forward, reports |
| `fixtures/golden/` | Shared inputs and expected outputs both languages must reproduce |
| `artifacts/api-server` | API, engine and CLI (bundled into self-contained `dist/*.mjs`) |
| `artifacts/dashboard` | Vue SPA: public track record and `/ops` operator pages |
| `lib/db` | Drizzle schema and SQL migrations |
| `feeder/` | MT5 feeder for Windows, the interim spot feeder (`mt5feeder.spot`), and a replay tool for demos |
| `collectors/` | Free order-flow and options data collectors used by the v3 research |
| `deploy/` | Compose stack, Caddyfile, env template, Telegram relay worker |

## Quick start

```bash
pnpm install --frozen-lockfile
pnpm --filter @workspace/strategy test            # strategy + golden parity
pnpm run build                                    # typecheck + build API and dashboard
```

To run the full stack locally with demo data, see [docs/RUNBOOK.md](docs/RUNBOOK.md#local-development). To deploy, see [docs/RUNBOOK.md](docs/RUNBOOK.md#deploy-linux-vps).

## Tests

| Suite | Count | What it proves |
|---|---|---|
| `lib/strategy` (vitest) | 34 | Indicators, tracker edge cases, DST sessions, golden parity with Python, position sizing, risk check, odds simulation |
| `artifacts/api-server` (vitest + Postgres) | 38 | Live engine matches the reference, survives restarts, never double-posts; auth, roles, CSRF, lockout, ingest signing and validation, public/private visibility, trade tickets and approval, live quote parsing |
| `research` (pytest) | 37 | Indicators, tracker, sessions and news, v2–v4 hypothesis rules, golden parity with TypeScript |
| `feeder` (pytest, Linux + Windows) | 15 | UTC offset, closed-bar rule, outage/restart safety, request signing (shared test vector with the API), Binance and spot bar building |
| `collectors` (pytest) | 5 | Order-flow and options data collectors |

## Status

**Research verdict: the textbook EMA + Stochastic + ATR pullback strategy does not work on gold.** Walk-forward out of sample it loses 0.09R per trade over 1,378 trades (profit factor 0.82), and the 2026 holdout loses 0.19R per trade. Three more pre-registered hypotheses also failed their gates:

| Version | Hypothesis | Result |
|---|---|---|
| v2 | London-open breakout of the Asian range | −0.035R per trade over 611 out-of-sample trades, with a 95% interval spanning zero |
| v3 | Order-flow delta divergence at value-area edges, on free Binance/Bybit tape data | +0.04R per trade, but the interval runs from −0.26 to +0.39R, so it is inconclusive |
| v4 | Daily macro trend from real yields, the dollar and trend | Sharpe 0.27 against a required 0.5 |

The pipeline is built so that a failing strategy is caught before anyone trades it, and every one was. Reports: [v1](research/reports/WALKFORWARD.md), [v2](research/reports/WALKFORWARD_LONDON_ORB.md), [v3](research/reports/WALKFORWARD_DELTA_VA.md), [v4](research/reports/WALKFORWARD_MACRO.md), [research log](research/reports/GRAVEYARD.md).

**Forward test (live, since October 2026).** The v1 engine runs live on spot prices and posts to the free Telegram channel [t.me/xau_drizzle](https://t.me/xau_drizzle). 17 signals are tracked so far, for +3.8R. That sample is far too small to overturn the backtest, so treat it as a test of the software, not as evidence of an edge. Next are a broker-connected MT5 feed, deployment to a VPS, and the go/no-go gates in [PLAN.md](PLAN.md). The earlier "SMC Gold Bot" prototype and its evaluation are recorded in PLAN.md §1.
