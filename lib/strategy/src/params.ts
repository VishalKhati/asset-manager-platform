import { z } from "zod";

/** Strategy and policy parameters. Keys match research/src/xausig/params.py exactly. */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");

export const sessionSchema = z.object({
  tz: z.string().min(1),
  start: hhmm,
  end: hhmm,
});
export type Session = z.infer<typeof sessionSchema>;

export const paramsSchema = z
  .object({
    emaFast: z.number().int().min(2).max(500),
    emaSlow: z.number().int().min(2).max(500),
    emaTrend: z.number().int().min(2).max(1000),
    stochK: z.number().int().min(2).max(100),
    stochSmooth: z.number().int().min(1).max(50),
    stochD: z.number().int().min(1).max(50),
    stochLow: z.number().min(0).max(100),
    stochHigh: z.number().min(0).max(100),
    pullbackBars: z.number().int().min(1).max(50),
    atrPeriod: z.number().int().min(2).max(200),
    slAtrMult: z.number().positive().max(20),
    swingBars: z.number().int().min(2).max(200),
    swingBufferAtr: z.number().min(0).max(5),
    tp1R: z.number().positive().max(20),
    tp2R: z.number().positive().max(50),
    tp1Fraction: z.number().min(0).max(1),
    validMin: z.number().int().min(1).max(1440),
    entryToleranceR: z.number().min(0).max(5),
    maxHoldMin: z.number().int().min(1).max(10080),
    sessions: z.array(sessionSchema).min(1),
    fridayCutoffUtc: hhmm,
    fridayExitUtc: hhmm,
    newsBlackoutMin: z.number().int().min(0).max(240),
    maxSpread: z.number().positive(),
    maxSpreadAtrFrac: z.number().positive(),
    atrMinBps: z.number().min(0),
    atrMaxBps: z.number().positive(),
    cooldownAfterLossMin: z.number().int().min(0).max(10080),
    commission: z.number().min(0),
    slippage: z.number().min(0),
    warmupM5: z.number().int().min(3),
    warmupM15: z.number().int().min(1),
  })
  .strict()
  .refine((p) => p.emaFast < p.emaSlow, { message: "emaFast must be below emaSlow" })
  .refine((p) => p.stochLow < p.stochHigh, { message: "stochLow must be below stochHigh" })
  .refine((p) => p.tp1R < p.tp2R, { message: "tp1R must be below tp2R" })
  .refine((p) => p.atrMinBps < p.atrMaxBps, { message: "atrMinBps must be below atrMaxBps" });

export type Params = z.infer<typeof paramsSchema>;

export const DEFAULT_PARAMS: Params = Object.freeze({
  emaFast: 20,
  emaSlow: 50,
  emaTrend: 200,
  stochK: 5,
  stochSmooth: 3,
  stochD: 3,
  stochLow: 20.0,
  stochHigh: 80.0,
  pullbackBars: 3,
  atrPeriod: 14,
  slAtrMult: 1.5,
  swingBars: 10,
  swingBufferAtr: 0.1,
  tp1R: 1.0,
  tp2R: 2.0,
  tp1Fraction: 0.5,
  validMin: 30,
  entryToleranceR: 0.25,
  maxHoldMin: 240,
  sessions: [
    { tz: "Europe/London", start: "07:00", end: "16:00" },
    { tz: "America/New_York", start: "08:00", end: "16:00" },
  ],
  fridayCutoffUtc: "20:00",
  fridayExitUtc: "20:45",
  newsBlackoutMin: 15,
  maxSpread: 1.0,
  maxSpreadAtrFrac: 0.25,
  atrMinBps: 1.5,
  atrMaxBps: 30.0,
  cooldownAfterLossMin: 60,
  commission: 0.06,
  slippage: 0.05,
  warmupM5: 150,
  warmupM15: 600,
}) as Params;

/** Validate a full parameter object, filling anything missing from the defaults. */
export function parseParams(input: unknown): Params {
  const merged = { ...DEFAULT_PARAMS, ...(input as Record<string, unknown>) };
  return paramsSchema.parse(merged);
}

export function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(":");
  return Number(h) * 60 + Number(m);
}
