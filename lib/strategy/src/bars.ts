/** Bars and M1 → M5/M15 aggregation. Prices are bid; `spread` is ask − bid at the bar close. */

export const M1 = 60;
export const M5 = 300;
export const M15 = 900;

/** An M1 input bar. `t` is the bar open time in UTC epoch seconds. */
export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  spread: number;
}

/** A higher-timeframe bar with indicator values filled in when it closes. */
export interface IndBar extends Bar {
  emaFast: number;
  emaSlow: number;
  emaTrend: number;
  atr: number;
  k: number;
  d: number;
}

export function newIndBar(t: number, o: number, h: number, l: number, c: number, spread: number): IndBar {
  return { t, o, h, l, c, spread, emaFast: NaN, emaSlow: NaN, emaTrend: NaN, atr: NaN, k: NaN, d: NaN };
}

export class Aggregator {
  cur: IndBar | null = null;

  constructor(readonly tf: number) {}

  push(b: Bar): void {
    const start = b.t - (b.t % this.tf);
    const cur = this.cur;
    if (cur === null) {
      this.cur = newIndBar(start, b.o, b.h, b.l, b.c, b.spread);
      return;
    }
    if (start !== cur.t) throw new Error("push() into a bucket that was not closed first");
    if (b.h > cur.h) cur.h = b.h;
    if (b.l < cur.l) cur.l = b.l;
    cur.c = b.c;
    cur.spread = b.spread;
  }

  /** Close and return the current bucket if it ends at or before `now`. */
  closeIfDone(now: number): IndBar | null {
    const cur = this.cur;
    if (cur !== null && cur.t + this.tf <= now) {
      this.cur = null;
      return cur;
    }
    return null;
  }
}
