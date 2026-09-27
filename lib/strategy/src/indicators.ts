/**
 * Incremental indicators, updated one bar at a time. The arithmetic and its order match
 * research/src/xausig/indicators.py exactly, so results are bit-identical. NaN = not enough bars.
 */

export class Ema {
  readonly alpha: number;
  count = 0;
  total = 0;
  value = NaN;

  constructor(readonly n: number) {
    this.alpha = 2.0 / (n + 1);
  }

  update(x: number): number {
    this.count += 1;
    if (this.count < this.n) {
      this.total += x;
    } else if (this.count === this.n) {
      this.total += x;
      this.value = this.total / this.n;
    } else {
      this.value = this.alpha * x + (1.0 - this.alpha) * this.value;
    }
    return this.value;
  }
}

export class Atr {
  count = 0;
  total = 0;
  value = NaN;
  prevClose: number | null = null;

  constructor(readonly n: number) {}

  update(h: number, low: number, c: number): number {
    const prev = this.prevClose;
    const tr = prev === null ? h - low : Math.max(h - low, Math.abs(h - prev), Math.abs(low - prev));
    this.prevClose = c;
    this.count += 1;
    if (this.count < this.n) {
      this.total += tr;
    } else if (this.count === this.n) {
      this.total += tr;
      this.value = this.total / this.n;
    } else {
      this.value = (this.value * (this.n - 1) + tr) / this.n;
    }
    return this.value;
  }
}

function mean(values: readonly number[]): number {
  let total = 0.0;
  for (const v of values) total += v;
  return total / values.length;
}

/** Push into a fixed-length window, dropping the oldest value. */
function pushWindow(arr: number[], value: number, max: number): void {
  arr.push(value);
  if (arr.length > max) arr.shift();
}

/** Slow stochastic (k, smooth, d). */
export class Stoch {
  private highs: number[] = [];
  private lows: number[] = [];
  private raw: number[] = [];
  private slow: number[] = [];
  k = NaN;
  d = NaN;

  constructor(
    readonly kLen: number,
    readonly smooth: number,
    readonly dLen: number,
  ) {}

  update(h: number, low: number, c: number): [number, number] {
    pushWindow(this.highs, h, this.kLen);
    pushWindow(this.lows, low, this.kLen);
    if (this.highs.length < this.kLen) return [this.k, this.d];
    const hh = Math.max(...this.highs);
    const ll = Math.min(...this.lows);
    const raw = hh > ll ? (100.0 * (c - ll)) / (hh - ll) : 50.0;
    pushWindow(this.raw, raw, this.smooth);
    if (this.raw.length < this.smooth) return [this.k, this.d];
    this.k = mean(this.raw);
    pushWindow(this.slow, this.k, this.dLen);
    if (this.slow.length === this.dLen) this.d = mean(this.slow);
    return [this.k, this.d];
  }
}
