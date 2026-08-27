# SMC Gold Bot - Asset Manager

SMC Gold Bot is a trading automation and asset monitoring project for XAUUSD and BTCUSD. It combines a dashboard, Smart Money Concepts signal engine, backtesting, optimization, MT5 bridge, Telegram/email alert workflows, and n8n automation templates.

## Why It Matters

This project is resume-worthy because it shows product thinking beyond a simple dashboard: signal generation, risk management, trading configuration, historical backtesting, integrations, and operations workflows.

## Tech Stack

- Frontend: Vue, Vite, TypeScript, Chart.js, Pinia
- Backend/API artifacts: workspace API packages
- Bot logic: Node.js signal engine and risk manager
- Automation: n8n workflow exports
- Trading bridge: MT5 bridge scripts and MetaTrader connector
- Workspace: pnpm monorepo

## Main Features

- Live dashboard for XAUUSD and BTCUSD
- Smart Money Concepts strategy engine
- Signal modes: strict, flex, weighted
- Risk configuration for stop loss, take profit, and lot sizing
- Backtesting and optimizer flows
- Price alerts and notification workflows
- MT5 bridge support
- n8n workflow templates for bot execution and Telegram alerts

## Project Structure

```text
artifacts/dashboard       Vue + Vite dashboard
artifacts/api-server      API/backend artifact
bot/                      Signal engine and risk manager
backtest/                 Backtest and report scripts
mt5_bridge/               MT5 bridge implementation and docs
automation_n8n/           n8n workflow JSON files
USER_GUIDE.md             Detailed user guide
replit.md                 Implementation notes
```

## Setup

```bash
pnpm install --frozen-lockfile
```

Optional integration configuration:

- `mt5_bridge/.env.example`
- `automation_n8n/.env.example`

Do not commit live trading credentials, Telegram tokens, broker keys, or local `.env` files.

## Verification

Verified on 2026-08-27:

```bash
pnpm run typecheck
```

Result: passed.

The root build requires runtime environment variables and attempts to build the dev-only mockup sandbox. A focused dashboard build passed with:

```bash
PORT=18909 BASE_PATH=/ pnpm --filter @workspace/dashboard run build
```

Notes:

- Vite warns that Node.js 20.19+ or 22.12+ is preferred; current local Node was 20.15.1.
- Root `pnpm run build` fails if `PORT`/`BASE_PATH` are not provided for Vite configs.

## Resume Bullet

Built a trading automation dashboard with Smart Money Concepts signal logic, configurable risk controls, backtesting, optimizer workflows, MT5 bridge integration, and n8n alert automation for XAUUSD and BTCUSD monitoring.

## Resume Readiness

Status: Strong resume candidate.

Use this as one of the top three portfolio projects after adding screenshots and a clear simulation/not financial advice disclaimer in any public repo.
