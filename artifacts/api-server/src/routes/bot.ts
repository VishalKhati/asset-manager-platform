import { Router, type Request } from "express";
import { requireAuth }   from "../middlewares/auth.js";
import { botRegistry }   from "../lib/botState.js";
import { evaluate, getMaValues } from "../lib/botEngine.js";
import { fetchCandles, fetchCurrentPrice, fetchHistoricalCandles } from "../lib/priceService.js";
import { notifier }      from "../lib/notifier.js";
import { notifyUser }    from "../lib/notificationService.js";
import { runBacktest, runOptimize } from "../lib/backtester.js";
import {
  persistTrade,
  updateTradeClose,
  persistConfig,
  persistStatus,
  persistLog,
  persistWebhook,
  removeWebhook,
} from "../lib/persistence.js";
import { db }   from "@workspace/db";
import { sql }  from "drizzle-orm";
import crypto from "crypto";

const router = Router();
router.use(requireAuth);

// ─── Symbol validation middleware ─────────────────────────────────────────────

router.use((req, res, next) => {
  const raw = req.query["symbol"];
  if (raw !== undefined) {
    const sym = String(raw).toUpperCase();
    if (!botRegistry.isSupported(sym)) {
      res.status(400).json({
        ok:    false,
        error: `Unsupported symbol "${sym}". Supported: ${botRegistry.symbols().join(", ")}`,
      });
      return;
    }
  }
  next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getState(req: Request) {
  const sym = String(req.query["symbol"] ?? "XAUUSD").toUpperCase();
  return botRegistry.getOrCreate(req.userId, sym);
}

const SYMBOL_RISK: Record<string, { sl: number; tp: number; lots: number; slPips: number; tpPips: number }> = {
  XAUUSD: { sl: 15,   tp: 30,   lots: 0.01,  slPips: 15,  tpPips: 30   },
  BTCUSD: { sl: 500,  tp: 1000, lots: 0.001, slPips: 500, tpPips: 1000 },
};

function getRisk(symbol: string) {
  return SYMBOL_RISK[symbol.toUpperCase()] ?? SYMBOL_RISK["XAUUSD"]!;
}

function mkLog(level: "info"|"warn"|"error", message: string, meta?: Record<string,unknown>) {
  return { level, message, ts: new Date().toISOString(), meta };
}

// ─── POST /api/bot/start ──────────────────────────────────────────────────────

router.post("/start", (req, res) => {
  const state = getState(req);
  if (state.running) {
    res.json({ ok: true, message: "Bot already running.", startedAt: state.startedAt, symbol: state.symbol });
    return;
  }
  state.running   = true;
  state.startedAt = new Date().toISOString();
  state.stoppedAt = undefined;

  const entry = mkLog("info", "Bot started.", { mode: state.config.mode, symbol: state.symbol });
  state.logs.unshift(entry);
  notifier.fire("bot_started", { symbol: state.symbol, mode: state.config.mode }).catch(() => {});
  notifyUser(req.userId, "bot_started", { symbol: state.symbol, mode: state.config.mode }).catch(() => {});

  persistStatus({ userId: req.userId, symbol: state.symbol, running: true, startedAt: state.startedAt, tradesToday: state.tradesToday, lastResetDate: state.lastResetDate })
    .catch(err => req.log.error({ err }, "DB persist status failed"));
  persistLog(req.userId, state.symbol, entry)
    .catch(err => req.log.error({ err }, "DB persist log failed"));

  res.json({ ok: true, message: "Bot started.", startedAt: state.startedAt, symbol: state.symbol });
});

// ─── POST /api/bot/stop ───────────────────────────────────────────────────────

router.post("/stop", (req, res) => {
  const state = getState(req);
  if (!state.running) {
    res.json({ ok: true, message: "Bot already stopped.", symbol: state.symbol });
    return;
  }
  state.running   = false;
  state.stoppedAt = new Date().toISOString();

  const entry = mkLog("info", "Bot stopped.", { stoppedAt: state.stoppedAt });
  state.logs.unshift(entry);
  notifier.fire("bot_stopped", { symbol: state.symbol }).catch(() => {});
  notifyUser(req.userId, "bot_stopped", { symbol: state.symbol }).catch(() => {});

  persistStatus({ userId: req.userId, symbol: state.symbol, running: false, startedAt: state.startedAt, stoppedAt: state.stoppedAt, tradesToday: state.tradesToday, lastResetDate: state.lastResetDate })
    .catch(err => req.log.error({ err }, "DB persist status failed"));
  persistLog(req.userId, state.symbol, entry)
    .catch(err => req.log.error({ err }, "DB persist log failed"));

  res.json({ ok: true, message: "Bot stopped.", stoppedAt: state.stoppedAt, symbol: state.symbol });
});

// ─── GET /api/bot/status ──────────────────────────────────────────────────────

router.get("/status", (req, res) => {
  const state = getState(req);
  res.json({
    ok:            true,
    symbol:        state.symbol,
    running:       state.running,
    mode:          state.config.mode,
    startedAt:     state.startedAt ?? null,
    stoppedAt:     state.stoppedAt ?? null,
    tradesToday:   state.tradesToday,
    tradesAllowed: state.config.risk.maxTradesPerDay,
    lastSignal:    state.lastSignal,
  });
});

// ─── GET /api/bot/symbols ─────────────────────────────────────────────────────

router.get("/symbols", (_req, res) => {
  res.json({ ok: true, symbols: botRegistry.symbols() });
});

// ─── GET /api/bot/signal ──────────────────────────────────────────────────────

router.get("/signal", async (req, res) => {
  const state = getState(req);
  try {
    const candles = await fetchCandles(state.symbol);
    const price   = candles.length ? candles[candles.length - 1]!.close : null;
    const mas     = getMaValues(candles, state.config.strategies.maFilter.periods);
    const signal  = evaluate(candles, state.config);
    signal.price  = price ?? undefined;
    state.lastSignal = signal;

    if (signal.signal) {
      notifier.fire("signal", { symbol: state.symbol, signal, price, mas }).catch(() => {});
      notifyUser(req.userId, "signal", { symbol: state.symbol, signal, price }).catch(() => {});
    }

    if (signal.signal && state.running && state.config.mode === "live") {
      if (state.canTrade()) {
        const entry = price ?? 0;
        const risk  = getRisk(state.symbol);
        const sl    = signal.signal === "BUY"  ? entry - risk.sl : entry + risk.sl;
        const tp    = signal.signal === "BUY"  ? entry + risk.tp : entry - risk.tp;

        const trade = {
          id:         crypto.randomUUID(),
          symbol:     state.symbol,
          direction:  signal.signal,
          entry, sl, tp,
          lots:       risk.lots,
          slPips:     risk.slPips,
          tpPips:     risk.tpPips,
          confidence: signal.confidence,
          strategies: signal.agreeing,
          openedAt:   new Date().toISOString(),
          status:     "open" as const,
        };
        state.addTrade(trade);

        const logEntry = mkLog("info", `Trade opened: ${signal.signal} @ ${entry}`, { tradeId: trade.id });
        state.logs.unshift(logEntry);
        notifier.fire("trade_opened", trade).catch(() => {});
        notifyUser(req.userId, "trade_opened", trade as unknown as Record<string,unknown>).catch(() => {});

        persistTrade(req.userId, trade).catch(err => req.log.error({ err }, "DB persist trade failed"));
        persistLog(req.userId, state.symbol, logEntry).catch(err => req.log.error({ err }, "DB persist log failed"));
      } else {
        const logEntry = mkLog("warn", "Signal fired but max trades per day reached.");
        state.logs.unshift(logEntry);
        persistLog(req.userId, state.symbol, logEntry).catch(() => {});
      }
    }

    res.json({ ok: true, symbol: state.symbol, signal, price, mas, candleCount: candles.length, candles: candles.slice(-60) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const logEntry = mkLog("error", `Signal evaluation error: ${msg}`);
    state.logs.unshift(logEntry);
    persistLog(req.userId, state.symbol, logEntry).catch(() => {});
    res.status(500).json({ ok: false, error: msg });
  }
});

// ─── GET /api/bot/price ───────────────────────────────────────────────────────

router.get("/price", async (req, res) => {
  const state = getState(req);
  try {
    const price = await fetchCurrentPrice(state.symbol);
    res.json({ ok: true, price, symbol: state.symbol, ts: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── GET /api/bot/history ─────────────────────────────────────────────────────

router.get("/history", (req, res) => {
  const state  = getState(req);
  const limit  = Math.min(parseInt(String(req.query["limit"]  ?? "50"),  10), 200);
  const offset = Math.max(parseInt(String(req.query["offset"] ?? "0"),   10), 0);
  const status = req.query["status"] as string | undefined;

  let trades = state.trades;
  if (status) trades = trades.filter(t => t.status === status);

  const total  = trades.length;
  const page   = trades.slice(offset, offset + limit);
  const wins   = trades.filter(t => t.status === "closed" && (t.pnl ?? 0) > 0).length;
  const losses = trades.filter(t => t.status === "closed" && (t.pnl ?? 0) < 0).length;
  const pnl    = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);

  res.json({ ok: true, symbol: state.symbol, total, offset, limit, trades: page, stats: { wins, losses, pnl: parseFloat(pnl.toFixed(2)) } });
});

// ─── POST /api/bot/history/:id/close ─────────────────────────────────────────

router.post("/history/:id/close", (req, res) => {
  const state = getState(req);
  const trade = state.trades.find(t => t.id === req.params["id"]);
  if (!trade) { res.status(404).json({ ok: false, error: "Trade not found." }); return; }
  if (trade.status !== "open") { res.status(400).json({ ok: false, error: "Trade already closed." }); return; }

  const closePrice = parseFloat(String(req.body?.["price"] ?? trade.entry));
  trade.status   = "closed";
  trade.closedAt = new Date().toISOString();
  trade.pnl      = parseFloat(((trade.direction === "BUY" ? closePrice - trade.entry : trade.entry - closePrice) * trade.lots * 100).toFixed(2));

  const logEntry = mkLog("info", `Trade closed: ${trade.direction} pnl=${trade.pnl}`, { tradeId: trade.id });
  state.logs.unshift(logEntry);
  notifier.fire("trade_closed", trade).catch(() => {});
  notifyUser(req.userId, "trade_closed", trade as unknown as Record<string,unknown>).catch(() => {});

  updateTradeClose(trade).catch(err => req.log.error({ err }, "DB update trade close failed"));
  persistLog(req.userId, state.symbol, logEntry).catch(err => req.log.error({ err }, "DB persist log failed"));

  res.json({ ok: true, trade });
});

// ─── GET /api/bot/pnl-daily ───────────────────────────────────────────────────
// Returns daily P&L for the last 30 days, grouped by calendar date (UTC).

router.get("/pnl-daily", async (req, res) => {
  const sym = String(req.query["symbol"] ?? "XAUUSD").toUpperCase();
  const days = Math.min(Math.max(parseInt(String(req.query["days"] ?? "30"), 10), 7), 90);

  try {
    const result = await db
      .execute(
        sql`
          SELECT
            DATE(closed_at::timestamp)                                         AS day,
            ROUND(COALESCE(SUM(pnl), 0)::numeric, 2)                          AS pnl,
            CAST(COUNT(*)                                        AS int)        AS trades,
            CAST(COUNT(*) FILTER (WHERE pnl > 0)                AS int)        AS wins,
            CAST(COUNT(*) FILTER (WHERE pnl < 0)                AS int)        AS losses,
            ROUND(COALESCE(SUM(pnl) FILTER (WHERE pnl > 0), 0)::numeric, 2)   AS gross_profit,
            ROUND(COALESCE(SUM(pnl) FILTER (WHERE pnl < 0), 0)::numeric, 2)   AS gross_loss
          FROM bot_trades
          WHERE user_id  = ${req.userId}
            AND symbol   = ${sym}
            AND status   = 'closed'
            AND closed_at IS NOT NULL
            AND closed_at::timestamp >= NOW() - (${days} || ' days')::interval
          GROUP BY DATE(closed_at::timestamp)
          ORDER BY day ASC
        `
      );

    const rows = (result as unknown as { rows: unknown[] }).rows ?? result;

    // Convert raw rows to typed objects
    const data = (rows as Array<{
      day: string; pnl: string; trades: number;
      wins: number; losses: number; gross_profit: string; gross_loss: string;
    }>).map(r => ({
      day:         String(r.day).slice(0, 10),
      pnl:         parseFloat(r.pnl),
      trades:      r.trades,
      wins:        r.wins,
      losses:      r.losses,
      grossProfit: parseFloat(r.gross_profit),
      grossLoss:   parseFloat(r.gross_loss),
    }));

    const totalPnl    = parseFloat(data.reduce((s, d) => s + d.pnl, 0).toFixed(2));
    const totalTrades = data.reduce((s, d) => s + d.trades, 0);
    const totalWins   = data.reduce((s, d) => s + d.wins, 0);

    res.json({ ok: true, symbol: sym, days, data, summary: { totalPnl, totalTrades, totalWins } });
  } catch (err) {
    req.log.error({ err }, "pnl-daily query failed");
    res.status(500).json({ ok: false, error: "Failed to fetch P&L data." });
  }
});

// ─── GET /api/bot/config ──────────────────────────────────────────────────────

router.get("/config", (req, res) => {
  const state = getState(req);
  res.json({ ok: true, symbol: state.symbol, config: state.config });
});

// ─── PUT /api/bot/config ──────────────────────────────────────────────────────

router.put("/config", (req, res) => {
  const state = getState(req);
  const body  = req.body as Partial<typeof state.config>;
  if (!body || typeof body !== "object") {
    res.status(400).json({ ok: false, error: "Invalid config body." }); return;
  }
  if (body.mode)       state.config.mode       = body.mode;
  if (body.engine)     Object.assign(state.config.engine,     body.engine);
  if (body.risk)       Object.assign(state.config.risk,       body.risk);
  if (body.strategies) Object.assign(state.config.strategies, body.strategies);

  const logEntry = mkLog("info", "Config updated.", { config: state.config });
  state.logs.unshift(logEntry);

  persistConfig(req.userId, state.symbol, state.config).catch(err => req.log.error({ err }, "DB persist config failed"));
  persistLog(req.userId, state.symbol, logEntry).catch(err => req.log.error({ err }, "DB persist log failed"));

  res.json({ ok: true, symbol: state.symbol, config: state.config });
});

// ─── GET /api/bot/log ─────────────────────────────────────────────────────────

router.get("/log", (req, res) => {
  const state = getState(req);
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "100"), 10), 500);
  const level = req.query["level"] as string | undefined;
  let logs = state.logs;
  if (level) logs = logs.filter(l => l.level === level);
  res.json({ ok: true, symbol: state.symbol, total: logs.length, logs: logs.slice(0, limit) });
});

// ─── POST /api/bot/log ────────────────────────────────────────────────────────

router.post("/log", (req, res) => {
  const state = getState(req);
  const { level = "info", message, meta } = req.body ?? {};
  if (!message) { res.status(400).json({ ok: false, error: "message required." }); return; }

  const logEntry = { level: level as "info"|"warn"|"error"|"debug", message: String(message), ts: new Date().toISOString(), meta };
  state.logs.unshift(logEntry);
  if (state.logs.length > 500) state.logs.pop();

  persistLog(req.userId, state.symbol, logEntry).catch(err => req.log.error({ err }, "DB persist log failed"));

  res.json({ ok: true });
});

// ─── POST /api/bot/trades ─────────────────────────────────────────────────────

router.post("/trades", (req, res) => {
  const state = getState(req);
  const { direction, entry, sl, tp, lots, slPips, tpPips, confidence, strategies, bridgeId } = req.body ?? {};

  if (!direction || entry == null) {
    res.status(400).json({ ok: false, error: "direction and entry are required." }); return;
  }

  const trade = {
    id:         crypto.randomUUID(),
    symbol:     state.symbol,
    direction:  direction as "BUY" | "SELL",
    entry:      parseFloat(String(entry)),
    sl:         parseFloat(String(sl ?? 0)),
    tp:         parseFloat(String(tp ?? 0)),
    lots:       parseFloat(String(lots ?? 0.01)),
    slPips:     parseFloat(String(slPips ?? 15)),
    tpPips:     parseFloat(String(tpPips ?? 30)),
    confidence: parseFloat(String(confidence ?? 0)),
    strategies: Array.isArray(strategies) ? strategies as string[] : [],
    openedAt:   new Date().toISOString(),
    status:     "open" as const,
    reason:     bridgeId ? `MT5 Bridge (${bridgeId})` : "Bridge",
  };
  state.addTrade(trade);

  const logEntry = mkLog("info", `[Bridge] Trade registered: ${direction} @ ${entry}`, { tradeId: trade.id, bridgeId });
  state.logs.unshift(logEntry);
  notifier.fire("trade_opened", trade).catch(() => {});

  persistTrade(req.userId, trade).catch(err => req.log.error({ err }, "DB persist trade failed"));
  persistLog(req.userId, state.symbol, logEntry).catch(err => req.log.error({ err }, "DB persist log failed"));

  res.status(201).json({ ok: true, trade });
});

// ─── POST /api/bot/bridge-heartbeat ──────────────────────────────────────────

router.post("/bridge-heartbeat", (req, res) => {
  const state = getState(req);
  state.bridgeLastPing  = new Date().toISOString();
  state.bridgeVersion   = String(req.body?.version ?? "unknown");
  res.json({ ok: true, ts: state.bridgeLastPing, symbol: state.symbol });
});

// ─── GET /api/bot/bridge-status ───────────────────────────────────────────────

router.get("/bridge-status", (req, res) => {
  const state     = getState(req);
  const lastPing  = state.bridgeLastPing ?? null;
  const connected = lastPing
    ? (Date.now() - new Date(lastPing).getTime()) < 2 * 60 * 1000
    : false;
  res.json({
    ok:         true,
    symbol:     state.symbol,
    connected,
    lastPing,
    version:    state.bridgeVersion ?? null,
  });
});

// ─── POST /api/bot/backtest ───────────────────────────────────────────────────

router.post("/backtest", async (req, res) => {
  const state = getState(req);
  try {
    const candles    = await fetchHistoricalCandles(state.symbol);
    const overrides  = req.body?.config ?? {};
    const mergedConf = {
      ...state.config,
      engine:     { ...state.config.engine,     ...(overrides.engine     ?? {}) },
      risk:       { ...state.config.risk,        ...(overrides.risk       ?? {}) },
      strategies: {
        liquiditySweep:  { ...state.config.strategies.liquiditySweep,  ...(overrides.strategies?.liquiditySweep  ?? {}) },
        fairValueGap:    { ...state.config.strategies.fairValueGap,    ...(overrides.strategies?.fairValueGap    ?? {}) },
        maFilter:        { ...state.config.strategies.maFilter,        ...(overrides.strategies?.maFilter        ?? {}) },
        orderBlock:      { ...state.config.strategies.orderBlock,      ...(overrides.strategies?.orderBlock      ?? {}) },
        marketStructure: { ...state.config.strategies.marketStructure, ...(overrides.strategies?.marketStructure ?? {}) },
        sessionFilter:   { ...state.config.strategies.sessionFilter,   ...(overrides.strategies?.sessionFilter   ?? {}) },
      },
    };
    const initialEquity = parseFloat(String(req.body?.initialEquity ?? "10000"));
    const result = runBacktest(candles, mergedConf, initialEquity);
    res.json({ ok: true, symbol: state.symbol, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const logEntry = mkLog("error", `Backtest error: ${msg}`);
    state.logs.unshift(logEntry);
    persistLog(req.userId, state.symbol, logEntry).catch(() => {});
    res.status(500).json({ ok: false, error: msg });
  }
});

// ─── POST /api/bot/optimize ───────────────────────────────────────────────────

router.post("/optimize", async (req, res) => {
  const state = getState(req);
  try {
    const candles       = await fetchHistoricalCandles(state.symbol);
    const initialEquity = parseFloat(String(req.body?.initialEquity ?? "10000"));
    const sortBy        = (req.body?.sortBy ?? "profitFactor") as "profitFactor" | "winRate" | "totalPnl" | "totalTrades";
    const result        = runOptimize(candles, state.config, initialEquity, sortBy);
    res.json({ ok: true, symbol: state.symbol, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const logEntry = mkLog("error", `Optimizer error: ${msg}`);
    state.logs.unshift(logEntry);
    persistLog(req.userId, state.symbol, logEntry).catch(() => {});
    res.status(500).json({ ok: false, error: msg });
  }
});

// ─── GET /api/bot/webhooks ────────────────────────────────────────────────────

router.get("/webhooks", (_req, res) => {
  res.json({ ok: true, webhooks: notifier.list() });
});

// ─── POST /api/bot/webhooks ───────────────────────────────────────────────────

router.post("/webhooks", (req, res) => {
  const { url, events, name, secret } = req.body ?? {};
  if (!url || typeof url !== "string") {
    res.status(400).json({ ok: false, error: "url is required." }); return;
  }
  if (!Array.isArray(events) || events.length === 0) {
    res.status(400).json({ ok: false, error: "events must be a non-empty array." }); return;
  }
  const reg = notifier.register(url, events, name ?? "Unnamed", secret);

  persistWebhook({ id: reg.id, userId: req.userId, url: reg.url, events: reg.events, name: reg.name, secret: reg.secret })
    .catch(err => req.log.error({ err }, "DB persist webhook failed"));

  res.status(201).json({ ok: true, webhook: reg });
});

// ─── DELETE /api/bot/webhooks/:id ────────────────────────────────────────────

router.delete("/webhooks/:id", (req, res) => {
  const id      = req.params["id"]!;
  const removed = notifier.unregister(id);
  if (!removed) { res.status(404).json({ ok: false, error: "Webhook not found." }); return; }

  removeWebhook(id).catch(err => req.log.error({ err }, "DB remove webhook failed"));

  res.json({ ok: true });
});

export default router;
