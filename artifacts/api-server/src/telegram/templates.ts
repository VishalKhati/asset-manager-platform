import type { DbSignal, DbSignalEvent } from "@workspace/db";
import type { TmResult } from "@workspace/strategy";
import type { Ticket } from "../services/tradeTools.js";

/** Telegram message bodies (HTML parse mode). Everything user-visible is escaped. */

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const px = (x: number | null | undefined) => (x === null || x === undefined ? "—" : x.toFixed(2));
const hhmm = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);
const signedR = (r: number) => `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`;

export function statusLine(s: DbSignal): string {
  switch (s.state) {
    case "pending":
      return "⏳ Waiting for entry";
    case "active":
      return `▶️ Entered at ${px(s.fill)}`;
    case "be":
      return `✅ TP1 hit, stop moved to entry (${px(s.slCurrent)})`;
    case "expired":
      return "⌛ Expired: price moved away before entry";
    case "closed": {
      const r = s.rNet ?? 0;
      const label =
        s.outcome === "tp2" ? "🏁 TP2 hit" : s.outcome === "tp1_be" ? "✅ TP1 hit, rest closed at entry" : s.outcome === "sl" ? "❌ Stopped out" : "⏱ Closed on time limit";
      return `${label} · ${signedR(r)}`;
    }
    default:
      return s.state;
  }
}

const EVENT_TEXT: Record<string, string> = {
  filled: "entered",
  tp1: "TP1 hit, stop to entry",
  tp2: "TP2 hit",
  sl: "stopped out",
  tp1_be: "closed at entry",
  time_exit: "closed on time limit",
  expired: "expired unfilled",
};

export function renderSignal(s: DbSignal, events: DbSignalEvent[], opts: { tp1Fraction: number; siteUrl?: string }): string {
  const long = s.direction === "long";
  const risk = Math.abs(s.entryRef - s.sl);
  const partial = opts.tp1Fraction > 0 ? `close ${Math.round(opts.tp1Fraction * 100)}%, ` : "";
  const lines = [
    `${long ? "🟢" : "🔴"} <b>${esc(s.symbol)} ${long ? "BUY" : "SELL"}</b> · #${esc(s.publicNo)}`,
    `M5 entry · M15 trend ${long ? "up" : "down"}`,
    "",
    `<code>Entry ${px(s.entryRef)}</code>`,
    `<code>SL    ${px(s.sl)}</code>  (−1R, ${risk.toFixed(2)})`,
    `<code>TP1   ${px(s.tp1)}</code>  (+1R, ${partial}stop to entry)`,
    `<code>TP2   ${px(s.tp2)}</code>  (+2R)`,
    `Valid until ${hhmm(s.validUntil)} UTC`,
    "",
    `<b>Status:</b> ${esc(statusLine(s))}`,
  ];
  const timeline = events.filter((e) => e.type in EVENT_TEXT);
  if (timeline.length) {
    lines.push(...timeline.map((e) => `• ${hhmm(e.t)} ${EVENT_TEXT[e.type]}${e.type === "expired" ? "" : ` @ ${px(e.price)}`}`));
  }
  lines.push("", `<i>${esc(s.strategyId)} v${s.strategyVersion} · Educational, not financial advice.</i>`);
  if (opts.siteUrl) lines.push(`<a href="${esc(opts.siteUrl)}/signals/${esc(s.publicNo)}">Chart and track record</a>`);
  return lines.join("\n");
}

export function renderUpdate(s: DbSignal, event: string): string {
  const base = `#${esc(s.publicNo)} ${s.direction === "long" ? "BUY" : "SELL"}: `;
  switch (event) {
    case "tp1":
      return `${base}✅ TP1 hit at ${px(s.tp1)}. Stop moved to entry.`;
    case "tp2":
      return `${base}🏁 TP2 hit at ${px(s.tp2)}. Result ${signedR(s.rNet ?? 0)}.`;
    case "sl":
      return `${base}❌ Stopped out. Result ${signedR(s.rNet ?? 0)}.`;
    case "tp1_be":
      return `${base}Closed at entry after TP1. Result ${signedR(s.rNet ?? 0)}.`;
    case "time_exit":
      return `${base}⏱ Closed on the time limit. Result ${signedR(s.rNet ?? 0)}.`;
    case "expired":
      return `${base}⌛ Expired: price moved away before entry. No trade.`;
    default:
      return `${base}${esc(event)}`;
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Private admin message: the exact order, its size, the PASS/BLOCK checks and the odds. */
export function renderTicket(s: DbSignal, t: Ticket, odds: (TmResult & { sessions: number }) | null): string {
  const lines = [
    `🎫 <b>Ticket #${esc(s.publicNo)}</b> · ${s.direction === "long" ? "BUY" : "SELL"} ${esc(s.symbol)}`,
    esc(t.order),
    "",
    `<b>Risk check: ${t.pass ? "PASS" : "BLOCK"}</b>`,
    ...t.checks.map((c) => `${c.pass ? "✅" : "❌"} ${esc(c.label)}: ${esc(c.detail)}`),
  ];
  if (odds) {
    const sim = odds.simulated;
    lines.push(
      "",
      `<b>Odds</b> (${odds.paths.toLocaleString("en-US")} replays of the next 4 h from the last ${odds.sessions} sessions):`,
      `TP2 ${pct(sim.tp2)} · TP1 then entry ${pct(sim.tp1_be)} · stop ${pct(sim.sl)} · time limit ${pct(sim.time)} · average ${odds.simExpectedR >= 0 ? "+" : ""}${odds.simExpectedR.toFixed(2)}R before costs`,
      `Same time on ${odds.analog.days} real days: TP2 ${odds.analog.tp2} · TP1/entry ${odds.analog.tp1_be} · stop ${odds.analog.sl} · time ${odds.analog.time}`,
      "<i>Odds measure risk, not edge.</i>",
    );
  }
  lines.push(
    "",
    t.pass
      ? `To approve this exact order reply <code>/yes ${esc(s.publicNo)}</code> before ${hhmm(s.validUntil)} UTC. Nothing is sent to MT5: place it yourself.`
      : "Blocked: do not take this trade.",
  );
  return lines.join("\n");
}
