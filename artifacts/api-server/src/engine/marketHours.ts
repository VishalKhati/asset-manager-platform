import { localWeekdayMinutes } from "@workspace/strategy";

/**
 * Spot gold trading hours, in New York time: Sunday 18:00 to Friday 17:00, with a daily
 * break from 17:00 to 18:00. Exchange holidays are not modelled; the feed watchdog may
 * raise one false alarm on those days.
 */
export function goldMarketOpen(t: number): boolean {
  const [weekday, minutes] = localWeekdayMinutes(t, "America/New_York");
  const OPEN = 18 * 60;
  const CLOSE = 17 * 60;
  if (weekday === 5) return false; // Saturday
  if (weekday === 6) return minutes >= OPEN; // Sunday evening
  if (weekday === 4 && minutes >= CLOSE) return false; // Friday after close
  return !(minutes >= CLOSE && minutes < OPEN); // daily break
}
