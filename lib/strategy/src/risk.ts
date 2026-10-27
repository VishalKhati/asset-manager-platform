import { z } from "zod";

/**
 * Position sizing and the pre-trade risk check (PASS/BLOCK), borrowed from the idea of
 * sizing every trade to a fixed maximum loss and refusing trades that break your limits.
 * Pure functions: the API supplies today's figures.
 */

export const accountSchema = z
  .object({
    /** Account balance in the account currency. */
    balance: z.number().positive(),
    currency: z.enum(["USD", "INR"]),
    /** INR per USD, used when the account is in INR (MT5 gold is priced in USD). */
    usdInr: z.number().positive(),
    riskPerTradePct: z.number().positive().max(5),
    maxDailyLossPct: z.number().positive().max(20),
    maxTradesPerDay: z.number().int().min(1).max(50),
    minRewardRisk: z.number().min(0).max(10),
    /** Ounces per 1.00 lot on your broker (usually 100 for XAUUSD). */
    contractSize: z.number().positive(),
    minLot: z.number().positive(),
    lotStep: z.number().positive(),
    maxLot: z.number().positive(),
  })
  .strict()
  .refine((a) => a.minLot <= a.maxLot, { message: "minLot must not exceed maxLot" });

export type Account = z.infer<typeof accountSchema>;

export const DEFAULT_ACCOUNT: Account = {
  balance: 1000,
  currency: "USD",
  usdInr: 84,
  riskPerTradePct: 1,
  maxDailyLossPct: 3,
  maxTradesPerDay: 3,
  minRewardRisk: 1.5,
  contractSize: 100,
  minLot: 0.01,
  lotStep: 0.01,
  maxLot: 5,
};

export interface Sizing {
  lots: number;
  /** Money lost if the stop is hit, in account currency. */
  riskMoney: number;
  riskPct: number;
  budgetMoney: number;
  /** True when even the minimum lot risks more than the budget. */
  minLotOverBudget: boolean;
}

const toAccount = (usd: number, a: Account) => (a.currency === "INR" ? usd * a.usdInr : usd);

export function sizePosition(stopDistance: number, a: Account): Sizing {
  const budgetMoney = (a.balance * a.riskPerTradePct) / 100;
  const riskPerLotUsd = stopDistance * a.contractSize;
  const riskPerLot = toAccount(riskPerLotUsd, a);
  const raw = riskPerLot > 0 ? budgetMoney / riskPerLot : 0;
  // Round down to the broker's lot step (with a tiny epsilon for float noise).
  let lots = Math.floor(raw / a.lotStep + 1e-9) * a.lotStep;
  lots = Math.min(Number(lots.toFixed(6)), a.maxLot);
  const minLotOverBudget = lots < a.minLot;
  if (minLotOverBudget) lots = a.minLot;
  const riskMoney = lots * riskPerLot;
  return { lots: Number(lots.toFixed(2)), riskMoney, riskPct: (riskMoney / a.balance) * 100, budgetMoney, minLotOverBudget };
}

export interface CheckInput {
  direction: 1 | -1;
  entry: number;
  sl: number;
  tp2: number;
  validUntil: number;
  now: number;
  /** Realised money result of trades approved today (negative = loss). */
  todayResultMoney: number;
  approvedToday: number;
  openApproved: number;
}

export interface Check {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface RiskCheck {
  pass: boolean;
  sizing: Sizing;
  checks: Check[];
}

export function riskCheck(x: CheckInput, a: Account): RiskCheck {
  const stop = Math.abs(x.entry - x.sl);
  const sizing = sizePosition(stop, a);
  const rr = stop > 0 ? Math.abs(x.tp2 - x.entry) / stop : 0;
  const dailyLimit = (a.balance * a.maxDailyLossPct) / 100;
  const cur = a.currency === "INR" ? "₹" : "$";
  const m = (v: number) => `${v < 0 ? "−" : ""}${cur}${Math.abs(v).toFixed(2)}`;
  const checks: Check[] = [
    {
      id: "risk_per_trade",
      label: "Risk per trade",
      pass: !sizing.minLotOverBudget,
      detail: sizing.minLotOverBudget
        ? `Minimum lot ${a.minLot} risks ${m(sizing.riskMoney)}, above the ${m(sizing.budgetMoney)} budget`
        : `${sizing.lots} lots risk ${m(sizing.riskMoney)} (${sizing.riskPct.toFixed(2)}%) of a ${m(sizing.budgetMoney)} budget`,
    },
    {
      id: "daily_loss",
      label: "Daily loss limit",
      pass: x.todayResultMoney - sizing.riskMoney >= -dailyLimit,
      detail: `Today ${m(x.todayResultMoney)}; a stop-out would make it ${m(x.todayResultMoney - sizing.riskMoney)} (limit ${m(-dailyLimit)})`,
    },
    {
      id: "trades_per_day",
      label: "Trades per day",
      pass: x.approvedToday < a.maxTradesPerDay,
      detail: `${x.approvedToday} of ${a.maxTradesPerDay} used today`,
    },
    {
      id: "reward_risk",
      label: "Reward to risk",
      pass: rr >= a.minRewardRisk,
      detail: `TP2 is ${rr.toFixed(2)}R away (minimum ${a.minRewardRisk}R)`,
    },
    {
      id: "entry_window",
      label: "Entry window",
      pass: x.now < x.validUntil,
      detail: x.now < x.validUntil ? `Valid for ${Math.ceil((x.validUntil - x.now) / 60)} more min` : "Signal expired; do not enter late",
    },
    {
      id: "one_position",
      label: "One position at a time",
      pass: x.openApproved === 0,
      detail: x.openApproved === 0 ? "No other approved trade is open" : `${x.openApproved} approved trade still open`,
    },
  ];
  return { pass: checks.every((c) => c.pass), sizing, checks };
}
