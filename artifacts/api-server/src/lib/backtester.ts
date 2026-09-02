/**
 * Walk-forward backtester — replays the SMC strategy engine over historical candles.
 *
 * For each candle (after the warm-up window):
 *   - If no trade is open: evaluate signal on all candles up to that point.
 *   - If a signal fires: open a simulated trade with symbol-specific SL/TP.
 *   - On subsequent candles: check if SL or TP was hit (intra-candle).
 *   - Track equity, drawdown, per-strategy performance.
 */

import { evaluate, type Candle }  from "./botEngine.js";
import { type BotConfig, type Direction } from "./botState.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BacktestTrade {
  direction:  Direction;
  openIndex:  number;
  closeIndex: number;
  openTime:   number;
  closeTime:  number;
  openPrice:  number;
  closePrice: number;
  sl:         number;
  tp:         number;
  lots:       number;
  pnl:        number;
  outcome:    "win" | "loss";
  strategies: string[];
  confidence: number;
}

export interface BacktestStats {
  totalTrades:   number;
  wins:          number;
  losses:        number;
  winRate:       number;
  totalPnl:      number;
  maxDrawdown:   number;
  avgTradePnl:   number;
  profitFactor:  number;
  avgConfidence: number;
}

export interface BacktestResult {
  trades:        BacktestTrade[];
  stats:         BacktestStats;
  equityCurve:   { time: number; equity: number; drawdown: number }[];
  strategyStats: Record<string, { signals: number; wins: number; losses: number; winRate: number }>;
  candleCount:   number;
  elapsedMs:     number;
}

// ─── Symbol risk params ───────────────────────────────────────────────────────

const SYMBOL_RISK: Record<string, { sl: number; tp: number; lots: number }> = {
  XAUUSD: { sl: 15,   tp: 30,   lots: 0.01  },
  BTCUSD: { sl: 500,  tp: 1000, lots: 0.001 },
};

// ─── Main backtest function ───────────────────────────────────────────────────

export function runBacktest(
  candles:       Candle[],
  config:        BotConfig,
  initialEquity: number = 10_000,
): BacktestResult {
  const t0   = Date.now();
  const risk = SYMBOL_RISK[config.symbol.toUpperCase()] ?? SYMBOL_RISK["XAUUSD"];

  const WARM_UP = 110;  // need ≥100 candles for MA100
  const trades:      BacktestTrade[]  = [];
  const equityCurve: BacktestResult["equityCurve"] = [];
  const stratHits:   Record<string, { signals: number; wins: number; losses: number }> = {};

  let equity     = initialEquity;
  let maxEquity  = equity;
  let maxDrawdown = 0;
  let totalConf   = 0;

  if (candles[WARM_UP]) {
    equityCurve.push({ time: candles[WARM_UP].time, equity, drawdown: 0 });
  }

  let open: {
    direction:  Direction;
    entry:      number;
    sl:         number;
    tp:         number;
    lots:       number;
    openTime:   number;
    openIndex:  number;
    strategies: string[];
    confidence: number;
  } | null = null;

  for (let i = WARM_UP; i < candles.length; i++) {
    const candle = candles[i];

    // ── Check open trade exit ─────────────────────────────────────────────
    if (open) {
      let closePrice: number | null = null;
      let outcome: "win" | "loss" | null = null;

      if (open.direction === "BUY") {
        if (candle.low  <= open.sl)   { closePrice = open.sl; outcome = "loss"; }
        else if (candle.high >= open.tp) { closePrice = open.tp; outcome = "win";  }
      } else {
        if (candle.high >= open.sl)   { closePrice = open.sl; outcome = "loss"; }
        else if (candle.low  <= open.tp) { closePrice = open.tp; outcome = "win";  }
      }

      if (outcome && closePrice !== null) {
        const pnl = parseFloat((
          (open.direction === "BUY"
            ? closePrice - open.entry
            : open.entry  - closePrice
          ) * open.lots * 100
        ).toFixed(2));

        trades.push({
          direction:  open.direction,
          openIndex:  open.openIndex,
          closeIndex: i,
          openTime:   open.openTime,
          closeTime:  candle.time,
          openPrice:  open.entry,
          closePrice,
          sl:         open.sl,
          tp:         open.tp,
          lots:       open.lots,
          pnl,
          outcome,
          strategies: open.strategies,
          confidence: open.confidence,
        });

        totalConf += open.confidence;

        for (const s of open.strategies) {
          if (!stratHits[s]) stratHits[s] = { signals: 0, wins: 0, losses: 0 };
          stratHits[s].signals++;
          if (outcome === "win") stratHits[s].wins++;
          else                   stratHits[s].losses++;
        }

        equity += pnl;
        if (equity > maxEquity) maxEquity = equity;
        const dd = maxEquity - equity;
        if (dd > maxDrawdown) maxDrawdown = dd;

        equityCurve.push({
          time:     candle.time,
          equity:   parseFloat(equity.toFixed(2)),
          drawdown: parseFloat(dd.toFixed(2)),
        });

        open = null;
      }
      continue;   // never open a new trade in the same candle
    }

    // ── Look for a new signal ─────────────────────────────────────────────
    // Pass the candle's own timestamp so the session filter uses historical
    // time (not the current wall-clock time, which would freeze every candle
    // to the same UTC hour and block trades outside the current session).
    const sig = evaluate(candles.slice(0, i + 1), config, candle.time);
    if (!sig.signal) continue;

    const entry = candle.close;
    open = {
      direction:  sig.signal,
      entry,
      sl:         sig.signal === "BUY"  ? entry - risk.sl : entry + risk.sl,
      tp:         sig.signal === "BUY"  ? entry + risk.tp : entry - risk.tp,
      lots:       risk.lots,
      openTime:   candle.time,
      openIndex:  i,
      strategies: sig.agreeing,
      confidence: sig.confidence,
    };
  }

  // ── Build stats ───────────────────────────────────────────────────────────
  const wins     = trades.filter(t => t.outcome === "win").length;
  const losses   = trades.length - wins;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const gProfit  = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const gLoss    = Math.abs(trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));

  const strategyStats: BacktestResult["strategyStats"] = {};
  for (const [name, s] of Object.entries(stratHits)) {
    strategyStats[name] = { ...s, winRate: s.signals ? parseFloat((s.wins / s.signals).toFixed(4)) : 0 };
  }

  return {
    trades,
    stats: {
      totalTrades:   trades.length,
      wins,
      losses,
      winRate:       trades.length ? parseFloat((wins / trades.length).toFixed(4)) : 0,
      totalPnl:      parseFloat(totalPnl.toFixed(2)),
      maxDrawdown:   parseFloat(maxDrawdown.toFixed(2)),
      avgTradePnl:   trades.length ? parseFloat((totalPnl / trades.length).toFixed(2)) : 0,
      profitFactor:  gLoss > 0 ? parseFloat((gProfit / gLoss).toFixed(2)) : (gProfit > 0 ? 999 : 0),
      avgConfidence: trades.length ? parseFloat((totalConf / trades.length).toFixed(4)) : 0,
    },
    equityCurve,
    strategyStats,
    candleCount: candles.length,
    elapsedMs:   Date.now() - t0,
  };
}

// ─── Optimizer ────────────────────────────────────────────────────────────────

/** One entry in the sweep results table. */
export interface OptimizeCombo {
  rank:           number;
  mode:           string;
  minConfidence:  number;
  strategyPreset: string;
  strategyConfig: Record<string, boolean>;
  stats:          BacktestStats;
}

export interface OptimizeResult {
  results:   OptimizeCombo[];
  best:      OptimizeCombo | null;
  totalRuns: number;
  elapsedMs: number;
  sortBy:    string;
}

// Strategy presets — each defines which strategies are enabled
const STRATEGY_PRESETS: Array<{ name: string; cfg: Record<string, boolean> }> = [
  {
    name: "Core",
    cfg:  { liquiditySweep: true,  fairValueGap: true,  maFilter: true,  orderBlock: false, marketStructure: false, sessionFilter: false },
  },
  {
    name: "Core + Session",
    cfg:  { liquiditySweep: true,  fairValueGap: true,  maFilter: true,  orderBlock: false, marketStructure: false, sessionFilter: true  },
  },
  {
    name: "Core + OrderBlock",
    cfg:  { liquiditySweep: true,  fairValueGap: true,  maFilter: true,  orderBlock: true,  marketStructure: false, sessionFilter: false },
  },
  {
    name: "Core + MarketStructure",
    cfg:  { liquiditySweep: true,  fairValueGap: true,  maFilter: true,  orderBlock: false, marketStructure: true,  sessionFilter: false },
  },
  {
    name: "All Strategies",
    cfg:  { liquiditySweep: true,  fairValueGap: true,  maFilter: true,  orderBlock: true,  marketStructure: true,  sessionFilter: true  },
  },
  {
    name: "Sweep + MA Only",
    cfg:  { liquiditySweep: true,  fairValueGap: false, maFilter: true,  orderBlock: false, marketStructure: false, sessionFilter: false },
  },
  {
    name: "FVG + MA Only",
    cfg:  { liquiditySweep: false, fairValueGap: true,  maFilter: true,  orderBlock: false, marketStructure: false, sessionFilter: false },
  },
  {
    name: "All + No Session",
    cfg:  { liquiditySweep: true,  fairValueGap: true,  maFilter: true,  orderBlock: true,  marketStructure: true,  sessionFilter: false },
  },
];

const OPT_MODES      = ["STRICT", "FLEX", "WEIGHTED"] as const;
const OPT_CONF_LEVELS = [0.30, 0.40, 0.50, 0.60];

type SortKey = "profitFactor" | "winRate" | "totalPnl" | "totalTrades";

export function runOptimize(
  candles:       Candle[],
  baseConfig:    BotConfig,
  initialEquity: number  = 10_000,
  sortBy:        SortKey = "profitFactor",
): OptimizeResult {
  const t0      = Date.now();
  const raw: Array<Omit<OptimizeCombo, "rank">> = [];

  for (const mode of OPT_MODES) {
    for (const minConfidence of OPT_CONF_LEVELS) {
      for (const preset of STRATEGY_PRESETS) {
        const cfg: BotConfig = {
          ...baseConfig,
          engine: { ...baseConfig.engine, mode, minConfidence },
          strategies: {
            liquiditySweep:  { ...baseConfig.strategies.liquiditySweep,  enabled: preset.cfg["liquiditySweep"]  ?? false },
            fairValueGap:    { ...baseConfig.strategies.fairValueGap,    enabled: preset.cfg["fairValueGap"]    ?? false },
            maFilter:        { ...baseConfig.strategies.maFilter,        enabled: preset.cfg["maFilter"]        ?? false },
            orderBlock:      { ...baseConfig.strategies.orderBlock,      enabled: preset.cfg["orderBlock"]      ?? false },
            marketStructure: { ...baseConfig.strategies.marketStructure, enabled: preset.cfg["marketStructure"] ?? false },
            sessionFilter:   { ...baseConfig.strategies.sessionFilter,   enabled: preset.cfg["sessionFilter"]   ?? false },
          },
        };
        const bt = runBacktest(candles, cfg, initialEquity);
        raw.push({
          mode,
          minConfidence,
          strategyPreset: preset.name,
          strategyConfig: { ...preset.cfg },
          stats:          bt.stats,
        });
      }
    }
  }

  // Sort by chosen metric, then secondary
  raw.sort((a, b) => {
    const primary = b.stats[sortBy] - a.stats[sortBy];
    if (primary !== 0) return primary;
    // tie-break: highest win rate, then highest PnL
    const wr = b.stats.winRate - a.stats.winRate;
    if (wr !== 0) return wr;
    return b.stats.totalPnl - a.stats.totalPnl;
  });

  const results: OptimizeCombo[] = raw.map((r, i) => ({ rank: i + 1, ...r }));

  return {
    results,
    best:      results[0] ?? null,
    totalRuns: results.length,
    elapsedMs: Date.now() - t0,
    sortBy,
  };
}
