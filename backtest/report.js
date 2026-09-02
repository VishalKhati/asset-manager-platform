'use strict';

/**
 * Backtest Report Generator
 * Computes win rate, profit factor, max drawdown, Sharpe ratio.
 *
 * TODO: Step 9 — implement report generation
 */

function generateReport(trades = []) {
  return {
    totalTrades: trades.length,
    winRate: null,
    profitFactor: null,
    maxDrawdown: null,
    sharpeRatio: null,
  };
}

module.exports = { generateReport };
