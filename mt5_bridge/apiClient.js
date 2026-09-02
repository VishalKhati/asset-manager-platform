'use strict';

/**
 * API Client — communicates with the SMC Bot backend.
 * Uses Node.js built-in fetch (Node >= 18).
 *
 * API_TOKEN can be:
 *   - BOT_API_TOKEN value (machine auth → _system user) — permanent
 *   - A user JWT from /api/auth/login                   — expires in 30 days
 */

const API_BASE = (process.env.API_BASE_URL || 'http://localhost:80/api').replace(/\/$/, '');
const TOKEN    = process.env.API_TOKEN || 'changeme';

function headers() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${TOKEN}`,
  };
}

function symQ(path, symbol) {
  const sep = path.includes('?') ? '&' : '?';
  return symbol ? `${path}${sep}symbol=${symbol}` : path;
}

// ─── Status ───────────────────────────────────────────────────────────────────

async function getStatus(symbol) {
  const res = await fetch(`${API_BASE}/bot/${symQ('status', symbol)}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /status → HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

// ─── Signal ───────────────────────────────────────────────────────────────────

async function getSignal(symbol) {
  const res = await fetch(`${API_BASE}/bot/${symQ('signal', symbol)}`, { headers: headers() });
  if (!res.ok) throw new Error(`GET /signal → HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

// ─── Trade registration ───────────────────────────────────────────────────────

async function createTrade(symbol, command) {
  const res = await fetch(`${API_BASE}/bot/trades${symbol ? `?symbol=${symbol}` : ''}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`POST /trades → HTTP ${res.status}: ${res.statusText}`);
  const data = await res.json();
  return data.trade;
}

// ─── Trade close ──────────────────────────────────────────────────────────────

async function closeHistoryTrade(symbol, apiTradeId, closePrice) {
  const url = `${API_BASE}/bot/history/${apiTradeId}/close${symbol ? `?symbol=${symbol}` : ''}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ price: closePrice }),
  });
  if (!res.ok) throw new Error(`POST /history/.../close → HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

// ─── Bridge heartbeat ─────────────────────────────────────────────────────────

/**
 * POST /api/bot/bridge-heartbeat?symbol=
 * Tells the server the bridge is alive. The dashboard displays this as
 * a connection status indicator on the MT5 Setup page.
 */
async function postBridgeHeartbeat(symbol, version) {
  await fetch(`${API_BASE}/bot/bridge-heartbeat${symbol ? `?symbol=${symbol}` : ''}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ version: version || '2.0', pid: process.pid }),
  }).catch(() => {});   // non-fatal
}

// ─── Logging ──────────────────────────────────────────────────────────────────

async function pushLog(symbol, level, message, meta) {
  await fetch(`${API_BASE}/bot/log${symbol ? `?symbol=${symbol}` : ''}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ level, message, meta }),
  }).catch(() => {});   // non-fatal
}

module.exports = { getSignal, getStatus, createTrade, closeHistoryTrade, postBridgeHeartbeat, pushLog };
