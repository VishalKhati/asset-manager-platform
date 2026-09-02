# MT5 Bridge

Connects your **local MetaTrader 5** to the **deployed Replit API**.

```
[Replit API] ←→ [Node.js bridge.js] ←→ [File IPC] ←→ [MT5 EA]
```

## How it works

| Step | Who | What |
|------|-----|------|
| 1 | bridge.js | Polls `/api/bot/signal` every 30 s |
| 2 | bridge.js | Writes `pending_signal.json` to IPC folder |
| 3 | MT5 EA | Reads signal file, sends market order to broker |
| 4 | MT5 EA | Writes `trade_result.json` to IPC folder |
| 5 | bridge.js | Reads result, POSTs to `/api/bot/history` and `/api/bot/log` |

---

## Quick start

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
```
API_BASE_URL=https://your-app.replit.app/api
API_TOKEN=changeme          # same as BOT_API_TOKEN on server
IPC_DIR=C:\Users\You\AppData\Roaming\MetaQuotes\Terminal\<HASH>\MQL5\Files\smc_bridge
TRADE_MODE=demo             # change to "live" when ready
MIN_CONFIDENCE=0.70
POLL_INTERVAL_MS=30000
```

### 2. Install MT5 Expert Advisor

1. Open MetaTrader 5
2. Go to **Tools → Open Data Folder**
3. Navigate to `MQL5\Experts\`
4. Copy `mt5_connector.mq5` there and rename it `smc_bridge.mq5`
5. Open MetaEditor (`F4` in MT5), open `smc_bridge.mq5`, press **F7** to compile
6. In MT5, drag `smc_bridge` EA from the Navigator onto the **XAUUSD, M5** chart
7. In EA settings, set **IpcFolder** to `smc_bridge` (it resolves to `MQL5/Files/smc_bridge`)
8. Enable: **Allow DLL imports**, **Allow file operations**, **Allow automated trading**

### 3. Set IPC_DIR to the same path

Find the full path of `MQL5\Files\smc_bridge` (same as above, full path):
```
C:\Users\You\AppData\Roaming\MetaQuotes\Terminal\<HASH>\MQL5\Files\smc_bridge
```
Set that as `IPC_DIR` in your `.env`.

### 4. Start the bridge

```bash
node bridge.js
```

You should see:
```
[INFO ] === SMC MT5 Bridge starting ===
[INFO ] API connected. { botRunning: true, mode: 'signal' }
[INFO ] Bridge is running. Press Ctrl+C to stop.
```

---

## Files

| File | Description |
|------|-------------|
| `bridge.js` | Main polling loop — run this with Node.js |
| `apiClient.js` | Fetch wrapper for the Replit backend |
| `ipc.js` | File-based IPC — writes/reads signal and result files |
| `logger.js` | Console + file logger (no dependencies) |
| `env.js` | Minimal .env loader (no dotenv needed) |
| `mt5_connector.mq5` | MQL5 Expert Advisor — executes trades in MT5 |
| `.env.example` | Configuration template |

---

## IPC files (in IPC_DIR)

| File | Written by | Purpose |
|------|-----------|---------|
| `pending_signal.json` | bridge.js | Signal command for MT5 EA |
| `signal_ack.json` | MT5 EA | Confirms signal received |
| `trade_result.json` | MT5 EA | Trade open/close result |
| `bridge_heartbeat.json` | bridge.js | Liveness ping (updated every 5 s) |

---

## Demo vs Live mode

```
TRADE_MODE=demo   → bridge logs the signal but MT5 EA does NOT send any real order
TRADE_MODE=live   → MT5 EA sends a real market order to your broker
```

Always test in demo mode first. The bridge and EA also have **separate** demo switches:
- Bridge: `TRADE_MODE=demo` in `.env`
- EA:     `DemoMode=true` in EA input parameters

Both must be set to live for real orders to execute.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Cannot reach API` | Check `API_BASE_URL` and that Replit app is deployed |
| EA shows `Node bridge NOT running` | Make sure `bridge.js` is running and IPC_DIR is correct |
| No signal forwarded | Check `MIN_CONFIDENCE` — signal must exceed this threshold |
| Order rejected | Check EA logs in MT5 Experts tab; ensure EA has trade permissions |
| `signal_ack.json` not created | EA is not reading IPC folder — verify `IpcFolder` input matches path |
