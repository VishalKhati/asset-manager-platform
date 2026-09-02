'use strict';

/**
 * Fair Value Gap (FVG) Strategy
 *
 * Bullish FVG: candle[i-1].high  <  candle[i+1].low   (gap above)
 * Bearish FVG: candle[i-1].low   >  candle[i+1].high  (gap below)
 *
 * Signal fires when current price re-enters an active FVG zone.
 *
 * candles: Array<{ time, open, high, low, close, volume }>  (oldest → newest)
 */

const DEFAULT_OPTIONS = {
  lookback: 50,
  minGapPercent: 0.02,   // minimum gap size as % of price (filters noise)
  maxAgeCandles: 20,     // ignore FVGs older than N candles
  name: 'FairValueGap',
};

class FairValueGap {
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
    const window  = candles.slice(-Math.min(candles.length, this.lookback + 3));

    const bullishFVGs = [];
    const bearishFVGs = [];

    for (let i = 1; i < window.length - 1; i++) {
      const age = window.length - 1 - i;
      if (age > this.maxAgeCandles) continue;

      const prev = window[i - 1];
      const mid  = window[i];
      const next = window[i + 1];

      // Bullish FVG: gap between prev.high and next.low
      if (next.low > prev.high) {
        const gapSize = (next.low - prev.high) / prev.high;
        if (gapSize >= this.minGapPercent / 100) {
          bullishFVGs.push({ top: next.low, bottom: prev.high, age, gapSize });
        }
      }

      // Bearish FVG: gap between next.high and prev.low
      if (next.high < prev.low) {
        const gapSize = (prev.low - next.high) / prev.low;
        if (gapSize >= this.minGapPercent / 100) {
          bearishFVGs.push({ top: prev.low, bottom: next.high, age, gapSize });
        }
      }
    }

    // Check if current price is inside a bullish FVG (price pulled back into the zone → BUY)
    for (const fvg of bullishFVGs) {
      if (current.close >= fvg.bottom && current.close <= fvg.top) {
        const freshness = 1 - fvg.age / this.maxAgeCandles;
        return {
          signal: 'BUY',
          zone: { top: fvg.top, bottom: fvg.bottom },
          confidence: 0.7 + freshness * 0.2,
        };
      }
    }

    // Check if current price is inside a bearish FVG (price pulled back into the zone → SELL)
    for (const fvg of bearishFVGs) {
      if (current.close >= fvg.bottom && current.close <= fvg.top) {
        const freshness = 1 - fvg.age / this.maxAgeCandles;
        return {
          signal: 'SELL',
          zone: { top: fvg.top, bottom: fvg.bottom },
          confidence: 0.7 + freshness * 0.2,
        };
      }
    }

    return { signal: null, zone: null, confidence: 0 };
  }

  /**
   * Returns all active FVG zones (for dashboard display)
   */
  getZones(candles) {
    if (!candles || candles.length < 3) return { bullish: [], bearish: [] };
    const bullish = [];
    const bearish = [];
    const window  = candles.slice(-this.lookback - 3);

    for (let i = 1; i < window.length - 1; i++) {
      const age = window.length - 1 - i;
      if (age > this.maxAgeCandles) continue;
      const prev = window[i - 1];
      const next = window[i + 1];

      if (next.low > prev.high) {
        bullish.push({ top: next.low, bottom: prev.high, age });
      }
      if (next.high < prev.low) {
        bearish.push({ top: prev.low, bottom: next.high, age });
      }
    }
    return { bullish, bearish };
  }
}

module.exports = { FairValueGap };
