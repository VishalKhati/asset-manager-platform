import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Engine, parseParams, signalToJson, type Bar } from "../src";

/**
 * Golden parity: the TypeScript engine must reproduce, exactly, what the Python reference
 * (research/scripts/make_golden.py) produced for the same M1 bars, params and news times.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.resolve(here, "../../../fixtures/golden");
const cases = existsSync(GOLDEN) ? readdirSync(GOLDEN).filter((d) => existsSync(path.join(GOLDEN, d, "expected.json"))) : [];

function readBars(file: string): Bar[] {
  const lines = readFileSync(file, "utf8").trim().split("\n").slice(1);
  return lines.map((line) => {
    const [t, o, h, l, c, spread] = line.split(",");
    return { t: Number(t), o: Number(o), h: Number(h), l: Number(l), c: Number(c), spread: Number(spread) };
  });
}

function close(a: number | null, b: number | null | undefined): boolean {
  if (a === null || b === null || b === undefined) return (a === null || Number.isNaN(a)) && (b === null || b === undefined || Number.isNaN(b));
  if (Number.isNaN(a)) return false;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
}

function num(x: number): number | null {
  return Number.isNaN(x) ? null : x;
}

describe("golden parity with the Python reference", () => {
  it("has fixtures to check", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const name of cases) {
    describe(name, () => {
      const dir = path.join(GOLDEN, name);
      const expected = JSON.parse(readFileSync(path.join(dir, "expected.json"), "utf8"));
      const params = parseParams(JSON.parse(readFileSync(path.join(dir, "params.json"), "utf8")));
      const news: number[] = JSON.parse(readFileSync(path.join(dir, "news.json"), "utf8"));
      const engine = new Engine(params, { news, recordDecisions: true, maxBars: 1e9 }).run(readBars(path.join(dir, "m1.csv")));

      it("counts bars and signals the same way", () => {
        expect({ m5: engine.m5.length, m15: engine.m15.length, signals: engine.signals.length }).toEqual({
          m5: expected.counts.m5,
          m15: expected.counts.m15,
          signals: expected.counts.signals,
        });
      });

      it("computes identical indicators", () => {
        const bad: string[] = [];
        engine.m5.forEach((b, i) => {
          const e = expected.m5[i];
          for (const key of ["emaFast", "emaSlow", "atr", "k", "d"] as const) {
            if (e.t !== b.t || !close(num(b[key]), e[key])) bad.push(`m5[${i}] ${key}: ${b[key]} vs ${e[key]}`);
          }
        });
        engine.m15.forEach((b, i) => {
          const e = expected.m15[i];
          for (const key of ["emaFast", "emaSlow", "emaTrend"] as const) {
            if (e.t !== b.t || !close(num(b[key]), e[key])) bad.push(`m15[${i}] ${key}: ${b[key]} vs ${e[key]}`);
          }
        });
        expect(bad.slice(0, 10)).toEqual([]);
      });

      it("makes the same decision at every M5 close", () => {
        expect(engine.decisions.length).toBe(expected.decisions.length);
        const diffs = engine.decisions
          .map((d, i) => ({ d, e: expected.decisions[i] }))
          .filter(({ d, e }) => d.t !== e.t || d.reason !== e.reason)
          .slice(0, 5);
        expect(diffs).toEqual([]);
        expect(engine.reasons).toEqual(expected.reasons);
      });

      it("resolves every signal to the same outcome and R", () => {
        const got = engine.signals.map(signalToJson);
        expect(got.length).toBe(expected.signals.length);
        got.forEach((g, i) => {
          const e = expected.signals[i];
          for (const [key, value] of Object.entries(e)) {
            const actual = (g as Record<string, unknown>)[key];
            if (typeof value === "number") {
              expect(close(actual as number, value), `signal ${i} ${key}: ${actual} vs ${value}`).toBe(true);
            } else if (key === "events") {
              const ev = actual as Array<{ type: string; t: number; price: number }>;
              expect(ev.map((x) => [x.type, x.t])).toEqual((value as typeof ev).map((x) => [x.type, x.t]));
              ev.forEach((x, j) => expect(close(x.price, (value as typeof ev)[j]!.price)).toBe(true));
            } else {
              expect(actual, `signal ${i} ${key}`).toEqual(value);
            }
          }
        });
      });
    });
  }
});
