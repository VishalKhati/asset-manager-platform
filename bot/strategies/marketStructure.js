'use strict';

/**
 * Market Structure Strategy
 *
 * BOS  (Break of Structure): continuation — price breaks the previous swing in trend direction
 * CHOCH (Change of Character): reversal — price breaks the opposite swing level
 *
 * candles: Array<{ time, open, high, low, close, volume }>  (oldest → newest)
 */

const DEFAULT_OPTIONS = {
  lookback: 20,
  name: 'MarketStructure',
};

class MarketStructure {
  constructor(config = {}) {
    Object.assign(this, DEFAULT_OPTIONS, config);
    this.weight = config.weight ?? 1;
  }

  /**
   * @param {object[]} candles
   * @returns {{ signal: 'BUY'|'SELL'|null, type: 'BOS'|'CHOCH'|null, confidence: number }}
   */
  analyze(candles) {
    if (!candles || candles.length < this.lookback + 2) {
      return { signal: null, type: null, confidence: 0 };
    }

    const window  = candles.slice(-this.lookback - 2);
    const current = window[window.length - 1];
    const prev    = window.slice(0, -1);

    const { highs, lows } = this._swingPoints(prev);

    if (highs.length < 2 || lows.length < 2) {
      return { signal: null, type: null, confidence: 0 };
    }

    const lastHH = Math.max(...highs.slice(-2));
    const lastLL = Math.min(...lows.slice(-2));
    const prevHH = highs[highs.length - 3] ?? highs[0];
    const prevLL = lows[lows.length - 3]  ?? lows[0];

    const trendUp   = highs[highs.length - 1] > prevHH && lows[lows.length - 1] > prevLL;
    const trendDown = highs[highs.length - 1] < prevHH && lows[lows.length - 1] < prevLL;

    // BOS — break in trend direction
    if (trendUp && current.close > lastHH) {
      return { signal: 'BUY',  type: 'BOS',   confidence: 0.8 };
    }
    if (trendDown && current.close < lastLL) {
      return { signal: 'SELL', type: 'BOS',   confidence: 0.8 };
    }

    // CHOCH — reversal signal
    if (trendUp && current.close < lastLL) {
      return { signal: 'SELL', type: 'CHOCH', confidence: 0.7 };
    }
    if (trendDown && current.close > lastHH) {
      return { signal: 'BUY',  type: 'CHOCH', confidence: 0.7 };
    }

    return { signal: null, type: null, confidence: 0 };
  }

  _swingPoints(candles) {
    const highs = [];
    const lows  = [];

    for (let i = 1; i < candles.length - 1; i++) {
      if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high) {
        highs.push(candles[i].high);
      }
      if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low) {
        lows.push(candles[i].low);
      }
    }

    return { highs, lows };
  }
}

module.exports = { MarketStructure };
