# PLAN: Gold Signal Service

This is the main follow-up tracker for this repo. Tick boxes as work lands, and keep the decisions log current. The detailed target design is in [docs/DESIGN.md](docs/DESIGN.md).

**Goal:** turn the "SMC Gold Bot" into a live, credible XAUUSD signal service. It posts to a Telegram channel, runs a web dashboard, and shows an honest public track record. Its default strategy is **EMA + Stochastic + ATR**, and it is backtested before anything is published.

**Rule of the plan:** finish the gold MVP (Phases 0–7) before starting SMC, BTC, MT5 execution or multi-user work (Phases 8–11). Building everything at once is what stalled this project before.

Last updated: 2026-09-26 (autonomous build session)

---

## 1. Evaluation of the current app as a live product

Verdict: **not deployable as a signal product.** The UI shell, auth, alerts and notifications are reusable. The core, meaning the data, signals, execution and track record, has to be rebuilt.

| Area | Today | Verdict |
|---|---|---|
| Market data | Yahoo COMEX gold **futures** on 1-minute bars, not spot XAUUSD. Any fetch failure silently switches to **random prices** (`priceService.ts`). Evaluates the still-forming bar, so signals repaint. | Rebuild |
| Signals | No server-side loop. Signals are computed only when a dashboard tab or the bridge polls. Voting counts only strategies that vote, so a lone MA filter fires a signal; in practice it is "close vs SMA100". Every poll re-sends the same alert. | Rebuild |
| Outcomes / track record | None. Trades never auto-close; closing without a price records P&L 0; BTC P&L is overstated 100×. | Build new |
| Backtester | 1-hour data vs 1-minute live, fixed stops, no spread or costs, in-sample optimizer only. | Replace with Python research |
| MT5 bridge | Broken end to end: wrong folder, JSON the EA cannot parse, encoding mismatch, open result treated as the close, can wedge forever. | Replace with Python feeder |
| State | In memory, rehydrated at boot. Cannot run more than one instance. | Move to DB |
| Security | Default machine token `changeme`, hardcoded JWT secret fallback, first registrant becomes admin, CORS `*` off Replit, webhooks shared across all users with secrets exposed, SSRF via webhook URL and SMTP host, unvalidated config writes. | Must fix before public |
| Telegram | Raw `sendMessage` per user only. No channel, no edit-in-place, no admin commands. | Rebuild with grammY |
| Dashboard | Real API data, reasonable shell. Config page overwrites saved settings with defaults. Half the views bypass the API client. Chart.js lines only. Polling everywhere. | Keep shell, rewrite views |
| Tests / CI / Docker | None. | Build |
| Docs | README is resume notes; USER_GUIDE contradicts the code; replit.md is Replit-only. | Rewrite |
| Dead code | `bot/`, `backtest/`, `config/`, n8n stubs, `mockup-sandbox`, `lib/api-client-react`, `scripts/`, 4 unused Vue components, Replit config. | Delete (Phase 0) |

## 2. Decisions log

| Date | Decision |
|---|---|
| 2026-09-26 | **Product:** staged. Launch as a single-operator signal service (one engine, one channel, public track record, admin-only login). Add multi-user subscribers later (P11). |
| 2026-09-26 | **Stack:** hybrid. Python for research, backtest and the MT5 feeder. TypeScript (Express 5, Vue 3, Drizzle, Postgres) for the live product. Rules kept in sync by shared golden fixtures tested in both languages. |
| 2026-09-26 | **Data:** MetaTrader5 Python package on a Windows VPS pushes closed bars and spread to the API. Research starts on Dukascopy history because there is no VPS yet (MT5 demo account available). |
| 2026-09-26 | **Scope:** keep SMC, BTC and MT5 execution and fix all of them, staged after the gold MVP (P8–P10). |
| 2026-09-26 | **Default strategy:** EMA + Stochastic + ATR (spec in §4). |
| 2026-09-26 | **Old folder:** `../../Asset-Manager` deleted. Its 24-commit Replit history is archived at `~/archives/asset-manager-replit-history.bundle`; the original build prompt is at `docs/legacy/original-spec.txt`. |
| 2026-09-26 | **Claude tooling:** GitHub MCP + gh CLI, Playwright MCP, Context7 MCP, Postgres MCP (see §7). |

## 3. Phases

Estimates are focused solo days. Critical path to going public: P0 → P1 → Gate 1 → P2 → P3 → P4 → P6 (P5 in parallel) → Gate 2 → P7.

**Status on 2026-09-26:** the software for P1–P5 is built and tested locally (see §8). What is left needs you: the in-repo deletions, committing, a Windows VPS, a Linux VPS, Telegram setup, the forward test, and the Gate 1 decision.

### P0: Cleanup and foundation
- [x] Archive old folder history, copy original spec, delete `../../Asset-Manager`
- [x] `PLAN.md`, `docs/DESIGN.md`, `docs/STRATEGY_SPEC.md`, `docs/RUNBOOK.md`, `docs/LEGAL.md`, `CLAUDE.md`
- [x] Replit coupling removed from code: `REPLIT_DOMAINS` CORS, `MT5Setup.vue`, the `changeme` token, first-user-admin
- [x] `src/config.ts` (zod env, fails fast in production), `.env.example` files, `.nvmrc` (22), vitest and pytest suites
- [x] CI workflow (`.github/workflows/ci.yml`), manual deploy workflow, Dependabot
- [x] Prototype docs that remain carry an "outdated" banner
- [ ] **Delete dead and confusing files.** Blocked by a permission check on 2026-09-26; run the command below yourself
- [ ] After that: drop the `@replit/*` and React/expo catalog entries, `lib/integrations/*` and the ~80 linux-x64-only overrides from `pnpm-workspace.yaml`, then `pnpm install` to regenerate the lockfile. Remove the `api-client-react` block from `lib/api-spec/orval.config.ts` and `--filter "./scripts"` from the root `typecheck` script
- [ ] Commit (nothing has been committed; see §8 for a suggested commit split)
- [ ] Optional: rename `artifacts/` → `apps/`

**Deletion command** (git history keeps everything):
```bash
cd "/home/vishal/Watashi no purojekuto/publish-ready/asset-manager-platform"
git mv replit.md docs/legacy/replit-api-reference.md
git rm -rq bot backtest config automation_n8n mt5_bridge artifacts/mockup-sandbox lib/api-client-react scripts \
  .replit .replitignore USER_GUIDE.md \
  artifacts/api-server/.replit-artifact artifacts/dashboard/.replit-artifact artifacts/dashboard/components.json
```
Keep `ConfigField.vue`, `Section.vue`, `StatCard.vue` and `ToggleField.vue`: the new dashboard uses them. `mt5_bridge/` is replaced by `feeder/`. The n8n workflows duplicated built-in notifications and relied on the removed global webhooks.

*Exit:* `grep -ri replit` finds nothing outside `docs/legacy`; clean `pnpm install && pnpm run build`; CI green.

### P1: Strategy spec and research, backtest first
- [x] `docs/STRATEGY_SPEC.md` v1 frozen, including TP1 partial (50%), fill model, time exit and the pre-registered grid
- [x] Dukascopy M1 bid+ask downloader (`research/data/fetch*.sh`) → `xausig build-data` → parquet + `MANIFEST.json`; `xausig qa` spread/gap report
- [x] `research/src/xausig`: indicators, strategy, tracker, replay simulator, stats, walk-forward, Monte Carlo, Markdown/SVG report; 23 tests
- [x] Walk-forward: 24-month train, 6-month test, from 2021; 2026 locked as holdout; pre-registered grid of 8
- [x] News filter: proxy calendar for research (`xausig/news.py`); live uses ForexFactory
- [x] Walk-forward run on 2019-01 → 2026-09 (`research/reports/WALKFORWARD.md`)
- **Gate 1 result (2026-09-26): FAIL.** Out of sample: 1,378 trades, expectancy −0.090R (95% CI −0.145 to −0.034R), profit factor 0.82, max drawdown 131R. 2026 holdout: −0.186R over 340 trades. All 8 pre-registered variants lose even in-sample; costs are ~0.17R per trade but the rules lose before costs too.
- [ ] **Your call:** accept the result (publish it honestly, run the service in `shadow` mode as an engineering showcase) and/or pick a *new* strategy hypothesis to pre-register and test. Do not tune v1.

**GATE 1 (go/no-go):** out-of-sample ≥ 200 trades, profit factor > 1.3, expectancy > 0.2R **net of costs**, max drawdown ≤ 15R, Monte Carlo 95th-percentile drawdown ≤ 20R. Holdout expectancy > 0. Every tried variant goes in `research/reports/GRAVEYARD.md`.
If it fails: try only the pre-registered variants. If all fail, stop strategy work, publish the honest negative result, and run the product in `shadow`/forward mode as an infrastructure showcase until a new strategy passes.

### P2: TypeScript strategy library and golden parity
- [x] `lib/strategy`: indicators, strategy, tracker, stats, DST-aware sessions, shared `Engine` core used by the live engine
- [x] `fixtures/golden/` (3 real-data cases incl. both DST gap weeks and the March 2020 crash), generated by `research/scripts/make_golden.py`
- [x] Parity checked in both languages (vitest `golden.test.ts`, pytest `test_golden.py`) and mutation-tested: a deliberate rule change fails 9 golden tests

### P3: Live pipeline
- [x] Schema + Drizzle migrations (`0000_baseline`), `migrate` CLI; `db push` removed; CI fails on schema drift
- [x] `POST /api/ingest/bars|heartbeat|news` with HMAC feeder auth; bar validation (closed, aligned, OHLC, jump guard, revisions)
- [x] Engine process: advisory-lock leader, LISTEN/NOTIFY + 5 s poll, one transaction per bar, restart-safe, late-signal guard, pause, config hot-swap, watchdog, news sync, price alerts per bar
- [x] Outbox + grammY: post, edit in place, threaded reply, admin DMs, `/pause /resume /stats /health /last /mode`, feed-silent alert
- [x] Old engine removed (`priceService`, `botEngine`, `botState`, `hydrate`, `persistence`, `backtester`, `notifier`, `routes/bot.ts`, `alertChecker`)
- [x] Replay tool (`python -m mt5feeder.replay`) drives the real stack through signed ingest

*Exit met locally:* the live engine reproduces the Python reference exactly on a 3-week fixture, including across a mid-run restart; no duplicate posts (integration tests).

### P4: MT5 feeder on a Windows VPS
- [x] `feeder/`: closed-bar reads, broker-time → UTC offset detection, SQLite outbox, heartbeat, NSSM install script, 10 tests (CI also runs them on Windows)
- [ ] Rent a Windows VPS; MT5 demo terminal (e.g. Vantage) with auto-login; install the feeder
- [ ] Tailscale between both VPSes
- [ ] Optional: MQL5 script exporting the MT5 economic calendar to `/api/ingest/news`
- [ ] 48-hour soak test

*Exit:* feed uptime > 99.5 % in market hours over a week, zero bar mismatches, p95 bar-close-to-ingest under 5 s.

### P5: Product surface, security, deployment
- [x] Security (DESIGN §9): no default secrets, registration off, admin via CLI, httpOnly SameSite=Strict cookie + CSRF header, token-version revocation, login lockout, rate limits always on, trust proxy, zod validation, webhooks removed, user SMTP behind a flag
- [x] SSE stream (public and operator); polling only for health
- [x] Public track record and signal pages with Lightweight Charts; open forward-test signals stay private
- [x] Operator pages: Overview, Signals, Why no signal, Strategy (versioned, audited), Research (read-only), Alerts, Users + audit log
- [x] Dockerfiles (self-contained bundle, non-root, healthchecks), Caddy (TLS, CSP, ingest restricted to Tailscale), Compose (postgres, migrate, api, engine, web, backups, optional Prometheus/Grafana), GHCR build in CI, manual deploy workflow
- [x] Headless-Chrome walkthrough of every page; screenshots in `docs/screenshots/`
- [ ] Docker images are only built in CI (Docker does not run on the dev machine): check the first CI run
- [ ] Rent a Linux VPS, set up DNS, follow `docs/RUNBOOK.md` → Deploy; add an off-box uptime monitor on `/api/readyz`

### P6: Forward test on demo (4–6 calendar weeks, low effort)
- [ ] `SIGNAL_MODE=forward`, private Telegram channel
- [x] Parity script: `research/scripts/parity_check.py` replays stored broker bars through the Python reference and diffs every signal (verified on the local demo run: 12/12 identical)
- [ ] Run it weekly during the forward test and note the result here

**GATE 2:** ≥ 30 signals; parity holds; live expectancy not below the backtest bootstrap 5th percentile; drawdown within the Monte Carlo band; zero missed or duplicate posts; every feed outage alerted within 10 minutes. Otherwise back to P1. **Never tune on forward-test data.**

### P7: Public launch (2–3 days)
- [ ] `SIGNAL_MODE=live`, public channel; publish the track record; write-up / blog post
- [ ] Stay **free** until Gate 3

**GATE 3 (legal, before any fee, affiliate link or broker referral):** see `docs/LEGAL.md`.

### Later (each needs the gold MVP live first)
- [ ] **P8: SMC strategies (6–8 days).** Re-implement behind the same `Engine` core with the voting bug fixed (denominator includes abstainers, `minVotes` 2, MA filter and session as gates). Golden cases + Python mirror. Run in `shadow` mode; must pass Gates 1 and 2 before publishing.
- [ ] **P9: BTC (3–4 days).** Contract size 1 (fixes the old 100× P&L bug), 24/7 sessions, feeder symbol, own config and gates.
- [ ] **P10: MT5 demo execution (8–12 days).** Feeder executor with idempotent `order_send`, local TP1/BE management, demo-only guard, kill switch, reconciliation. Two clean weeks on demo. (DESIGN §10)
- [ ] **P11: Multi-user subscribers (10–15 days, after Gate 3).** Subscriptions, Telegram DM linking, per-user preferences, webhooks rebuilt with SSRF protection and encrypted secrets, registration with email verification.
- [ ] Extend `lib/api-spec/openapi.yaml` from `/healthz` to the public and ingest endpoints (contract for the feeder and any third-party client)

## 4. Default strategy v1 (summary; the frozen contract is `docs/STRATEGY_SPEC.md`)

- **Bias (M15):** long only if close > EMA200 and EMA20 > EMA50; short only if the reverse; otherwise no trade.
- **Trigger (M5, on close):** price pulled back into the EMA20–EMA50 zone, and Stoch(5,3,3) %K crosses %D up from below 20 (long) or down from above 80 (short).
- **Risk:** SL = entry ∓ max(1.5 × ATR14 on M5, distance beyond the pullback swing). TP1 = 1R, then move SL to breakeven. TP2 = 2R. Valid 30 min.
- **Filters:** London and New York sessions (DST-aware); no signals 15 min either side of high-impact USD news; skip if spread > max or ATR outside [min, max]; one open signal at a time; cooldown after a loss.

## 5. Open questions (answer before the phase that needs them)

- [x] P1: TP1 partial close fraction and max hold time: frozen at 50 % and 240 min in the spec (the grid also tests 0 %)
- [ ] P1: your acceptable public max drawdown in R (proposal ≤ 15R)
- [ ] P4: VPS providers (Windows for MT5; Linux, e.g. Hetzner or Oracle free tier, for the stack)
- [ ] P5: domain name for the public page
- [ ] P7: public channel name and branding

## 6. Working rules

- Never tune parameters on the holdout or forward-test data.
- Never edit `fixtures/golden/` by hand; regenerate with the script.
- Any rule change bumps the strategy version and starts a new track-record segment.
- Signals are never deleted from the public record, including losses and expired ones.
- Docker does not run on the dev machine; images are verified in CI only.

## 7. Claude Code tooling

Configured in `.mcp.json` (no secrets in the file):

| Server | Use | Setup needed from you |
|---|---|---|
| GitHub MCP | Issues from this plan, PRs, watching CI | Export `GITHUB_PERSONAL_ACCESS_TOKEN` (fine-grained, this repo); `gh auth login` |
| Playwright MCP | Drive the dashboard, UI checks, README screenshots | None (uses `/usr/bin/google-chrome`) |
| Context7 MCP | Current docs for grammY, Drizzle, lightweight-charts, Express 5, Vite | None |
| Postgres MCP | Read-only queries on the **local dev** database | Export `DEV_DATABASE_URL` (never production) |

Installed on 2026-09-26:
- `gh` 2.101.0 at `~/.local/bin/gh` (checksum verified). Run `gh auth login` once.
- Crystal DBA `postgres-mcp` 0.3.0 in `~/.local/share/mcp-servers/postgres-mcp/.venv`, pinned to `mcp<2` because 0.3.0 does not run on MCP SDK v2. It runs in `restricted` (read-only) mode.
- Do **not** use `@modelcontextprotocol/server-postgres` (archived, SQL-injection bypass of read-only) or the npm package `mcp-server-pg` (npm replaced it with a `0.0.1-security` placeholder, which means it was removed as malicious).

Claude Code asks you to approve project MCP servers from `.mcp.json` the first time the project opens.

Also useful from the official plugin marketplace (`/plugin` in Claude Code): `code-review`, `security-guidance`, `pr-review-toolkit`, and the TypeScript/Python language servers.
