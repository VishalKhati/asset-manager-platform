/**
 * Live price for the dashboard chart. Polls a public best bid/ask endpoint about once a
 * second while someone is watching, and hands each change to the SSE hub.
 *
 * Display only: the engine never reads these prices. Signals come from closed M1 bars sent
 * by the feeder. Outside gold trading hours nothing is sent.
 */

import type { Logger } from "pino";
import { goldMarketOpen } from "../engine/marketHours.js";

export interface Quote {
  /** Epoch seconds (server clock). */
  t: number;
  bid: number;
  ask: number;
  /** Where the price came from, shown next to it. */
  source: string;
}

export interface QuoteSource {
  url: string;
  label: string;
  pollMs: number;
}

const valid = (bid: number, ask: number) => Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask >= bid;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Accepts either a Binance bookTicker ({bidPrice, askPrice}) or Swissquote public quotes
 * (an array of platforms, each with spreadProfilePrices[0].{bid, ask}; the median is used).
 */
export function parseQuote(body: unknown): { bid: number; ask: number } | null {
  if (Array.isArray(body)) {
    const bids: number[] = [];
    const asks: number[] = [];
    for (const e of body as { spreadProfilePrices?: { bid?: number; ask?: number }[] }[]) {
      const p = e?.spreadProfilePrices?.[0];
      const bid = Number(p?.bid);
      const ask = Number(p?.ask);
      if (valid(bid, ask)) {
        bids.push(bid);
        asks.push(ask);
      }
    }
    return bids.length ? { bid: median(bids), ask: median(asks) } : null;
  }
  const b = body as { bidPrice?: string; askPrice?: string };
  const bid = Number(b?.bidPrice);
  const ask = Number(b?.askPrice);
  return valid(bid, ask) ? { bid, ask } : null;
}

export class QuotePoller {
  private timer: NodeJS.Timeout | null = null;
  private last: Quote | null = null;
  private failures = 0;

  constructor(
    private readonly src: QuoteSource,
    private readonly onQuote: (q: Quote) => void,
    private readonly wanted: () => boolean,
    private readonly log: Logger,
  ) {}

  latest(): Quote | null {
    // A quote older than 30 s is stale; better to show nothing than an old price.
    return this.last && Date.now() / 1000 - this.last.t < 30 ? this.last : null;
  }

  start(): void {
    const tick = async () => {
      if (this.wanted() && goldMarketOpen(Math.floor(Date.now() / 1000))) await this.poll();
      // Back off to 10 s after repeated failures.
      this.timer = setTimeout(tick, this.failures > 3 ? 10_000 : this.src.pollMs);
      this.timer.unref();
    };
    void tick();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    try {
      const res = await fetch(this.src.url, { signal: AbortSignal.timeout(5_000), headers: { "User-Agent": "xau-signal-dashboard" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const p = parseQuote(await res.json());
      if (!p) throw new Error("unexpected response");
      if (this.failures > 3) this.log.info("live quote feed recovered");
      this.failures = 0;
      const q: Quote = { t: Math.floor(Date.now() / 1000), bid: p.bid, ask: p.ask, source: this.src.label };
      const changed = !this.last || this.last.bid !== q.bid || this.last.ask !== q.ask;
      this.last = q;
      if (changed) this.onQuote(q);
    } catch (err) {
      this.failures += 1;
      if (this.failures === 4) this.log.warn({ err: String(err) }, "live quote feed failing; retrying every 10 s");
    }
  }
}
