'use strict';

/**
 * Moving Average Filter
 *
 * BUY allowed:  close > MA(100)  (price is above trend)
 * SELL allowed: close < MA(100)  (price is below trend)
 *
 * Also calculates MA(25) and MA(50) for dashboard display.
 *
 * candles: Array<{ time, open, high, low, close, volume }>  (oldest → newest)
 */

const DEFAULT_OPTIONS = {
  periods: [25, 50, 100],
  name: 'MAFilter',
};

class MAFilter {
  constructor(config = {}) {
    Object.assign(this, DEFAULT_OPTIONS, config);
    this.weight = config.weight ?? 1;
  }

  /**
   * @param {object[]} candles
   * @returns {{ signal: 'BUY'|'SELL'|null, values: Record<number,number>, confidence: number }}
   */
  analyze(candles) {
    if (!candles || candles.length === 0) {
      return { signal: null, values: {}, confidence: 0 };
    }

    const values = this.getValues(candles);
    const current = candles[candles.length - 1];
    const ma100 = values[100];

    if (ma100 == null) {
      return { signal: null, values, confidence: 0 };
    }

    if (current.close > ma100) {
      return { signal: 'BUY',  values, confidence: 0.75 };
    }
    if (current.close < ma100) {
      return { signal: 'SELL', values, confidence: 0.75 };
    }
    return { signal: null, values, confidence: 0 };
  }

  /**
   * Compute SMA for each configured period.
   * @returns {Record<number, number|null>}
   */
  getValues(candles) {
    const closes = candles.map(c => c.close);
    const result = {};
    for (const period of this.periods) {
      result[period] = this._sma(closes, period);
    }
    return result;
  }

  _sma(closes, period) {
    if (closes.length < period) return null;
    const slice = closes.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }
}

module.exports = { MAFilter };
