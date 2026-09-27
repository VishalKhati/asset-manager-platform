/**
 * Server-sent events. One Postgres LISTEN connection per API process fans signal events
 * out to every connected browser. Event ids are signal_events ids, so a reconnecting
 * client sends Last-Event-ID and receives what it missed.
 */

import type { Request, Response } from "express";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { db, pool, signalEventsTable, signalsTable } from "@workspace/db";
import type { Logger } from "pino";
import { metrics } from "../lib/metrics.js";
import { toView } from "../services/signals.js";

interface Client {
  res: Response;
  publicOnly: boolean;
}

export interface StreamOptions {
  symbol: string;
  modes: string[];
  publicDelayMin: number;
}

export class SseHub {
  private clients = new Set<Client>();
  private listener: import("pg").PoolClient | null = null;
  private ping: NodeJS.Timeout | null = null;

  constructor(
    private readonly o: StreamOptions,
    private readonly log: Logger,
  ) {}

  async start(): Promise<void> {
    this.listener = await pool.connect();
    await this.listener.query("LISTEN signal_event");
    this.listener.on("notification", (msg) => {
      try {
        const { signalId } = JSON.parse(msg.payload ?? "{}") as { signalId?: number };
        if (signalId) void this.broadcast(signalId);
      } catch (err) {
        this.log.warn({ err }, "bad signal_event payload");
      }
    });
    this.listener.on("error", (err) => this.log.error({ err }, "SSE listener error"));
    this.ping = setInterval(() => {
      for (const c of this.clients) c.res.write(": ping\n\n");
    }, 15_000);
    this.ping.unref();
  }

  async stop(): Promise<void> {
    if (this.ping) clearInterval(this.ping);
    for (const c of this.clients) c.res.end();
    this.clients.clear();
    this.listener?.release();
    this.listener = null;
  }

  private visible(s: typeof signalsTable.$inferSelect, publicOnly: boolean): boolean {
    if (!this.o.modes.includes(s.mode)) return publicOnly ? false : true;
    if (!publicOnly) return true;
    if (!s.published) return false;
    const open = s.state === "pending" || s.state === "active" || s.state === "be";
    return !open || s.t <= Date.now() / 1000 - this.o.publicDelayMin * 60;
  }

  private async broadcast(signalId: number): Promise<void> {
    const [s] = await db.select().from(signalsTable).where(eq(signalsTable.id, signalId));
    if (!s || s.symbol !== this.o.symbol) return;
    const events = await db.select().from(signalEventsTable).where(eq(signalEventsTable.signalId, signalId)).orderBy(asc(signalEventsTable.id));
    const lastId = events[events.length - 1]?.id ?? 0;
    const data = JSON.stringify(toView(s, events));
    for (const c of this.clients) {
      if (this.visible(s, c.publicOnly)) c.res.write(`id: ${lastId}\nevent: signal\ndata: ${data}\n\n`);
    }
  }

  /** Express handler. `publicOnly` hides unpublished and (optionally) fresh open signals. */
  handler(publicOnly: boolean) {
    return async (req: Request, res: Response) => {
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      res.write("retry: 5000\n\n");

      const client: Client = { res, publicOnly };
      // Replay anything missed since Last-Event-ID (bounded).
      const since = Number(req.headers["last-event-id"] ?? 0);
      if (since > 0) {
        const missed = await db
          .selectDistinct({ signalId: signalEventsTable.signalId })
          .from(signalEventsTable)
          .where(gt(signalEventsTable.id, since))
          .limit(50);
        const ids = missed.map((m) => m.signalId);
        if (ids.length) {
          const rows = await db.select().from(signalsTable).where(and(inArray(signalsTable.id, ids), eq(signalsTable.symbol, this.o.symbol)));
          for (const s of rows) {
            if (!this.visible(s, publicOnly)) continue;
            const events = await db.select().from(signalEventsTable).where(eq(signalEventsTable.signalId, s.id)).orderBy(asc(signalEventsTable.id));
            res.write(`id: ${events[events.length - 1]?.id ?? since}\nevent: signal\ndata: ${JSON.stringify(toView(s, events))}\n\n`);
          }
        }
      }
      this.clients.add(client);
      metrics.sseClients.set(this.clients.size);
      req.on("close", () => {
        this.clients.delete(client);
        metrics.sseClients.set(this.clients.size);
      });
    };
  }
}
