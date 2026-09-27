import { hhmmToMinutes, type Session } from "./params";

/** Session and calendar helpers. All timestamps are UTC epoch seconds. Mirrors xausig/timeutil.py. */

export const DAY = 86_400;
export const FRIDAY = 4; // Monday = 0, like Python's datetime.weekday()

const WEEKDAY: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function localWeekdayMinutes(t: number, tz: string): [number, number] {
  let weekday = 0;
  let hour = 0;
  let minute = 0;
  for (const part of formatter(tz).formatToParts(new Date(t * 1000))) {
    if (part.type === "weekday") weekday = WEEKDAY[part.value] ?? 0;
    else if (part.type === "hour") hour = Number(part.value);
    else if (part.type === "minute") minute = Number(part.value);
  }
  return [weekday, hour * 60 + minute];
}

export function inSessions(t: number, sessions: readonly Session[]): boolean {
  for (const s of sessions) {
    const [weekday, minutes] = localWeekdayMinutes(t, s.tz);
    if (weekday < 5 && hhmmToMinutes(s.start) <= minutes && minutes < hhmmToMinutes(s.end)) return true;
  }
  return false;
}

export function utcWeekday(t: number): number {
  // 1970-01-01 was a Thursday (weekday 3).
  return (Math.floor(t / DAY) + 3) % 7;
}

export function utcMinuteOfDay(t: number): number {
  return Math.floor((t % DAY) / 60);
}

export function afterFridayCutoff(t: number, cutoffHHMM: string): boolean {
  return utcWeekday(t) === FRIDAY && utcMinuteOfDay(t) >= hhmmToMinutes(cutoffHHMM);
}

export function fridayExitFor(t: number, exitHHMM: string): number | null {
  if (utcWeekday(t) !== FRIDAY) return null;
  return Math.floor(t / DAY) * DAY + hhmmToMinutes(exitHHMM) * 60;
}

export function isoUtc(t: number): string {
  return new Date(t * 1000).toISOString().replace(".000Z", "Z");
}
