/**
 * Bot Engine — TypeScript implementation of the SMC signal logic.
 *
 * Strategies:
 *   LiquiditySweep, FairValueGap, MAFilter, OrderBlock, MarketStructure, SessionFilter
 *
 * Signal modes: STRICT | FLEX | WEIGHTED
 */

import { type BotConfig, type Direction, type SignalResult } from "./botState.js";

export interface Candle {
  time:   number;
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

interface StratResult {
  name:       string;
  signal:     Direction | null;
  confidence: number;
  weight:     number;
  meta?:      Record<string, unknown>;
}

// ─── Strategy implementations ────────────────────────────────────────────────

function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function runLiquiditySweep(candles: Candle[], cfg: BotConfig["strategies"]["liquiditySweep"]): StratResult {
  const name = "LiquiditySweep";
  if (candles.length < cfg.lookback + 2) return { name, signal: null, confidence: 0, weight: cfg.weight };

  const window  = candles.slice(-cfg.lookback - 2);
  const current = window[window.length - 1];
  const recent  = window.slice(0, -1);

  const lows  = recent.map(c => c.low);
  const highs = recent.map(c => c.high);
  const minLow  = Math.min(...lows);
  const maxHigh = Math.max(...highs);
  const tolAmt  = minLow * 0.001;

  const equalLows  = lows.filter(l  => Math.abs(l  - minLow)  <= tolAmt).length >= 2;
  const equalHighs = highs.filter(h => Math.abs(h  - maxHigh) <= tolAmt).length >= 2;

  const range = current.high - current.low;
  if (range === 0) return { name, signal: null, confidence: 0, weight: cfg.weight };

  if (equalLows && current.low < minLow) {
    const lowerWick = Math.min(current.open, current.close) - current.low;
    if (lowerWick / range >= 0.55 && current.close > current.open && current.close > minLow) {
      return { name, signal: "BUY", confidence: 0.85, weight: cfg.weight };
    }
  }

  if (equalHighs && current.high > maxHigh) {
    const upperWick = current.high - Math.max(current.open, current.close);
    if (upperWick / range >= 0.55 && current.close < current.open && current.close < maxHigh) {
      return { name, signal: "SELL", confidence: 0.85, weight: cfg.weight };
    }
  }

  return { name, signal: null, confidence: 0, weight: cfg.weight };
}

function runFVG(candles: Candle[], cfg: BotConfig["strategies"]["fairValueGap"]): StratResult {
  const name = "FairValueGap";
  if (candles.length < 5) return { name, signal: null, confidence: 0, weight: cfg.weight };

  const current = candles[candles.length - 1];
  const window  = candles.slice(-Math.min(candles.length, cfg.lookback + 3));
  const maxAge  = 20;
  const minGap  = 0.0002;

  for (let i = 1; i < window.length - 1; i++) {
    const age  = window.length - 1 - i;
    if (age > maxAge) continue;
    const prev = window[i - 1];
    const next = window[i + 1];

    if (next.low > prev.high) {
      const gapSize = (next.low - prev.high) / prev.high;
      if (gapSize >= minGap && current.close >= prev.high && current.close <= next.low) {
        const freshness = 1 - age / maxAge;
        return { name, signal: "BUY", confidence: 0.7 + freshness * 0.2, weight: cfg.weight };
      }
    }
    if (next.high < prev.low) {
      const gapSize = (prev.low - next.high) / prev.low;
      if (gapSize >= minGap && current.close >= next.high && current.close <= prev.low) {
        const freshness = 1 - age / maxAge;
        return { name, signal: "SELL", confidence: 0.7 + freshness * 0.2, weight: cfg.weight };
      }
    }
  }

  return { name, signal: null, confidence: 0, weight: cfg.weight };
}

function runMAFilter(candles: Candle[], cfg: BotConfig["strategies"]["maFilter"]): StratResult {
  const name   = "MAFilter";
  const closes = candles.map(c => c.close);
  const ma100  = sma(closes, 100);
  if (!ma100) return { name, signal: null, confidence: 0, weight: cfg.weight };

  const current = candles[candles.length - 1];
  if (current.close > ma100) return { name, signal: "BUY",  confidence: 0.75, weight: cfg.weight };
  if (current.close < ma100) return { name, signal: "SELL", confidence: 0.75, weight: cfg.weight };
  return { name, signal: null, confidence: 0, weight: cfg.weight };
}

function runOrderBlock(candles: Candle[], cfg: BotConfig["strategies"]["orderBlock"]): StratResult {
  const name    = "OrderBlock";
  const current = candles[candles.length - 1];
  const window  = candles.slice(-22);

  for (let i = 1; i < window.length - 1; i++) {
    const age  = window.length - 1 - i;
    if (age > 30) continue;
    const prev = window[i - 1];
    const mid  = window[i];
    const next = window[i + 1];

    if (prev.close < prev.open && next.close > mid.high) {
      const impulse = (next.close - mid.high) / mid.high;
      if (impulse >= 0.0015 && current.close >= prev.close && current.close <= prev.open) {
        const freshness = 1 - age / 30;
        return { name, signal: "BUY", confidence: 0.65 + freshness * 0.25, weight: cfg.weight };
      }
    }
    if (prev.close > prev.open && next.close < mid.low) {
      const impulse = (mid.low - next.close) / mid.low;
      if (impulse >= 0.0015 && current.close >= prev.open && current.close <= prev.close) {
        const freshness = 1 - age / 30;
        return { name, signal: "SELL", confidence: 0.65 + freshness * 0.25, weight: cfg.weight };
      }
    }
  }

  return { name, signal: null, confidence: 0, weight: cfg.weight };
}

function runMarketStructure(candles: Candle[], cfg: BotConfig["strategies"]["marketStructure"]): StratResult {
  const name = "MarketStructure";
  if (candles.length < 22) return { name, signal: null, confidence: 0, weight: cfg.weight };

  const window  = candles.slice(-22);
  const current = window[window.length - 1];
  const highs: number[] = [];
  const lows:  number[] = [];

  for (let i = 1; i < window.length - 1; i++) {
    if (window[i].high > window[i-1].high && window[i].high > window[i+1].high) highs.push(window[i].high);
    if (window[i].low  < window[i-1].low  && window[i].low  < window[i+1].low)  lows.push(window[i].low);
  }
  if (highs.length < 2 || lows.length < 2) return { name, signal: null, confidence: 0, weight: cfg.weight };

  const lastHH = Math.max(...highs.slice(-2));
  const lastLL = Math.min(...lows.slice(-2));

  if (current.close > lastHH) return { name, signal: "BUY",  confidence: 0.8, weight: cfg.weight };
  if (current.close < lastLL) return { name, signal: "SELL", confidence: 0.8, weight: cfg.weight };
  return { name, signal: null, confidence: 0, weight: cfg.weight };
}

function runSessionFilter(
  cfg: BotConfig["strategies"]["sessionFilter"],
  candleTimeSec?: number,
): { open: boolean; session: string | null } {
  // Use candle timestamp (Unix seconds) when provided (backtesting); fall back
  // to wall-clock time for live signal evaluation.
  const d    = candleTimeSec ? new Date(candleTimeSec * 1000) : new Date();
  const hour = d.getUTCHours();
  const sessions: Record<string, [number, number]> = {
    london:   [8,  17],
    new_york: [13, 22],
  };
  for (const s of cfg.sessions) {
    const range = sessions[s];
    if (range && hour >= range[0] && hour < range[1]) return { open: true, session: s };
  }
  return { open: false, session: null };
}

// ─── Signal aggregation ──────────────────────────────────────────────────────

/**
 * Evaluate the signal engine for a given candle slice.
 * @param candles       Candle window (signal derived from the last candle)
 * @param config        Bot configuration
 * @param candleTimeSec Unix timestamp (seconds) of the current candle — used
 *                      by the session filter so backtests use the historical
 *                      candle time rather than the current wall-clock time.
 */
export function evaluate(candles: Candle[], config: BotConfig, candleTimeSec?: number): SignalResult {
  const strats = config.strategies;
  const results: StratResult[] = [];

  if (strats.liquiditySweep.enabled)  results.push(runLiquiditySweep(candles, strats.liquiditySweep));
  if (strats.fairValueGap.enabled)    results.push(runFVG(candles, strats.fairValueGap));
  if (strats.maFilter.enabled)        results.push(runMAFilter(candles, strats.maFilter));
  if (strats.orderBlock.enabled)      results.push(runOrderBlock(candles, strats.orderBlock));
  if (strats.marketStructure.enabled) results.push(runMarketStructure(candles, strats.marketStructure));

  if (config.engine.requireSession && strats.sessionFilter.enabled) {
    const { open } = runSessionFilter(strats.sessionFilter, candleTimeSec);
    if (!open) return noSignal("Outside active trading session.", config.engine.mode);
  }

  const mode   = config.engine.mode;
  const voters = results.filter(r => r.signal === "BUY" || r.signal === "SELL");

  if (voters.length === 0) return noSignal("No directional signals.", mode);

  if (mode === "STRICT") {
    const buys  = voters.filter(r => r.signal === "BUY");
    const sells = voters.filter(r => r.signal === "SELL");
    if (buys.length  === voters.length) return buildResult("BUY",  buys,  mode);
    if (sells.length === voters.length) return buildResult("SELL", sells, mode);
    return noSignal("STRICT: strategies disagree.", mode);
  }

  if (mode === "FLEX") {
    const buys  = voters.filter(r => r.signal === "BUY");
    const sells = voters.filter(r => r.signal === "SELL");
    if (buys.length  > sells.length) return buildResult("BUY",  buys,  mode);
    if (sells.length > buys.length)  return buildResult("SELL", sells, mode);
    return noSignal("FLEX: tie.", mode);
  }

  if (mode === "WEIGHTED") {
    let buyScore = 0, sellScore = 0, total = 0;
    for (const r of voters) {
      total += r.weight;
      if (r.signal === "BUY")  buyScore  += r.weight * r.confidence;
      if (r.signal === "SELL") sellScore += r.weight * r.confidence;
    }
    // Prefer minConfidence when explicitly set (e.g. from backtest request);
    // fall back to weightThreshold (live engine default).
    const thresh = config.engine.minConfidence ?? config.engine.weightThreshold ?? 0.6;
    const buyN   = total ? buyScore  / total : 0;
    const sellN  = total ? sellScore / total : 0;
    if (buyN  >= thresh && buyN  > sellN)  return buildResult("BUY",  voters.filter(r => r.signal === "BUY"),  mode, buyN);
    if (sellN >= thresh && sellN > buyN)   return buildResult("SELL", voters.filter(r => r.signal === "SELL"), mode, sellN);
    return noSignal(`WEIGHTED: score below threshold (buy=${buyN.toFixed(2)}, sell=${sellN.toFixed(2)}).`, mode);
  }

  return noSignal("Unknown mode.", mode);
}

function buildResult(dir: Direction, agreeing: StratResult[], mode: string, score?: number): SignalResult {
  const confidence = score ?? agreeing.reduce((s, r) => s + r.confidence, 0) / (agreeing.length || 1);
  return {
    signal:     dir,
    confidence: parseFloat(confidence.toFixed(4)),
    mode,
    agreeing:   agreeing.map(r => r.name),
    reason:     `${mode}: ${dir} confirmed by [${agreeing.map(r => r.name).join(", ")}]`,
    timestamp:  new Date().toISOString(),
  };
}

function noSignal(reason: string, mode: string): SignalResult {
  return { signal: null, confidence: 0, mode, agreeing: [], reason, timestamp: new Date().toISOString() };
}

export function getMaValues(candles: Candle[], periods = [25, 50, 100]): Record<number, number | null> {
  const closes = candles.map(c => c.close);
  const result: Record<number, number | null> = {};
  for (const p of periods) result[p] = sma(closes, p);
  return result;
}
