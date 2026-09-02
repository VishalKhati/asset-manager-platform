'use strict';

/**
 * Smart Money Concept Gold Trading Bot
 *
 * Entry point — loads config, wires strategies, exposes evaluate().
 *
 * Modes: backtest | live | signal
 */

const { LiquiditySweep } = require('./strategies/liquiditySweep');
const { FairValueGap }   = require('./strategies/fairValueGap');
const { OrderBlock }     = require('./strategies/orderBlock');
const { MarketStructure }= require('./strategies/marketStructure');
const { MAFilter }       = require('./strategies/maFilter');
const { SessionFilter }  = require('./strategies/sessionFilter');
const { RiskManager }    = require('./riskManager');
const { SignalEngine }   = require('./signalEngine');

/**
 * Build the bot from a config object (loaded from config/default.json or
 * overridden at runtime via /api/config).
 *
 * @param {object} config
 * @returns {{ evaluate: (candles: object[]) => SignalResult, riskManager: RiskManager }}
 */
function createBot(config = {}) {
  const stratCfg  = config.strategies || {};
  const riskCfg   = config.risk       || {};
  const engineCfg = config.engine     || {};

  // Instantiate all strategies with per-strategy config + weight
  const allStrategies = [
    new LiquiditySweep({
      ...stratCfg.liquiditySweep,
      weight: stratCfg.liquiditySweep?.weight ?? 2,   // default higher weight (core strategy)
    }),
    new FairValueGap({
      ...stratCfg.fairValueGap,
      weight: stratCfg.fairValueGap?.weight ?? 2,     // default higher weight (core strategy)
    }),
    new MAFilter({
      ...stratCfg.maFilter,
      weight: stratCfg.maFilter?.weight ?? 1,
    }),
    new OrderBlock({
      ...stratCfg.orderBlock,
      weight: stratCfg.orderBlock?.weight ?? 1,
    }),
    new MarketStructure({
      ...stratCfg.marketStructure,
      weight: stratCfg.marketStructure?.weight ?? 1,
    }),
    new SessionFilter({
      ...stratCfg.sessionFilter,
    }),
  ];

  // enabledMap controls which strategies participate at runtime
  const enabledMap = {
    LiquiditySweep: stratCfg.liquiditySweep?.enabled  ?? true,
    FairValueGap:   stratCfg.fairValueGap?.enabled    ?? true,
    MAFilter:       stratCfg.maFilter?.enabled        ?? true,
    OrderBlock:     stratCfg.orderBlock?.enabled      ?? false,   // optional by default
    MarketStructure:stratCfg.marketStructure?.enabled ?? false,   // optional by default
    SessionFilter:  stratCfg.sessionFilter?.enabled   ?? true,
  };

  const engine = new SignalEngine({
    mode:            engineCfg.mode            || 'STRICT',
    weightThreshold: engineCfg.weightThreshold || 0.6,
    requireSession:  engineCfg.requireSession  ?? true,
  });

  const riskManager = new RiskManager(riskCfg);

  /**
   * Evaluate the current candle set and return a signal.
   * @param {object[]} candles - OHLCV array, oldest → newest
   * @returns {SignalResult}
   */
  function evaluate(candles) {
    return engine.evaluate(candles, allStrategies, enabledMap);
  }

  return {
    evaluate,
    riskManager,
    enabledMap,
    engine,
    strategies: allStrategies,
  };
}

module.exports = { createBot, LiquiditySweep, FairValueGap, OrderBlock, MarketStructure, MAFilter, SessionFilter, SignalEngine, RiskManager };
