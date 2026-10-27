/**
 * Trade tools borrowed from the "day-trader" workflow: position sizing, a PASS/BLOCK risk
 * check, per-signal odds (Time Machine) and typed-YES approval of a trade ticket.
 */

import { and, asc, eq, gte, lt } from "drizzle-orm";
import {
  accountSettingsTable,
  candlesTable,
  db,
  signalsTable,
  strategyConfigsTable,
  tradeTicketsTable,
  type DbSignal,
} from "@workspace/db";
import { accountSchema, DEFAULT_ACCOUNT, riskCheck, timeMachine, type Account, type RiskCheck, type ShapeCandle, type TmResult } from "@workspace/strategy";

const DAY = 86_400;
const OPEN_STATES = ["pending", "active", "be"];

// ---------------------------------------------------------------- account settings
export async function getAccount(): Promise<Account> {
  const [row] = await db.select().from(accountSettingsTable).where(eq(accountSettingsTable.id, 1));
  const parsed = accountSchema.safeParse({ ...DEFAULT_ACCOUNT, ...(row?.settings ?? {}) });
  return parsed.success ? parsed.data : DEFAULT_ACCOUNT;
}

export async function saveAccount(settings: Account, actor: string): Promise<void> {
  await db
    .insert(accountSettingsTable)
    .values({ id: 1, settings: settings as unknown as Record<string, unknown>, updatedBy: actor })
    .onConflictDoUpdate({ target: accountSettingsTable.id, set: { settings: settings as unknown as Record<string, unknown>, updatedBy: actor, updatedAt: new Date() } });
}

// ---------------------------------------------------------------- risk check
export interface TodayFigures {
  todayResultMoney: number;
  approvedToday: number;
  openApproved: number;
}

/** Figures for the risk limits, over approved tickets of the current UTC day. */
export async function todayFigures(nowS: number): Promise<TodayFigures> {
  const dayStart = nowS - (nowS % DAY);
  const rows = await db
    .select({ approvedT: tradeTicketsTable.approvedT, risk: tradeTicketsTable.riskMoney, state: signalsTable.state, rNet: signalsTable.rNet, outcome: signalsTable.outcome })
    .from(tradeTicketsTable)
    .innerJoin(signalsTable, eq(signalsTable.id, tradeTicketsTable.signalId))
    .where(eq(tradeTicketsTable.status, "approved"));
  let todayResultMoney = 0;
  let approvedToday = 0;
  let openApproved = 0;
  for (const r of rows) {
    if (OPEN_STATES.includes(r.state)) openApproved += 1;
    if (r.approvedT >= dayStart) {
      approvedToday += 1;
      if (r.outcome && r.outcome !== "expired" && r.rNet !== null) todayResultMoney += r.rNet * r.risk;
    }
  }
  return { todayResultMoney, approvedToday, openApproved };
}

export interface Ticket extends RiskCheck {
  account: Pick<Account, "balance" | "currency" | "riskPerTradePct">;
  order: string;
  approved: typeof tradeTicketsTable.$inferSelect | null;
}

export async function buildTicket(s: DbSignal, nowS: number): Promise<Ticket> {
  const [account, today, [approved]] = await Promise.all([
    getAccount(),
    todayFigures(nowS),
    db.select().from(tradeTicketsTable).where(eq(tradeTicketsTable.signalId, s.id)),
  ]);
  const direction = s.direction === "long" ? 1 : -1;
  const check = riskCheck({ direction, entry: s.entryRef, sl: s.sl, tp2: s.tp2, validUntil: s.validUntil, now: nowS, ...today }, account);
  const cur = account.currency === "INR" ? "₹" : "$";
  const order =
    `${s.direction === "long" ? "BUY" : "SELL"} ${check.sizing.lots} lots ${s.symbol} at market (≈ ${s.entryRef.toFixed(2)}). ` +
    `Stop ${s.sl.toFixed(2)}. Take half at ${s.tp1.toFixed(2)} and move the stop to entry; rest at ${s.tp2.toFixed(2)}. ` +
    `Risk ${cur}${check.sizing.riskMoney.toFixed(2)} (${check.sizing.riskPct.toFixed(2)}% of ${cur}${account.balance.toFixed(0)}).`;
  return { ...check, account: { balance: account.balance, currency: account.currency, riskPerTradePct: account.riskPerTradePct }, order, approved: approved ?? null };
}

// ---------------------------------------------------------------- time machine
const nyHour = new Map<number, { date: string; minute: number }>();
const nyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** New York calendar date and minute of day, cached per UTC hour (offsets are whole hours). */
function ny(t: number): { date: string; minute: number } {
  const h = Math.floor(t / 3600);
  let hit = nyHour.get(h);
  if (!hit) {
    const parts = Object.fromEntries(nyFmt.formatToParts(new Date(h * 3600 * 1000)).map((p) => [p.type, p.value]));
    hit = { date: `${parts["year"]}-${parts["month"]}-${parts["day"]}`, minute: Number(parts["hour"]) * 60 + Number(parts["minute"]) };
    nyHour.set(h, hit);
  }
  return { date: hit.date, minute: hit.minute + Math.floor((t % 3600) / 60) };
}

const oddsCache = new Map<number, TmResult & { sessions: number }>();
export const TM_STEPS = 48; // 4 hours of M5 candles = the signals' time limit
export const TM_SESSIONS = 59;

export async function signalOdds(s: DbSignal): Promise<(TmResult & { sessions: number }) | null> {
  const hit = oddsCache.get(s.id);
  if (hit) return hit;
  const rows = await db
    .select({ t: candlesTable.t, o: candlesTable.o, h: candlesTable.h, l: candlesTable.l, c: candlesTable.c })
    .from(candlesTable)
    .where(and(eq(candlesTable.symbol, s.symbol), gte(candlesTable.t, s.t - 90 * DAY), lt(candlesTable.t, s.t)))
    .orderBy(asc(candlesTable.t));
  // M5 shapes keyed by New York date and minute of day. Only history before the signal is used.
  const signalDate = ny(s.t).date;
  const byDate = new Map<string, Map<number, { o: number; h: number; l: number; c: number }>>();
  for (const r of rows) {
    const { date, minute } = ny(r.t);
    if (date >= signalDate) continue;
    const slot = minute - (minute % 5);
    const day = byDate.get(date) ?? new Map();
    const cur = day.get(slot);
    if (!cur) day.set(slot, { o: r.o, h: r.h, l: r.l, c: r.c });
    else {
      cur.h = Math.max(cur.h, r.h);
      cur.l = Math.min(cur.l, r.l);
      cur.c = r.c;
    }
    byDate.set(date, day);
  }
  const dates = [...byDate.keys()].sort().slice(-TM_SESSIONS);
  if (dates.length < 10) return null;
  const startMinute = ny(s.t).minute - (ny(s.t).minute % 5);
  const shape = (b: { o: number; h: number; l: number; c: number }): ShapeCandle => ({ dh: b.h / b.o - 1, dl: b.l / b.o - 1, dc: b.c / b.o - 1 });
  const slots: ShapeCandle[][] = [];
  for (let k = 0; k < TM_STEPS; k++) {
    const m = (startMinute + 5 * k) % 1440;
    slots.push(dates.map((d) => byDate.get(d)!.get(m)).filter((b): b is NonNullable<typeof b> => Boolean(b)).map(shape));
  }
  const analogs = dates.map((d) => {
    const day = byDate.get(d)!;
    const seq: ShapeCandle[] = [];
    for (let k = 0; k < TM_STEPS; k++) {
      const b = day.get((startMinute + 5 * k) % 1440);
      if (b) seq.push(shape(b));
    }
    return seq;
  }).filter((seq) => seq.length >= TM_STEPS / 2);
  const [cfg] = await db.select({ params: strategyConfigsTable.params }).from(strategyConfigsTable).where(eq(strategyConfigsTable.id, s.configId));
  const tp1Fraction = Number((cfg?.params as { tp1Fraction?: number } | undefined)?.tp1Fraction ?? 0.5);
  const res = timeMachine(
    { direction: s.direction === "long" ? 1 : -1, entry: s.entryRef, sl: s.sl, tp1: s.tp1, tp2: s.tp2, tp1Fraction },
    slots,
    analogs,
    10_000,
    s.id,
  );
  const out = { ...res, sessions: dates.length };
  if (oddsCache.size > 500) oddsCache.clear();
  oddsCache.set(s.id, out);
  return out;
}

// ---------------------------------------------------------------- approval
export type ApproveResult =
  | { ok: true; ticket: typeof tradeTicketsTable.$inferSelect }
  | { ok: false; status: number; error: string; failed?: string[] };

/**
 * Records a trade the operator approved by typing YES. Every risk check must pass, and a
 * signal can be approved once. Nothing is sent to a broker: MT5 execution is Phase 10.
 */
export async function approveTicket(s: DbSignal, actor: string, via: "dashboard" | "telegram", nowS: number): Promise<ApproveResult> {
  const t = await buildTicket(s, nowS);
  if (t.approved) return { ok: false, status: 409, error: "This signal was already approved." };
  if (!t.pass) {
    const failed = t.checks.filter((c) => !c.pass);
    return { ok: false, status: 409, error: `Blocked by the risk check: ${failed.map((c) => c.label).join(", ")}.`, failed: failed.map((c) => c.detail) };
  }
  const odds = await signalOdds(s).catch(() => null);
  const [ticket] = await db
    .insert(tradeTicketsTable)
    .values({
      signalId: s.id,
      status: "approved",
      direction: s.direction,
      lots: t.sizing.lots,
      entry: s.entryRef,
      sl: s.sl,
      tp1: s.tp1,
      tp2: s.tp2,
      riskMoney: t.sizing.riskMoney,
      currency: t.account.currency,
      checks: t.checks as unknown as Record<string, unknown>[],
      odds: odds ? { simulated: odds.simulated, simExpectedR: odds.simExpectedR, analog: odds.analog, sessions: odds.sessions } : null,
      approvedBy: actor,
      via,
      approvedT: nowS,
    })
    .onConflictDoNothing()
    .returning();
  if (!ticket) return { ok: false, status: 409, error: "This signal was already approved." };
  return { ok: true, ticket };
}
