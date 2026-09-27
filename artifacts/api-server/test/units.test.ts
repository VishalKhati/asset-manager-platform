import { describe, expect, it } from "vitest";
import type { DbSignal } from "@workspace/db";
import { goldMarketOpen } from "../src/engine/marketHours.js";
import { parseForexFactory } from "../src/engine/news.js";
import { esc, renderSignal, renderUpdate } from "../src/telegram/templates.js";
import { publicNo } from "../src/engine/liveEngine.js";

const ts = (s: string) => Date.parse(s) / 1000;

describe("gold market hours (New York time)", () => {
  it("is closed from Friday 17:00 to Sunday 18:00 and during the daily break", () => {
    expect(goldMarketOpen(ts("2026-09-25T20:59:00Z"))).toBe(true); // Fri 16:59 EDT
    expect(goldMarketOpen(ts("2026-09-25T21:00:00Z"))).toBe(false); // Fri 17:00 EDT
    expect(goldMarketOpen(ts("2026-09-26T12:00:00Z"))).toBe(false); // Saturday
    expect(goldMarketOpen(ts("2026-09-27T21:59:00Z"))).toBe(false); // Sun 17:59 EDT
    expect(goldMarketOpen(ts("2026-09-27T22:00:00Z"))).toBe(true); // Sun 18:00 EDT
    expect(goldMarketOpen(ts("2026-09-29T21:30:00Z"))).toBe(false); // Tue daily break
    expect(goldMarketOpen(ts("2026-01-13T22:30:00Z"))).toBe(false); // Tue 17:30 EST: daily break in winter
    expect(goldMarketOpen(ts("2026-01-13T23:00:00Z"))).toBe(true); // Tue 18:00 EST
  });
});

describe("ForexFactory calendar parsing", () => {
  it("keeps valid events with UTC times and normalised impact", () => {
    const rows = parseForexFactory([
      { title: "Non-Farm Employment Change", country: "USD", date: "2026-10-02T08:30:00-04:00", impact: "High" },
      { title: "Bank Holiday", country: "JPY", date: "2026-10-05T00:00:00-04:00", impact: "Holiday" },
      { title: "Broken", country: "USD", date: "not a date", impact: "High" },
    ]);
    expect(rows).toEqual([
      { extId: "2026-10-02T08:30:00-04:00|USD|Non-Farm Employment Change", currency: "USD", title: "Non-Farm Employment Change", impact: "high", t: ts("2026-10-02T12:30:00Z") },
    ]);
  });
});

describe("Telegram templates", () => {
  const signal = {
    id: 7,
    publicNo: publicNo("XAUUSD", 7),
    symbol: "XAUUSD",
    strategyId: "ema_stoch_atr",
    strategyVersion: 1,
    direction: "long",
    entryRef: 2400.5,
    sl: 2397.5,
    tp1: 2403.5,
    tp2: 2406.5,
    validUntil: ts("2026-10-01T10:35:00Z"),
    state: "closed",
    outcome: "tp2",
    rNet: 1.47,
    fill: 2400.6,
    slCurrent: 2400.6,
  } as unknown as DbSignal;

  it("numbers signals XAU-000007", () => {
    expect(signal.publicNo).toBe("XAU-000007");
  });

  it("renders levels, status and the disclaimer", () => {
    const text = renderSignal(signal, [], { tp1Fraction: 0.5 });
    expect(text).toContain("XAUUSD BUY");
    expect(text).toContain("2397.50");
    expect(text).toContain("close 50%");
    expect(text).toContain("TP2 hit · +1.47R");
    expect(text).toContain("not financial advice");
    expect(renderUpdate(signal, "tp2")).toContain("+1.47R");
  });

  it("escapes HTML", () => {
    expect(esc("<b>&</b>")).toBe("&lt;b&gt;&amp;&lt;/b&gt;");
  });
});
