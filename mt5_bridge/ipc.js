'use strict';

/**
 * File-based IPC between Node.js bridge and MT5 Expert Advisor.
 *
 * Protocol (all files live in IPC_DIR):
 *
 *   pending_signal.json   written by bridge  → read by MT5 EA
 *   signal_ack.json       written by MT5 EA  → read by bridge (confirms receipt)
 *   trade_result.json     written by MT5 EA  → read by bridge (trade outcome)
 *   bridge_heartbeat.json written by bridge  → MT5 EA can check if bridge is alive
 */

const fs   = require('fs');
const path = require('path');

const IPC_DIR = path.resolve(process.env.IPC_DIR || './ipc');

function ensureDir() {
  fs.mkdirSync(IPC_DIR, { recursive: true });
}

function filePath(name) {
  return path.join(IPC_DIR, name);
}

function write(name, data) {
  ensureDir();
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), 'utf8');
}

function read(name) {
  const p = filePath(name);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function remove(name) {
  const p = filePath(name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function exists(name) {
  return fs.existsSync(filePath(name));
}

// ─── High-level IPC helpers ──────────────────────────────────────────────────

/**
 * Write a pending signal file for the MT5 EA to pick up.
 * @param {object} signal   - { id, direction, entry, sl, tp, lots, slPips, tpPips }
 */
function writePendingSignal(signal) {
  remove('signal_ack.json');   // clear previous ack
  remove('trade_result.json'); // clear previous result
  write('pending_signal.json', {
    ...signal,
    writtenAt: new Date().toISOString(),
  });
}

/**
 * Check if MT5 EA has acknowledged the signal.
 */
function readAck() {
  return read('signal_ack.json');
}

/**
 * Check if MT5 EA has written a trade result.
 * Returns null if no result yet.
 * @returns {{ id, ticket, openPrice, sl, tp, lots, error?: string } | null}
 */
function readTradeResult() {
  const result = read('trade_result.json');
  if (result) remove('trade_result.json');
  return result;
}

/**
 * Write a heartbeat so MT5 EA knows bridge is alive.
 */
function writeHeartbeat() {
  write('bridge_heartbeat.json', { ts: new Date().toISOString(), pid: process.pid });
}

/**
 * Clear all IPC files (called on bridge startup).
 */
function clearAll() {
  ['pending_signal.json', 'signal_ack.json', 'trade_result.json', 'bridge_heartbeat.json']
    .forEach(f => remove(f));
}

module.exports = { writePendingSignal, readAck, readTradeResult, writeHeartbeat, clearAll, IPC_DIR };
