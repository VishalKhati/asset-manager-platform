# Runbook

How to run, deploy and operate the signal service. The architecture is in [DESIGN.md](DESIGN.md).

## Local development

Requirements: Node 22 (20.15 works), pnpm 10, Python 3.11+, PostgreSQL 16 (or `pgserver`, see below).

```bash
pnpm install --frozen-lockfile
export DATABASE_URL=postgres://postgres@localhost:5432/amp_dev FEEDER_HMAC_SECRET=dev-secret
pnpm --filter @workspace/api-server run build
node artifacts/api-server/dist/cli.mjs migrate
ADMIN_PASSWORD='choose-a-long-one' node artifacts/api-server/dist/cli.mjs create-admin admin
node artifacts/api-server/dist/index.mjs      # API on :8080
node artifacts/api-server/dist/engine.mjs     # engine (second terminal)
PORT=5173 pnpm --filter @workspace/dashboard run dev   # dashboard, proxies /api to :8080
```

No PostgreSQL installed? `pip install pgserver` then:

```python
import pgserver; print(pgserver.get_server("~/.cache/amp-pg/data", cleanup_mode=None).get_uri())
```

**Demo data without MT5.** Push a fixture through the real ingest API. Set `LATE_SIGNAL_S=999999999` on the engine so historical signals count as posted:

```bash
cd feeder && python -m mt5feeder.replay --csv ../fixtures/golden/dst_gap_mar_2021/m1.csv \
  --api-url http://localhost:8080 --secret dev-secret --shift-weeks auto
```

## Tests

| What | Command |
|---|---|
| Strategy library and golden parity (TS) | `pnpm --filter @workspace/strategy test` |
| API and engine against Postgres | `TEST_DATABASE_URL=postgres://… pnpm --filter @workspace/api-server test` (resets that DB) |
| Research and golden parity (Python) | `cd research && pytest` |
| Feeder | `cd feeder && pytest` |
| Typecheck and build everything | `pnpm run build` |

## Deploy (Linux VPS)

1. Install Docker and Tailscale on the VPS. Open ports 80 and 443 only. SSH by key.
2. Copy `deploy/compose.yml`, `deploy/Caddyfile`, `deploy/prometheus.yml` and `deploy/.env.example` to `~/gold-signals/`. Rename the env file to `.env`, fill it in, and run `chmod 600 .env`.
3. Run `docker compose up -d`. Migrations run automatically in the `migrate` service before `api` and `engine` start.
4. Create the first admin: `docker compose run --rm -e ADMIN_PASSWORD='…' api node dist/cli.mjs create-admin admin`.
5. After that, deploy from GitHub: **Actions → Deploy → Run workflow** with an image tag (`sha-xxxxxxx` from CI). It needs the `production` environment secrets `DEPLOY_HOST`, `DEPLOY_USER` and `DEPLOY_SSH_KEY`.

**Rollback:** run the Deploy workflow again with the previous `sha-` tag.

## MT5 feeder (Windows VPS)

See [feeder/README.md](../feeder/README.md). Point `API_URL` at the Linux VPS's Tailscale address. Caddy only lets tailnet addresses reach `/api/ingest`, and every request is HMAC-signed.

## Telegram

1. Create a bot with @BotFather and put the token in `TELEGRAM_BOT_TOKEN`.
2. Create a private channel for the forward test, add the bot as an admin, and set `TG_CHANNEL_PRIVATE_ID`. Get the channel id by forwarding a channel post to @userinfobot.
3. Put your own numeric user id in `TG_ADMIN_IDS`, then message the bot `/health`.
4. To go public, set `TG_CHANNEL_PUBLIC_ID` and `SIGNAL_MODE=live` **only after Gate 2 and Gate 3** (see PLAN.md).

## Everyday operations

| Situation | What to do |
|---|---|
| "Feed silent" alert | Check the Windows VPS: MT5 connected? `feeder.log`? Restart the `mt5feeder` service. Bars queued during the outage are sent on recovery; signals decided late are recorded but not posted. |
| Need to stop signals | `/pause reason` in Telegram, or **Pause signals** on the Overview page. Open signals keep being tracked. `/resume` to continue. |
| Engine paused itself with `news_stale` | The calendar has not refreshed for 72 h. Check outbound HTTPS from the VPS, then `/resume`. |
| Telegram queue shows failed messages | Check the bot is still an admin of the channel and the token is valid. Failed rows stay in `notification_outbox` with the error. |
| Change strategy parameters | Only with a new walk-forward report. Use the Strategy page, which saves a new audited version. |
| Weekly forward-test parity check | `cd research && .venv/bin/python scripts/parity_check.py --db postgres://… --from 2026-10-01 --to 2026-10-08`. Exit code 0 means the live engine matched the Python reference signal for signal. |
| Upload a research report | `docker compose run --rm -v $PWD/walkforward.json:/r.json api node dist/cli.mjs upload-report /r.json --public` |

## Backups and restore drill (monthly)

Daily dumps land in `~/gold-signals/backups`, keeping 7 daily, 4 weekly and 6 monthly. Copy them off the box, for example with `rclone` to Backblaze B2 or Cloudflare R2.

Restore into a scratch database and check the numbers:

```bash
gunzip -c backups/last/amp-latest.sql.gz | psql postgres://…/amp_restore
psql …/amp_restore -c "select count(*), max(t) from signals"
```

Record the date of each drill in PLAN.md.

## Rotating secrets

| Secret | How to rotate |
|---|---|
| `JWT_SECRET` | Change it and restart `api`. Everyone signs in again. |
| `FEEDER_HMAC_SECRET` | Change it on both sides, then restart `api` and the `mt5feeder` service. |
| `TELEGRAM_BOT_TOKEN` | Revoke it in @BotFather, set the new one, then restart `engine`. |
| A user's sessions | Suspend and re-activate the user on the Users page. That bumps their token version. |
