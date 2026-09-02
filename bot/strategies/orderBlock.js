'use strict';

/**
 * Order Block Strategy
 *
 * An Order Block is the last opposing candle before a strong impulsive move
 * that breaks structure. Price frequently returns to test these zones.
 *
 * Bullish OB: last bearish candle before a bullish impulsive move
 * Bearish OB: last bullish candle before a bearish impulsive move
 *
 * candles: Array<{ time, open, high, low, close, volume }>  (oldest → newest)
 */

const DEFAULT_OPTIONS = {
  lookback: 20,
  impulseMinPercent: 0.15,  // impulsive move must span ≥ 0.15% of price
  maxAgeCandles: 30,
  name: 'OrderBlock',
};

class OrderBlock {
  constructor(config = {}) {
    Object.assign(this, DEFAULT_OPTIONS, config);
    this.weight = config.weight ?? 1;
  }

  /**
   * @param {object[]} candles
   * @returns {{ signal: 'BUY'|'SELL'|null, zone: {top,bottom}|null, confidence: number }}
   */
  analyze(candles) {
    if (!candles || candles.length < 5) {
      return { signal: null, zone: null, confidence: 0 };
    }

    const current = candles[candles.length - 1];
    const blocks  = this._findBlocks(candles);

    for (const ob of blocks) {
      if (current.close >= ob.bottom && current.close <= ob.top) {
        const freshness = 1 - ob.age / this.maxAgeCandles;
        return {
          signal: ob.type === 'bullish' ? 'BUY' : 'SELL',
          zone: { top: ob.top, bottom: ob.bottom },
          confidence: 0.65 + freshness * 0.25,
        };
      }
    }

    return { signal: null, zone: null, confidence: 0 };
  }

  _findBlocks(candles) {
    const window = candles.slice(-Math.min(candles.length, this.lookback + 3));
    const blocks = [];
    const minMove = this.impulseMinPercent / 100;

    for (let i = 1; i < window.length - 1; i++) {
      const age      = window.length - 1 - i;
      if (age > this.maxAgeCandles) continue;

      const prev    = window[i - 1];
      const current = window[i];
      const next    = window[i + 1];

      // Bullish OB: last bearish candle before bullish impulse
      if (prev.close < prev.open) {
        const impulse = (next.close - current.high) / current.high;
        if (next.close > current.high && impulse >= minMove) {
          blocks.push({ type: 'bullish', top: prev.open, bottom: prev.close, age });
        }
      }

      // Bearish OB: last bullish candle before bearish impulse
      if (prev.close > prev.open) {
        const impulse = (current.low - next.close) / current.low;
        if (next.close < current.low && impulse >= minMove) {
          blocks.push({ type: 'bearish', top: prev.close, bottom: prev.open, age });
        }
      }
    }

    return blocks;
  }

  getZones(candles) {
    return this._findBlocks(candles);
  }
}

module.exports = { OrderBlock };
