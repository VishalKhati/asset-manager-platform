'use strict';

/**
 * Liquidity Sweep Strategy
 *
 * BUY setup:  sweep below equal lows → rejection candle closes back above
 * SELL setup: sweep above equal highs → rejection candle closes back below
 *
 * candles: Array<{ time, open, high, low, close, volume }>  (oldest → newest)
 */

const DEFAULT_OPTIONS = {
  lookback: 30,
  equalTolerance: 0.10,   // % tolerance to consider two lows/highs "equal"
  minWickRatio: 0.55,      // wick must be ≥ 55% of candle range for rejection
  name: 'LiquiditySweep',
};

class LiquiditySweep {
  constructor(config = {}) {
    Object.assign(this, DEFAULT_OPTIONS, config);
    this.weight = config.weight ?? 1;
  }

  /**
   * @param {object[]} candles
   * @returns {{ signal: 'BUY'|'SELL'|null, level: number, confidence: number }}
   */
  analyze(candles) {
    if (!candles || candles.length < this.lookback + 2) {
      return { signal: null, level: null, confidence: 0 };
    }

    const window = candles.slice(-this.lookback - 2);
    const recent = window.slice(0, -1);   // everything except the latest candle
    const current = window[window.length - 1];

    const buyResult  = this._checkBuySweep(recent, current);
    if (buyResult.signal) return buyResult;

    const sellResult = this._checkSellSweep(recent, current);
    if (sellResult.signal) return sellResult;

    return { signal: null, level: null, confidence: 0 };
  }

  _equalLows(candles) {
    const lows = candles.map(c => c.low);
    const min  = Math.min(...lows);
    const tol  = min * (this.equalTolerance / 100);
    return lows.filter(l => Math.abs(l - min) <= tol).length >= 2 ? min : null;
  }

  _equalHighs(candles) {
    const highs = candles.map(c => c.high);
    const max   = Math.max(...highs);
    const tol   = max * (this.equalTolerance / 100);
    return highs.filter(h => Math.abs(h - max) <= tol).length >= 2 ? max : null;
  }

  _isRejectionBull(candle) {
    const range = candle.high - candle.low;
    if (range === 0) return false;
    const lowerWick = candle.open > candle.close
      ? candle.close - candle.low
      : candle.open  - candle.low;
    return lowerWick / range >= this.minWickRatio && candle.close > candle.open;
  }

  _isRejectionBear(candle) {
    const range = candle.high - candle.low;
    if (range === 0) return false;
    const upperWick = candle.open < candle.close
      ? candle.high - candle.close
      : candle.high - candle.open;
    return upperWick / range >= this.minWickRatio && candle.close < candle.open;
  }

  _checkBuySweep(recent, current) {
    const equalLow = this._equalLows(recent);
    if (!equalLow) return { signal: null, level: null, confidence: 0 };

    const swept    = current.low < equalLow;
    const rejected = this._isRejectionBull(current);
    const closedAbove = current.close > equalLow;

    if (swept && rejected && closedAbove) {
      return { signal: 'BUY', level: equalLow, confidence: 0.85 };
    }
    return { signal: null, level: null, confidence: 0 };
  }

  _checkSellSweep(recent, current) {
    const equalHigh = this._equalHighs(recent);
    if (!equalHigh) return { signal: null, level: null, confidence: 0 };

    const swept    = current.high > equalHigh;
    const rejected = this._isRejectionBear(current);
    const closedBelow = current.close < equalHigh;

    if (swept && rejected && closedBelow) {
      return { signal: 'SELL', level: equalHigh, confidence: 0.85 };
    }
    return { signal: null, level: null, confidence: 0 };
  }
}

module.exports = { LiquiditySweep };
