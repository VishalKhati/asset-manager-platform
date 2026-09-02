'use strict';

/**
 * Minimal .env loader — no external dependencies required.
 * Reads .env from the same directory as this file.
 */

const fs   = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '.env');

if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx < 0) continue;
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}
