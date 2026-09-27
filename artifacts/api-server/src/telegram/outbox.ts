/**
 * Delivers queued Telegram messages. Runs only in the engine leader.
 *
 * - signal_new:    post the signal to each target chat and remember the message ids
 * - signal_update: edit every posted copy in place, then reply with a short update
 *                  (edits don't notify subscribers; replies do)
 * - admin:         direct message to every admin id
 * Failures back off exponentially; after 8 attempts the row is marked failed.
 */

import { and, asc, count, eq, lte } from "drizzle-orm";
import { db, notificationOutboxTable, signalEventsTable, signalsTable, strategyConfigsTable, type DbOutbox } from "@workspace/db";
import type { Logger } from "pino";
import { metrics } from "../lib/metrics.js";
import { renderSignal, renderUpdate } from "./templates.js";

export interface TelegramApi {
  sendMessage(chatId: string, text: string, replyTo?: number): Promise<{ message_id: number }>;
  editMessageText(chatId: string, messageId: number, text: string): Promise<void>;
}

export interface OutboxOptions {
  api: TelegramApi | null;
  /** Chats that receive signals for the running mode. */
  signalChats: string[];
  adminChats: string[];
  siteUrl?: string;
  log: Logger;
  maxAttempts?: number;
}

export class OutboxDispatcher {
  constructor(private readonly o: OutboxOptions) {}

  async runOnce(limit = 20): Promise<number> {
    const due = await db
      .select()
      .from(notificationOutboxTable)
      .where(and(eq(notificationOutboxTable.status, "pending"), lte(notificationOutboxTable.nextAttemptAt, new Date())))
      .orderBy(asc(notificationOutboxTable.id))
      .limit(limit);
    for (const row of due) await this.deliver(row);
    const [pending] = await db.select({ n: count() }).from(notificationOutboxTable).where(eq(notificationOutboxTable.status, "pending"));
    metrics.outboxPending.set(pending?.n ?? 0);
    return due.length;
  }

  private async deliver(row: DbOutbox): Promise<void> {
    if (!this.o.api) {
      await db.update(notificationOutboxTable).set({ status: "skipped", lastError: "Telegram not configured" }).where(eq(notificationOutboxTable.id, row.id));
      return;
    }
    try {
      if (row.kind === "admin") await this.sendAdmin(String(row.payload["text"] ?? ""));
      else if (row.kind === "signal_new") await this.sendNew(row.signalId!);
      else if (row.kind === "signal_update") await this.sendUpdate(row.signalId!, String(row.payload["event"] ?? ""));
      else throw new Error(`unknown outbox kind ${row.kind}`);
      await db.update(notificationOutboxTable).set({ status: "sent", sentAt: new Date(), attempts: row.attempts + 1, lastError: null }).where(eq(notificationOutboxTable.id, row.id));
    } catch (err) {
      metrics.telegramErrors.inc();
      const attempts = row.attempts + 1;
      const failed = attempts >= (this.o.maxAttempts ?? 8);
      const delayMs = Math.min(2 ** attempts * 5_000, 10 * 60_000);
      this.o.log.warn({ err, outboxId: row.id, attempts }, "telegram delivery failed");
      await db
        .update(notificationOutboxTable)
        .set({ status: failed ? "failed" : "pending", attempts, lastError: String(err).slice(0, 500), nextAttemptAt: new Date(Date.now() + delayMs) })
        .where(eq(notificationOutboxTable.id, row.id));
    }
  }

  private async load(signalId: number) {
    const [signal] = await db.select().from(signalsTable).where(eq(signalsTable.id, signalId));
    if (!signal) throw new Error(`signal ${signalId} not found`);
    const events = await db.select().from(signalEventsTable).where(eq(signalEventsTable.signalId, signalId)).orderBy(asc(signalEventsTable.id));
    const [cfg] = await db.select({ params: strategyConfigsTable.params }).from(strategyConfigsTable).where(eq(strategyConfigsTable.id, signal.configId));
    const tp1Fraction = Number((cfg?.params as { tp1Fraction?: number } | undefined)?.tp1Fraction ?? 0.5);
    return { signal, events, tp1Fraction };
  }

  private async sendNew(signalId: number): Promise<void> {
    const { signal, events, tp1Fraction } = await this.load(signalId);
    const text = renderSignal(signal, events, { tp1Fraction, siteUrl: this.o.siteUrl });
    const posted = { ...(signal.telegramMessages ?? {}) };
    for (const chat of this.o.signalChats) {
      if (posted[chat]) continue; // already delivered on an earlier attempt
      const msg = await this.o.api!.sendMessage(chat, text);
      posted[chat] = msg.message_id;
      await db.update(signalsTable).set({ telegramMessages: posted }).where(eq(signalsTable.id, signalId));
    }
  }

  private async sendUpdate(signalId: number, event: string): Promise<void> {
    const { signal, events, tp1Fraction } = await this.load(signalId);
    const text = renderSignal(signal, events, { tp1Fraction, siteUrl: this.o.siteUrl });
    for (const [chat, messageId] of Object.entries(signal.telegramMessages ?? {})) {
      await this.o.api!.editMessageText(chat, messageId, text);
      await this.o.api!.sendMessage(chat, renderUpdate(signal, event), messageId);
    }
  }

  private async sendAdmin(text: string): Promise<void> {
    for (const chat of this.o.adminChats) await this.o.api!.sendMessage(chat, text);
  }
}

/** Queue a direct message to the admins. */
export async function queueAdmin(text: string): Promise<void> {
  await db.insert(notificationOutboxTable).values({ kind: "admin", payload: { text } });
}
