/**
 * Price Service — fetches OHLCV candles for XAUUSD and BTCUSD.
 *
 * XAUUSD: Yahoo Finance (GC=F futures, free, no key)
 * BTCUSD: Binance REST API (public endpoint, no key)
 *
 * Falls back to realistic mock data when fetches fail.
 */

import { type Candle } from "./botEngine.js";

// ─── In-process candle cache (30 s TTL) ──────────────────────────────────────
// Prevents hammering Yahoo Finance / Binance when multiple requests arrive
// at the same time (e.g. backtester, optimizer, signal endpoint all racing).

const CANDLE_TTL_MS = 30_000;

interface CacheEntry { candles: Candle[]; ts: number }
const candleCache = new Map<string, CacheEntry>();

function getCached(symbol: string): Candle[] | null {
  const entry = candleCache.get(symbol);
  if (!entry) return null;
  if (Date.now() - entry.ts > CANDLE_TTL_MS) { candleCache.delete(symbol); return null; }
  return entry.candles;
}
function setCache(symbol: string, candles: Candle[]): void {
  candleCache.set(symbol, { candles, ts: Date.now() });
}

// ─── Historical candle cache (separate TTL — 5 min is fine for backtesting) ──

const HIST_TTL_MS = 5 * 60_000;
const histCache   = new Map<string, CacheEntry>();

function getHistCached(symbol: string): Candle[] | null {
  const entry = histCache.get(symbol);
  if (!entry) return null;
  if (Date.now() - entry.ts > HIST_TTL_MS) { histCache.delete(symbol); return null; }
  return entry.candles;
}
function setHistCache(symbol: string, candles: Candle[]): void {
  histCache.set(symbol, { candles, ts: Date.now() });
}

// ─── Dispatchers ─────────────────────────────────────────────────────────────

export async function fetchCandles(symbol = "XAUUSD"): Promise<Candle[]> {
  const cached = getCached(symbol);
  if (cached) return cached;
  const s = symbol.toUpperCase();
  const candles = await (s === "BTCUSD" || s === "BTCUSDT" ? fetchBtcCandles() : fetchGoldCandles());
  setCache(symbol, candles);
  return candles;
}

/**
 * Fetch longer historical candles (hourly interval) for backtesting.
 * Returns 500–720 candles, giving the warm-up period room to breathe and
 * leaving 400+ candles for actual simulation.
 */
export async function fetchHistoricalCandles(symbol = "XAUUSD"): Promise<Candle[]> {
  const cached = getHistCached(symbol);
  if (cached) return cached;
  const s = symbol.toUpperCase();
  const candles = await (s === "BTCUSD" || s === "BTCUSDT"
    ? fetchBtcHistoricalCandles()
    : fetchGoldHistoricalCandles());
  setHistCache(symbol, candles);
  return candles;
}

export async function fetchCurrentPrice(symbol = "XAUUSD"): Promise<number | null> {
  const s = symbol.toUpperCase();
  if (s === "BTCUSD" || s === "BTCUSDT") return fetchBtcPrice();
  return fetchGoldPrice();
}

// ─── Gold (Yahoo Finance) ────────────────────────────────────────────────────

const GOLD_SYMBOL    = "GC=F";
const YF_INTERVAL    = "1m";
const YF_RANGE       = "1d";
const YF_HIST_INT    = "1h";
const YF_HIST_RANGE  = "60d";

interface YahooMeta  { regularMarketPrice: number; currency: string }
interface YahooQuote { open: number[]; high: number[]; low: number[]; close: number[]; volume: number[]; timestamp: number[] }

async function fetchGoldCandles(): Promise<Candle[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${GOLD_SYMBOL}?interval=${YF_INTERVAL}&range=${YF_RANGE}`;
    const res  = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);

    const json = await res.json() as {
      chart: { result: Array<{ meta: YahooMeta; timestamp: number[]; indicators: { quote: YahooQuote[] } }> };
    };
    const result = json.chart.result[0];
    const q      = result.indicators.quote[0];
    const out: Candle[] = [];

    for (let i = 0; i < result.timestamp.length; i++) {
      if (!q.close[i]) continue;
      out.push({ time: result.timestamp[i], open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] ?? 0 });
    }
    return out;
  } catch {
    return generateMockCandles(2640, 3);
  }
}

async function fetchGoldHistoricalCandles(): Promise<Candle[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${GOLD_SYMBOL}?interval=${YF_HIST_INT}&range=${YF_HIST_RANGE}`;
    const res  = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);

    const json = await res.json() as {
      chart: { result: Array<{ meta: YahooMeta; timestamp: number[]; indicators: { quote: YahooQuote[] } }> };
    };
    const result = json.chart.result[0];
    const q      = result.indicators.quote[0];
    const out: Candle[] = [];

    for (let i = 0; i < result.timestamp.length; i++) {
      if (!q.close[i]) continue;
      out.push({ time: result.timestamp[i], open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] ?? 0 });
    }
    if (out.length < 150) throw new Error("Too few candles returned");
    return out;
  } catch {
    return generateMockCandles(2640, 3, 1000, 3600);
  }
}

async function fetchGoldPrice(): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${GOLD_SYMBOL}?interval=1m&range=5m`;
    const res  = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const json = await res.json() as { chart: { result: Array<{ meta: YahooMeta }> } };
    return json.chart.result[0].meta.regularMarketPrice ?? null;
  } catch { return null; }
}

// ─── BTC (Binance public REST) ────────────────────────────────────────────────

type BinanceKline = [number, string, string, string, string, string, ...unknown[]];
// [openTime, open, high, low, close, volume, ...]

async function fetchBtcCandles(): Promise<Candle[]> {
  try {
    const url = "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=200";
    const res  = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);

    const data = await res.json() as BinanceKline[];
    return data.map(k => ({
      time:   Math.floor(Number(k[0]) / 1000),
      open:   parseFloat(k[1]),
      high:   parseFloat(k[2]),
      low:    parseFloat(k[3]),
      close:  parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } catch {
    return generateMockCandles(94000, 150);
  }
}

async function fetchBtcHistoricalCandles(): Promise<Candle[]> {
  try {
    const url = "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=720";
    const res  = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);

    const data = await res.json() as BinanceKline[];
    if (data.length < 150) throw new Error("Too few candles");
    return data.map(k => ({
      time:   Math.floor(Number(k[0]) / 1000),
      open:   parseFloat(k[1]),
      high:   parseFloat(k[2]),
      low:    parseFloat(k[3]),
      close:  parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } catch {
    return generateMockCandles(94000, 1500, 1000, 3600);
  }
}

async function fetchBtcPrice(): Promise<number | null> {
  try {
    const url = "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT";
    const res  = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const data = await res.json() as { price: string };
    return parseFloat(data.price);
  } catch { return null; }
}

// ─── Mock data generator ──────────────────────────────────────────────────────

/**
 * Generates realistic OHLCV candles using a mean-reverting random walk.
 * @param basePrice   Starting price
 * @param volatility  Per-candle price swing magnitude
 * @param count       Number of candles (default 200)
 * @param intervalSec Seconds per candle (default 60 = 1 minute)
 */
function generateMockCandles(
  basePrice:   number,
  volatility:  number,
  count        = 200,
  intervalSec  = 60,
): Candle[] {
  const candles: Candle[] = [];
  let price    = basePrice + (Math.random() - 0.5) * volatility * 10;
  const now    = Math.floor(Date.now() / 1000);
  const origin = basePrice;

  for (let i = count; i >= 0; i--) {
    // Mean-reversion: gently pull price back toward base price
    const drift  = (origin - price) * 0.005;
    const change = drift + (Math.random() - 0.5) * volatility * 2;
    const open   = price;
    const close  = parseFloat((open + change).toFixed(2));
    const wick   = volatility * (0.3 + Math.random() * 0.7);
    const high   = parseFloat((Math.max(open, close) + wick * Math.random()).toFixed(2));
    const low    = parseFloat((Math.min(open, close) - wick * Math.random()).toFixed(2));
    candles.push({ time: now - i * intervalSec, open, high, low, close, volume: Math.floor(Math.random() * 5000 + 500) });
    price = close;
  }
  return candles;
}
