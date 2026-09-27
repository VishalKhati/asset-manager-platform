"""Trade statistics in R. Expired (never filled) signals are counted but excluded from trade stats.

Mirrored by ``lib/strategy/src/stats.ts``.
"""

from __future__ import annotations

import math
import random
from collections import Counter


def summarize(r_values: list[float], outcomes: list[str] | None = None, expired: int = 0) -> dict:
    n = len(r_values)
    wins = [r for r in r_values if r > 0]
    losses = [r for r in r_values if r < 0]
    gross_win = 0.0
    for r in wins:
        gross_win += r
    gross_loss = 0.0
    for r in losses:
        gross_loss += r
    total = 0.0
    peak = 0.0
    max_dd = 0.0
    streak = 0
    longest = 0
    for r in r_values:
        total += r
        peak = max(peak, total)
        max_dd = max(max_dd, peak - total)
        streak = streak + 1 if r < 0 else 0
        longest = max(longest, streak)
    return {
        "trades": n,
        "expired": expired,
        "wins": len(wins),
        "losses": len(losses),
        "winRate": len(wins) / n if n else 0.0,
        "totalR": total,
        "expectancyR": total / n if n else 0.0,
        "profitFactor": (gross_win / -gross_loss) if gross_loss < 0 else (math.inf if gross_win > 0 else 0.0),
        "avgWinR": gross_win / len(wins) if wins else 0.0,
        "avgLossR": gross_loss / len(losses) if losses else 0.0,
        "maxDrawdownR": max_dd,
        "longestLosingStreak": longest,
        "outcomes": dict(Counter(outcomes)) if outcomes else {},
    }


def bootstrap_expectancy_ci(r_values: list[float], iterations: int = 2000, seed: int = 7) -> tuple[float, float]:
    """95% bootstrap confidence interval of the mean R."""
    if len(r_values) < 2:
        return (math.nan, math.nan)
    rng = random.Random(seed)
    n = len(r_values)
    means = sorted(sum(rng.choice(r_values) for _ in range(n)) / n for _ in range(iterations))
    return (means[int(0.025 * iterations)], means[int(0.975 * iterations) - 1])


def monte_carlo_drawdown(r_values: list[float], iterations: int = 2000, seed: int = 11) -> dict:
    """Max drawdown distribution over shuffled trade orders."""
    if not r_values:
        return {"p50": 0.0, "p95": 0.0}
    rng = random.Random(seed)
    values = list(r_values)
    dds = []
    for _ in range(iterations):
        rng.shuffle(values)
        total = peak = dd = 0.0
        for r in values:
            total += r
            peak = max(peak, total)
            dd = max(dd, peak - total)
        dds.append(dd)
    dds.sort()
    return {"p50": dds[iterations // 2], "p95": dds[int(0.95 * iterations) - 1]}
