import { describe, expect, it } from "vitest";
import { parseQuote } from "../src/realtime/quotes.js";

describe("parseQuote", () => {
  it("reads a Binance bookTicker", () => {
    expect(parseQuote({ bidPrice: "4006.14", askPrice: "4006.15" })).toEqual({ bid: 4006.14, ask: 4006.15 });
  });
  it("takes the median of Swissquote platforms and skips bad rows", () => {
    const q = (bid: number, ask: number) => ({ spreadProfilePrices: [{ bid, ask }] });
    expect(parseQuote([q(3996.5, 3997.2), q(3996.6, 3997.1), q(3996.7, 3997.3), q(0, 1), {}])).toEqual({ bid: 3996.6, ask: 3997.2 });
  });
  it("rejects nonsense", () => {
    expect(parseQuote([])).toBeNull();
    expect(parseQuote({ bidPrice: "5", askPrice: "4" })).toBeNull();
    expect(parseQuote(null)).toBeNull();
  });
});
