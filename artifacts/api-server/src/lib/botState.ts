/**
 * In-memory bot state — per-user, per-symbol singleton registry.
 * Key format: `${userId}:${SYMBOL}`
 *
 * Machine auth (MT5 bridge) uses userId = "_system".
 * Human users get their own isolated state.
 */

export type BotMode   = "signal" | "live" | "backtest";
export type Direction = "BUY" | "SELL";

export interface Trade {
  id:         string;
  symbol:     string;
  direction:  Direction;
  entry:      number;
  sl:         number;
  tp:         number;
  lots:       number;
  slPips:     number;
  tpPips:     number;
  confidence: number;
  strategies: string[];
  openedAt:   string;
  closedAt?:  string;
  pnl?:       number;
  status:     "open" | "closed" | "cancelled";
  reason?:    string;
}

export interface SignalResult {
  signal:     Direction | null;
  confidence: number;
  mode:       string;
  agreeing:   string[];
  reason:     string;
  timestamp:  string;
  price?:     number;
}

export interface LogEntry {
  level:   "info" | "warn" | "error" | "debug";
  message: string;
  ts:      string;
  meta?:   Record<string, unknown>;
}

export interface BotConfig {
  symbol:     string;
  mode:       BotMode;
  engine: {
    mode:            "STRICT" | "FLEX" | "WEIGHTED";
    weightThreshold: number;
    requireSession:  boolean;
    minConfidence?:  number;
  };
  risk: {
    riskPercent:     number;
    rrRatio:         number;
    maxTradesPerDay: number;
    trailingStop:    boolean;
    breakEven:       boolean;
  };
  strategies: {
    liquiditySweep:  { enabled: boolean; weight: number; lookback: number };
    fairValueGap:    { enabled: boolean; weight: number; lookback: number };
    maFilter:        { enabled: boolean; weight: number; periods: number[] };
    orderBlock:      { enabled: boolean; weight: number };
    marketStructure: { enabled: boolean; weight: number };
    sessionFilter:   { enabled: boolean; sessions: string[] };
  };
}

export function makeDefaultConfig(symbol: string): BotConfig {
  const isGold = symbol === "XAUUSD";
  return {
    symbol,
    mode:  "signal",
    engine: {
      mode:            "STRICT",
      weightThreshold: 0.6,
      requireSession:  isGold,
    },
    risk: {
      riskPercent:     1,
      rrRatio:         2,
      maxTradesPerDay: isGold ? 3 : 5,
      trailingStop:    true,
      breakEven:       true,
    },
    strategies: {
      liquiditySweep:  { enabled: true,  weight: 2, lookback: 30 },
      fairValueGap:    { enabled: true,  weight: 2, lookback: 50 },
      maFilter:        { enabled: true,  weight: 1, periods: [25, 50, 100] },
      orderBlock:      { enabled: false, weight: 1 },
      marketStructure: { enabled: false, weight: 1 },
      sessionFilter:   { enabled: isGold, sessions: ["london", "new_york"] },
    },
  };
}

// ─── Per-symbol state ─────────────────────────────────────────────────────────

export class SymbolState {
  symbol:        string;
  running:       boolean       = false;
  startedAt?:    string;
  stoppedAt?:    string;
  config:        BotConfig;
  lastSignal:      SignalResult | null = null;
  trades:          Trade[]       = [];
  logs:            LogEntry[]    = [];
  tradesToday:     number        = 0;
  lastResetDate:   string        = new Date().toDateString();
  bridgeLastPing:  string | null = null;
  bridgeVersion:   string | null = null;

  constructor(symbol: string) {
    this.symbol = symbol;
    this.config = makeDefaultConfig(symbol);
  }

  addTrade(trade: Trade): void {
    this.trades.unshift(trade);
    if (this.trades.length > 200) this.trades.pop();
    this._maybeDailyReset();
    this.tradesToday++;
  }

  canTrade(): boolean {
    this._maybeDailyReset();
    return this.tradesToday < this.config.risk.maxTradesPerDay;
  }

  resetConfig(): void {
    this.config = makeDefaultConfig(this.symbol);
  }

  private _maybeDailyReset(): void {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.tradesToday   = 0;
      this.lastResetDate = today;
    }
  }
}

// ─── Registry (keyed by `${userId}:${symbol}`) ───────────────────────────────

const SUPPORTED_SYMBOLS = ["XAUUSD", "BTCUSD"];

class BotRegistry {
  private instances = new Map<string, SymbolState>();

  /** Get or lazily create the SymbolState for a given user + symbol. */
  getOrCreate(userId: string, symbol: string): SymbolState {
    const key = `${userId}:${symbol.toUpperCase()}`;
    if (!this.instances.has(key)) {
      this.instances.set(key, new SymbolState(symbol.toUpperCase()));
    }
    return this.instances.get(key)!;
  }

  isSupported(symbol: string): boolean {
    return SUPPORTED_SYMBOLS.includes(symbol.toUpperCase());
  }

  symbols(): string[] {
    return SUPPORTED_SYMBOLS;
  }

  /** All loaded (userId, symbol, state) triples — used by hydration. */
  allEntries(): Array<{ userId: string; symbol: string; state: SymbolState }> {
    return Array.from(this.instances.entries()).map(([key, state]) => {
      const colon  = key.indexOf(":");
      const userId = key.slice(0, colon);
      const symbol = key.slice(colon + 1);
      return { userId, symbol, state };
    });
  }
}

export const botRegistry = new BotRegistry();
