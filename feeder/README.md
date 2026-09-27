# MT5 feeder

A small Python service for the Windows VPS that runs MetaTrader 5. It reads **closed** one-minute XAUUSD bars and the spread from the terminal, and pushes them to the signal service's ingest API. The server builds M5 and M15 bars from these, so there is one source of market data.

- Converts broker server time to UTC. The offset is detected from the last tick and reported in every heartbeat.
- Queues bars in a local SQLite file before sending, and deletes them only after the API accepts them. API outages and restarts lose nothing.
- Signs every request with HMAC-SHA256 (`X-Feeder-Id`, `X-Timestamp`, `X-Signature`), using the same scheme as `artifacts/api-server/src/middlewares/feederAuth.ts`.
- Sends a heartbeat every 30 seconds with the terminal connection state. The server alerts the admins if bars stop arriving while the market is open.
- Standard library only, plus the `MetaTrader5` package on Windows.

Order execution on a demo account is planned for Phase 10 (see `docs/DESIGN.md` §10). This version only reads data.

## Install on the Windows VPS

1. Install MetaTrader 5 and log in to your demo account. Enable **Tools → Options → Expert Advisors → Allow algorithmic trading** (needed by the Python API even for reading).
2. Install Python 3.12 from python.org, then in this folder:
   ```powershell
   py -3.12 -m venv .venv
   .venv\Scripts\pip install -e .[mt5]
   copy .env.example .env   # then fill in API_URL, FEEDER_HMAC_SECRET and BROKER_SYMBOL
   ```
3. Try it in the foreground first: `.venv\Scripts\python -m mt5feeder.main`. You should see `queued N, sent N`.
4. Install it as a service with [NSSM](https://nssm.cc): `powershell -ExecutionPolicy Bypass -File install\install-service.ps1`.
5. Put the VPS and the Linux server on the same [Tailscale](https://tailscale.com) network and use the server's Tailscale address in `API_URL`. Allow RDP only over Tailscale.

## Test on Linux

The tests use a fake terminal, so they run anywhere:

```bash
python -m venv .venv && .venv/bin/pip install -e .[dev]
.venv/bin/pytest
```

## Notes

- **Broker time.** Most brokers run GMT+2 in winter and GMT+3 in summer. If your broker's offset cannot be detected (no ticks at start-up), set `MT5_UTC_OFFSET_MIN`.
- **Spread.** MT5 reports spread in points per bar. The feeder converts it with the symbol's `point` size.
- **Backfill.** On first start the feeder sends the last `BACKFILL_DAYS` of history, which the engine needs to warm up its indicators.
