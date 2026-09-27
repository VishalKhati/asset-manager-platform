# CLAUDE.md

XAUUSD signal service. Tracker: `PLAN.md`. Architecture: `docs/DESIGN.md`. Frozen rules: `docs/STRATEGY_SPEC.md`. Operations: `docs/RUNBOOK.md`.

## Layout

- `lib/strategy`: pure TypeScript strategy, indicators, tracker, stats. No I/O, no `Date.now()`.
- `research/src/xausig`: the same rules in Python, plus data loading, walk-forward and reports.
- `fixtures/golden/`: shared inputs and expected outputs. Both languages must reproduce them exactly.
- `artifacts/api-server`: Express API (`src/index.ts`), engine process (`src/engine.ts`) and CLI (`src/cli.ts`), bundled by esbuild into self-contained `dist/*.mjs`.
- `artifacts/dashboard`: Vue 3 SPA: public track record plus `/ops` operator pages.
- `lib/db`: Drizzle schema and SQL migrations (`pnpm --filter @workspace/db run generate`).
- `feeder`: Python MT5 feeder for the Windows VPS (stdlib only), plus `mt5feeder.replay` for demos.
- `deploy`: Compose, Caddyfile and env template. `.github/workflows`: CI and manual deploy.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm run build                                   # typecheck + build API and dashboard
pnpm --filter @workspace/strategy test           # TS unit + golden parity
TEST_DATABASE_URL=… pnpm --filter @workspace/api-server test   # integration (resets that DB)
cd research && .venv/bin/pytest && .venv/bin/ruff check .       # Python + golden parity
cd feeder && ../research/.venv/bin/pytest
research/.venv/bin/xausig walkforward            # needs research/data/xauusd_m1.parquet (xausig build-data)
```

## Rules

- Change strategy rules in **both** `lib/strategy` and `research/src/xausig`, bump `STRATEGY_VERSION`, regenerate fixtures with `research/scripts/make_golden.py`, and update `docs/STRATEGY_SPEC.md`. Never hand-edit `fixtures/golden/`.
- Never tune parameters on the holdout or on forward-test results. Log every tried variant in `research/reports/GRAVEYARD.md`.
- Schema changes need a generated migration. CI fails otherwise.
- Market times are UTC epoch seconds everywhere.
- No mock or fallback market data anywhere. Missing data means no signal.

## Machine notes (this dev box)

- No system pip: `python3 -m venv --without-pip .venv` + get-pip.py. `/tmp` is noexec, so keep venvs in the repo.
- Docker does not work locally. Images are built and checked in CI only.
- Local Postgres comes from `pgserver` (installed in `research/.venv`), data in `~/.cache/amp-pg/data`:
  `postgresql://postgres@/amp_test?host=/home/vishal/.cache/amp-pg/data`.
