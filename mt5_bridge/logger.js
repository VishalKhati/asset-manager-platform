'use strict';

const fs   = require('fs');
const path = require('path');

const LOG_FILE = process.env.LOG_FILE || '';

function timestamp() {
  return new Date().toISOString();
}

function write(level, msg, meta) {
  const line = `[${timestamp()}] [${level.toUpperCase().padEnd(5)}] ${msg}` +
               (meta ? ' ' + JSON.stringify(meta) : '');
  console.log(line);
  if (LOG_FILE) {
    try {
      fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
      fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
    } catch {}
  }
}

const logger = {
  info:  (msg, meta) => write('info',  msg, meta),
  warn:  (msg, meta) => write('warn',  msg, meta),
  error: (msg, meta) => write('error', msg, meta),
  debug: (msg, meta) => write('debug', msg, meta),
};

module.exports = { logger };
