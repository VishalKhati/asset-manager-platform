'use strict';

/**
 * Backtesting Engine
 * Replays historical OHLCV data through all strategies
 * and produces a performance report.
 *
 * TODO: Step 9 — implement backtesting logic
 */

const path = require('path');

async function runBacktest(options = {}) {
  const {
    symbol     = 'XAUUSD',
    timeframe  = 'M15',
    startDate  = '2024-01-01',
    endDate    = '2024-12-31',
    dataFile   = path.join(__dirname, 'data', `${symbol}_${timeframe}.json`),
  } = options;

  console.log(`[Backtest] Running: ${symbol} ${timeframe} ${startDate} → ${endDate}`);
  // TODO: load OHLCV data, run strategies, collect results
}

module.exports = { runBacktest };
