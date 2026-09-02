'use strict';

/**
 * Risk Manager
 *
 * Handles:
 *  - Position sizing (1% risk per trade)
 *  - SL: nearest swing high / low
 *  - TP: SL distance × RR ratio (default 1:2)
 *  - Trailing stop
 *  - Break-even trigger
 *  - Max trades per day gate
 */

const XAUUSD_PIP_VALUE_PER_LOT = 1;   // $1 per 0.01 lot per pip for gold — adjust for broker

class RiskManager {
  constructor(config = {}) {
    this.riskPercent      = config.riskPercent      ?? 1;
    this.rrRatio          = config.rrRatio          ?? 2;
    this.maxTradesPerDay  = config.maxTradesPerDay  ?? 3;
    this.trailingStop     = config.trailingStop     ?? true;
    this.breakEven        = config.breakEven        ?? true;
    this.breakEvenBuffer  = config.breakEvenBuffer  ?? 5;    // pips above entry before BE triggers
    this._tradesToday     = 0;
    this._lastResetDate   = new Date().toDateString();
  }

  /** Returns false if daily limit reached. */
  canTrade() {
    this._maybeDailyReset();
    return this._tradesToday < this.maxTradesPerDay;
  }

  /** Call after a trade is opened. */
  recordTrade() {
    this._maybeDailyReset();
    this._tradesToday++;
  }

  get tradesRemainingToday() {
    this._maybeDailyReset();
    return Math.max(0, this.maxTradesPerDay - this._tradesToday);
  }

  /**
   * Calculate lot size based on account balance and stop-loss distance.
   *
   * @param {number} accountBalance  - e.g. 10000
   * @param {number} slPips          - stop-loss size in pips
   * @param {number} [pipValue]      - $ value per pip per 0.01 lot (broker-specific)
   * @returns {number} lot size (rounded to 2 decimal places)
   */
  calculateLotSize(accountBalance, slPips, pipValue = XAUUSD_PIP_VALUE_PER_LOT) {
    if (slPips <= 0) return 0;
    const riskAmount = accountBalance * (this.riskPercent / 100);
    const lots = riskAmount / (slPips * pipValue * 100);   // *100 because pipValue is per 0.01 lot
    return Math.max(0.01, parseFloat(lots.toFixed(2)));
  }

  /**
   * Calculate SL and TP levels from entry and swing level.
   *
   * @param {number} entry      - entry price
   * @param {'BUY'|'SELL'} direction
   * @param {number} swingLevel - swing high (SELL) or swing low (BUY) for SL placement
   * @param {number} [buffer]   - extra pips beyond swing for SL
   * @returns {{ sl: number, tp: number, slPips: number, tpPips: number }}
   */
  calculateSLTP(entry, direction, swingLevel, buffer = 3) {
    let sl, tp, slPips, tpPips;

    if (direction === 'BUY') {
      sl     = swingLevel - buffer;
      slPips = parseFloat((entry - sl).toFixed(5));
      tpPips = slPips * this.rrRatio;
      tp     = parseFloat((entry + tpPips).toFixed(5));
    } else {
      sl     = swingLevel + buffer;
      slPips = parseFloat((sl - entry).toFixed(5));
      tpPips = slPips * this.rrRatio;
      tp     = parseFloat((entry - tpPips).toFixed(5));
    }

    return { sl, tp, slPips, tpPips };
  }

  /**
   * Trailing stop: returns new SL if price has moved far enough.
   * @param {number} currentPrice
   * @param {number} currentSL
   * @param {'BUY'|'SELL'} direction
   * @param {number} trailPips
   * @returns {number} updated SL
   */
  trailSL(currentPrice, currentSL, direction, trailPips) {
    if (!this.trailingStop) return currentSL;

    if (direction === 'BUY') {
      const candidate = currentPrice - trailPips;
      return candidate > currentSL ? candidate : currentSL;
    } else {
      const candidate = currentPrice + trailPips;
      return candidate < currentSL ? candidate : currentSL;
    }
  }

  /**
   * Break-even: move SL to entry + buffer once price is in profit.
   * @param {number} entry
   * @param {number} currentPrice
   * @param {number} currentSL
   * @param {'BUY'|'SELL'} direction
   * @returns {number} updated SL
   */
  applyBreakEven(entry, currentPrice, currentSL, direction) {
    if (!this.breakEven) return currentSL;

    if (direction === 'BUY') {
      const profitPips = currentPrice - entry;
      if (profitPips >= this.breakEvenBuffer) {
        const beSL = entry + 1;   // 1 pip above entry
        return beSL > currentSL ? beSL : currentSL;
      }
    } else {
      const profitPips = entry - currentPrice;
      if (profitPips >= this.breakEvenBuffer) {
        const beSL = entry - 1;
        return beSL < currentSL ? beSL : currentSL;
      }
    }
    return currentSL;
  }

  _maybeDailyReset() {
    const today = new Date().toDateString();
    if (today !== this._lastResetDate) {
      this._tradesToday   = 0;
      this._lastResetDate = today;
    }
  }
}

module.exports = { RiskManager };
