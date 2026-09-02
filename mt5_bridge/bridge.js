'use strict';

/**
 * SMC Bot — MT5 Bridge v2.0
 *
 * Runs LOCALLY on the same machine as MetaTrader 5.
 * Polls the Replit API for signals and forwards them to MT5 via file-based
 * IPC. Reads trade results from MT5 EA and reports them back to the API.
 *
 * Usage:
 *   cp .env.example .env    # fill in your values
 *   node bridge.js
 *
 * Requirements: Node.js >= 18, MT5 with smc_bridge EA attached.
 * API_TOKEN can be BOT_API_TOKEN (permanent) OR a user JWT (30-day expiry).
 */

require('./env');

const { logger }     = require('./logger');
const ipc            = require('./ipc');
const {
  getSignal, getStatus, createTrade, closeHistoryTrade, postBridgeHeartbeat, pushLog,
} = require('./apiClient');

const BRIDGE_VERSION    = '2.0';
const POLL_INTERVAL_MS  = parseInt(process.env.POLL_INTERVAL_MS || '30000', 10);
const RESULT_CHECK_MS   = parseInt(process.env.RESULT_CHECK_MS  || '5000',  10);
const HEARTBEAT_MS      = parseInt(process.env.HEARTBEAT_MS     || '30000', 10);
const MIN_CONFIDENCE    = parseFloat(process.env.MIN_CONFIDENCE  || '0.70');
const TRADE_MODE        = process.env.TRADE_MODE || 'demo';
const SYMBOL            = (process.env.SYMBOL || 'XAUUSD').toUpperCase();

// Symbol-specific risk defaults (used only if signal has no lots/sl/tp)
const SYMBOL_RISK = {
  XAUUSD: { sl: 15,  tp: 30,   lots: 0.01,  slPips: 15,  tpPips: 30   },
  BTCUSD: { sl: 500, tp: 1000, lots: 0.001, slPips: 500, tpPips: 1000 },
};

function getRisk(sym) {
  return SYMBOL_RISK[sym] || SYMBOL_RISK.XAUUSD;
}

// ─── State ────────────────────────────────────────────────────────────────────

let isRunning       = false;
let pendingBridgeId = null;
let pendingApiId    = null;
let pollTimer       = null;
let resultTimer     = null;
let heartbeatTimer  = null;

// ─── Startup ─────────────────────────────────────────────────────────────────

async function start() {
  logger.info('');
  logger.info('══════════════════════════════════════════════');
  logger.info('  SMC Gold Bot — MT5 Bridge v' + BRIDGE_VERSION);
  logger.info('══════════════════════════════════════════════');
  logger.info(`  API:         ${process.env.API_BASE_URL || 'http://localhost:80/api'}`);
  logger.info(`  Symbol:      ${SYMBOL}`);
  logger.info(`  IPC folder:  ${ipc.IPC_DIR}`);
  logger.info(`  Poll:        ${POLL_INTERVAL_MS}ms`);
  logger.info(`  Confidence:  min ${MIN_CONFIDENCE}`);
  logger.info(`  Trade mode:  ${TRADE_MODE.toUpperCase()}`);
  logger.info('══════════════════════════════════════════════');

  if (TRADE_MODE !== 'demo') {
    logger.warn('');
    logger.warn('⚠  LIVE mode enabled — real trades WILL be executed!');
    logger.warn('   Ensure the MT5 EA also has DemoMode=false.');
    logger.warn('');
  } else {
    logger.info('  Demo mode: signals are forwarded but MT5 EA will NOT');
    logger.info('  place real orders (DemoMode=true in EA settings too).');
  }

  // ── Config validation ──────────────────────────────────────────────────────
  const issues = [];
  if (!process.env.API_BASE_URL) {
    issues.push('API_BASE_URL not set — using localhost (only works in dev)');
  }
  if (!process.env.API_TOKEN || process.env.API_TOKEN === 'changeme') {
    issues.push('API_TOKEN is "changeme" — set it to your BOT_API_TOKEN or user JWT');
  }
  if (!process.env.IPC_DIR || process.env.IPC_DIR === './ipc') {
    issues.push('IPC_DIR not set — using ./ipc (EA must also point to the same folder)');
  }

  if (issues.length > 0) {
    logger.warn('Configuration warnings:');
    issues.forEach(w => logger.warn('  ⚠  ' + w));
    logger.warn('  → Edit your .env file to fix these.');
  }

  ipc.clearAll();

  // ── Verify API connectivity ────────────────────────────────────────────────
  try {
    const status = await getStatus(SYMBOL);
    logger.info(`API connected. Bot ${status.running ? 'RUNNING' : 'STOPPED'} | mode: ${status.mode} | symbol: ${status.symbol}`);
    isRunning = status.running;
  } catch (err) {
    logger.error(`Cannot reach API: ${err.message}`);
    logger.error('Check: API_BASE_URL is correct, app is deployed, and API_TOKEN matches.');
    logger.warn('Retrying in 15 seconds…');
    setTimeout(start, 15_000);
    return;
  }

  // ── Start heartbeat ────────────────────────────────────────────────────────
  ipc.writeHeartbeat();
  heartbeatTimer = setInterval(async () => {
    ipc.writeHeartbeat();
    await postBridgeHeartbeat(SYMBOL, BRIDGE_VERSION);
  }, HEARTBEAT_MS);
  // Also send one immediately
  await postBridgeHeartbeat(SYMBOL, BRIDGE_VERSION);

  // ── Start main loops ───────────────────────────────────────────────────────
  await pollSignal();
  pollTimer   = setInterval(pollSignal,       POLL_INTERVAL_MS);
  resultTimer = setInterval(checkTradeResult, RESULT_CHECK_MS);

  setupShutdown();
  logger.info(`Bridge is running for ${SYMBOL}. Press Ctrl+C to stop.`);
  logger.info('');
}

// ─── Signal polling ───────────────────────────────────────────────────────────

async function pollSignal() {
  try {
    const status = await getStatus(SYMBOL);
    isRunning = status.running;

    if (!isRunning) {
      logger.debug(`Bot stopped on server for ${SYMBOL} — skipping signal.`);
      return;
    }

    logger.info(`Polling signal for ${SYMBOL}…`);
    const data   = await getSignal(SYMBOL);
    const signal = data.signal;

    if (!signal || !signal.signal) {
      logger.info(`No signal. (${signal?.reason ?? 'no reason'})`);
      return;
    }

    if (signal.confidence < MIN_CONFIDENCE) {
      logger.info(`Signal below confidence threshold. got=${signal.confidence.toFixed(2)} min=${MIN_CONFIDENCE}`);
      return;
    }

    if (pendingBridgeId) {
      logger.warn(`Pending trade still open (${pendingBridgeId}) — skipping new signal.`);
      return;
    }

    logger.info(`Signal: ${signal.signal} | confidence=${signal.confidence.toFixed(2)} | strategies=${signal.agreeing?.join(',')}`);
    await forwardSignalToMT5(signal, data.price);

  } catch (err) {
    const msg = `Poll error: ${err.message}`;
    logger.error(msg);
    await pushLog(SYMBOL, 'error', `[Bridge] ${msg}`).catch(() => {});
  }
}

// ─── Forward signal to MT5 ───────────────────────────────────────────────────

async function forwardSignalToMT5(signal, currentPrice) {
  const entry    = currentPrice ?? 0;
  const risk     = getRisk(SYMBOL);
  const sl       = signal.signal === 'BUY'  ? entry - risk.sl  : entry + risk.sl;
  const tp       = signal.signal === 'BUY'  ? entry + risk.tp  : entry - risk.tp;
  const bridgeId = `br_${Date.now()}`;

  const tradeCommand = {
    id:         bridgeId,
    symbol:     SYMBOL,
    direction:  signal.signal,
    entry:      parseFloat(entry.toFixed(2)),
    sl:         parseFloat(sl.toFixed(2)),
    tp:         parseFloat(tp.toFixed(2)),
    lots:       risk.lots,
    slPips:     risk.slPips,
    tpPips:     risk.tpPips,
    confidence: signal.confidence,
    strategies: signal.agreeing,
    mode:       TRADE_MODE,
    issuedAt:   new Date().toISOString(),
  };

  // Register with API so trades appear in dashboard
  let apiTradeId = null;
  try {
    const apiTrade = await createTrade(SYMBOL, {
      direction:  tradeCommand.direction,
      entry:      tradeCommand.entry,
      sl:         tradeCommand.sl,
      tp:         tradeCommand.tp,
      lots:       tradeCommand.lots,
      slPips:     tradeCommand.slPips,
      tpPips:     tradeCommand.tpPips,
      confidence: tradeCommand.confidence,
      strategies: tradeCommand.strategies,
      bridgeId,
    });
    apiTradeId = apiTrade.id;
    logger.info(`Trade registered with API. apiTradeId=${apiTradeId}`);
  } catch (err) {
    logger.warn(`Could not register trade with API: ${err.message}`);
  }

  if (TRADE_MODE === 'demo') {
    logger.info(`[DEMO] Forwarding to MT5 IPC (no real order). entry=${entry}`);
  } else {
    logger.info(`[LIVE] Forwarding to MT5. entry=${entry} sl=${tradeCommand.sl} tp=${tradeCommand.tp}`);
  }

  ipc.writePendingSignal(tradeCommand);
  pendingBridgeId = bridgeId;
  pendingApiId    = apiTradeId;

  await pushLog(SYMBOL, 'info',
    `[Bridge] Signal forwarded: ${signal.signal} @ ${entry}`,
    { bridgeId, apiTradeId, sl: tradeCommand.sl, tp: tradeCommand.tp }
  ).catch(() => {});
}

// ─── Trade result watcher ─────────────────────────────────────────────────────

async function checkTradeResult() {
  if (!pendingBridgeId) return;

  const ack = ipc.readAck();
  if (ack && !ack._logged) {
    logger.info(`MT5 EA acknowledged signal. ticket=${ack.ticket}`);
    ack._logged = true;
  }

  const result = ipc.readTradeResult();
  if (!result) return;

  logger.info(`Trade result from MT5: ticket=${result.ticket} closePrice=${result.closePrice ?? result.openPrice}`);

  if (result.error) {
    logger.error(`MT5 execution error: ${result.error}`);
    await pushLog(SYMBOL, 'error', `[Bridge] MT5 error: ${result.error}`, {
      bridgeId: pendingBridgeId, apiTradeId: pendingApiId,
    }).catch(() => {});
    pendingBridgeId = null;
    pendingApiId    = null;
    return;
  }

  if (pendingApiId) {
    try {
      await closeHistoryTrade(SYMBOL, pendingApiId, result.closePrice ?? result.openPrice);
      await pushLog(SYMBOL, 'info',
        `[Bridge] Trade closed. ticket=${result.ticket}`,
        { apiTradeId: pendingApiId, ...result }
      ).catch(() => {});
      logger.info(`Trade reported to API. apiTradeId=${pendingApiId}`);
    } catch (err) {
      logger.warn(`Could not report trade to API: ${err.message}`);
    }
  }

  pendingBridgeId = null;
  pendingApiId    = null;
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function setupShutdown() {
  async function shutdown(sig) {
    logger.info(`${sig} — shutting down bridge…`);
    clearInterval(pollTimer);
    clearInterval(resultTimer);
    clearInterval(heartbeatTimer);
    ipc.clearAll();
    await pushLog(SYMBOL, 'info', '[Bridge] Bridge stopped.').catch(() => {});
    process.exit(0);
  }
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

start().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
