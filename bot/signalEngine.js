'use strict';

/**
 * Signal Engine
 *
 * Aggregates results from all enabled strategies and produces a unified
 * BUY / SELL / null signal using one of three modes:
 *
 *   STRICT   — every enabled strategy must agree on the same direction
 *   FLEX     — majority of enabled strategies must agree (> 50%)
 *   WEIGHTED — weighted-score sum must exceed the configured threshold (default 0.6)
 *
 * Each strategy result must expose:
 *   { signal: 'BUY'|'SELL'|null, confidence: number (0–1) }
 */

const MODES = Object.freeze({ STRICT: 'STRICT', FLEX: 'FLEX', WEIGHTED: 'WEIGHTED' });

class SignalEngine {
  /**
   * @param {object}   options
   * @param {string}   options.mode              - 'STRICT' | 'FLEX' | 'WEIGHTED'
   * @param {number}   [options.weightThreshold] - minimum score for WEIGHTED mode (0–1)
   * @param {boolean}  [options.requireSession]  - block signals outside active sessions
   */
  constructor(options = {}) {
    this.mode             = (options.mode || 'STRICT').toUpperCase();
    this.weightThreshold  = options.weightThreshold ?? 0.6;
    this.requireSession   = options.requireSession  ?? true;

    if (!MODES[this.mode]) {
      throw new Error(`Invalid mode "${this.mode}". Must be one of: ${Object.keys(MODES).join(', ')}`);
    }
  }

  /**
   * Run all enabled strategies against the candle data and return a unified signal.
   *
   * @param {object[]}  candles   - OHLCV array, oldest → newest
   * @param {object[]}  strategies - array of instantiated strategy objects
   * @param {object}    enabledMap - { strategyName: boolean } — gates which strategies run
   * @returns {SignalResult}
   */
  evaluate(candles, strategies, enabledMap = {}) {
    const results = this._runStrategies(candles, strategies, enabledMap);

    if (results.length === 0) {
      return this._noSignal('No enabled strategies produced results.');
    }

    // Session gate — if SessionFilter ran and session is closed, block everything
    if (this.requireSession) {
      const sessionResult = results.find(r => r.name === 'SessionFilter');
      if (sessionResult && sessionResult.signal === null) {
        return this._noSignal('Outside active trading session.');
      }
    }

    // Exclude session filter from signal voting — it's a gate, not a directional voter
    const voters = results.filter(r => r.name !== 'SessionFilter');

    switch (this.mode) {
      case 'STRICT':   return this._evaluateStrict(voters, results);
      case 'FLEX':     return this._evaluateFlex(voters, results);
      case 'WEIGHTED': return this._evaluateWeighted(voters, results);
      default:         return this._noSignal('Unknown mode.');
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  _runStrategies(candles, strategies, enabledMap) {
    const results = [];

    for (const strategy of strategies) {
      const name = strategy.name;

      // If enabledMap has an explicit false for this strategy, skip it
      if (Object.prototype.hasOwnProperty.call(enabledMap, name) && !enabledMap[name]) {
        continue;
      }

      try {
        const raw = strategy.analyze(candles);
        results.push({
          name,
          signal:     raw.signal     ?? null,
          confidence: raw.confidence ?? 0,
          weight:     strategy.weight ?? 1,
          meta:       raw,
        });
      } catch (err) {
        results.push({ name, signal: null, confidence: 0, weight: 1, meta: { error: err.message } });
      }
    }

    return results;
  }

  /** STRICT: all voting strategies must agree on the same direction */
  _evaluateStrict(voters, allResults) {
    const directional = voters.filter(r => r.signal === 'BUY' || r.signal === 'SELL');
    if (directional.length === 0) return this._noSignal('No directional signals.', allResults);

    const buys  = directional.filter(r => r.signal === 'BUY').length;
    const sells = directional.filter(r => r.signal === 'SELL').length;

    if (buys === directional.length) {
      return this._buildResult('BUY',  directional, allResults, 'STRICT');
    }
    if (sells === directional.length) {
      return this._buildResult('SELL', directional, allResults, 'STRICT');
    }
    return this._noSignal('STRICT: strategies disagree.', allResults);
  }

  /** FLEX: majority (> 50%) of voting strategies agree */
  _evaluateFlex(voters, allResults) {
    const directional = voters.filter(r => r.signal === 'BUY' || r.signal === 'SELL');
    if (directional.length === 0) return this._noSignal('No directional signals.', allResults);

    const buys  = directional.filter(r => r.signal === 'BUY');
    const sells = directional.filter(r => r.signal === 'SELL');

    if (buys.length > sells.length) {
      return this._buildResult('BUY',  buys,  allResults, 'FLEX');
    }
    if (sells.length > buys.length) {
      return this._buildResult('SELL', sells, allResults, 'FLEX');
    }
    return this._noSignal('FLEX: tie between BUY and SELL.', allResults);
  }

  /** WEIGHTED: weighted confidence score must exceed threshold */
  _evaluateWeighted(voters, allResults) {
    let buyScore  = 0;
    let sellScore = 0;
    let totalWeight = 0;

    for (const r of voters) {
      totalWeight += r.weight;
      if (r.signal === 'BUY')  buyScore  += r.weight * r.confidence;
      if (r.signal === 'SELL') sellScore += r.weight * r.confidence;
    }

    if (totalWeight === 0) return this._noSignal('No weighted voters.', allResults);

    const buyNorm  = buyScore  / totalWeight;
    const sellNorm = sellScore / totalWeight;

    if (buyNorm >= this.weightThreshold && buyNorm > sellNorm) {
      return this._buildResult('BUY',  voters.filter(r => r.signal === 'BUY'),  allResults, 'WEIGHTED', buyNorm);
    }
    if (sellNorm >= this.weightThreshold && sellNorm > buyNorm) {
      return this._buildResult('SELL', voters.filter(r => r.signal === 'SELL'), allResults, 'WEIGHTED', sellNorm);
    }
    return this._noSignal(`WEIGHTED: score below threshold (buy=${buyNorm.toFixed(2)}, sell=${sellNorm.toFixed(2)}, threshold=${this.weightThreshold}).`, allResults);
  }

  _buildResult(direction, agreeing, allResults, mode, score = null) {
    const avgConfidence = score ?? (agreeing.reduce((s, r) => s + r.confidence, 0) / (agreeing.length || 1));
    return {
      signal:     direction,
      confidence: parseFloat(avgConfidence.toFixed(4)),
      mode,
      agreeing:   agreeing.map(r => r.name),
      strategies: allResults,
      reason:     `${mode}: ${direction} confirmed by [${agreeing.map(r => r.name).join(', ')}]`,
      timestamp:  new Date().toISOString(),
    };
  }

  _noSignal(reason = '', strategies = []) {
    return {
      signal:     null,
      confidence: 0,
      mode:       this.mode,
      agreeing:   [],
      strategies,
      reason,
      timestamp:  new Date().toISOString(),
    };
  }
}

module.exports = { SignalEngine, MODES };
