/** Trade statistics in R. Mirrors research/src/xausig/stats.py (summarize). */

export interface Summary {
  trades: number;
  expired: number;
  wins: number;
  losses: number;
  winRate: number;
  totalR: number;
  expectancyR: number;
  profitFactor: number | null; // null = no losing trades yet
  avgWinR: number;
  avgLossR: number;
  maxDrawdownR: number;
  longestLosingStreak: number;
  outcomes: Record<string, number>;
}

export function summarize(rValues: readonly number[], outcomes: readonly string[] = [], expired = 0): Summary {
  const n = rValues.length;
  let grossWin = 0.0;
  let grossLoss = 0.0;
  let wins = 0;
  let losses = 0;
  let total = 0.0;
  let peak = 0.0;
  let maxDd = 0.0;
  let streak = 0;
  let longest = 0;
  for (const r of rValues) {
    if (r > 0) {
      wins += 1;
      grossWin += r;
    } else if (r < 0) {
      losses += 1;
      grossLoss += r;
    }
    total += r;
    peak = Math.max(peak, total);
    maxDd = Math.max(maxDd, peak - total);
    streak = r < 0 ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  const counts: Record<string, number> = {};
  for (const o of outcomes) counts[o] = (counts[o] ?? 0) + 1;
  return {
    trades: n,
    expired,
    wins,
    losses,
    winRate: n ? wins / n : 0,
    totalR: total,
    expectancyR: n ? total / n : 0,
    profitFactor: grossLoss < 0 ? grossWin / -grossLoss : grossWin > 0 ? null : 0,
    avgWinR: wins ? grossWin / wins : 0,
    avgLossR: losses ? grossLoss / losses : 0,
    maxDrawdownR: maxDd,
    longestLosingStreak: longest,
    outcomes: counts,
  };
}

/** Cumulative R points for an equity curve. */
export function equityCurve(trades: ReadonlyArray<{ t: number; rNet: number }>): Array<[number, number]> {
  let total = 0;
  return [...trades]
    .sort((a, b) => a.t - b.t)
    .map((x) => {
      total += x.rNet;
      return [x.t, total] as [number, number];
    });
}
