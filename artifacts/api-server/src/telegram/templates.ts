import type { DbSignal, DbSignalEvent } from "@workspace/db";

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
