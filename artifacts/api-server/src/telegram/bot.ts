/**
 * grammY bot: the Telegram API client used by the outbox, plus admin commands
 * (private chat only, from ids listed in TG_ADMIN_IDS). Long polling, so no inbound port.
 */

import { Api, Bot, GrammyError } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import type { Logger } from "pino";
import type { TelegramApi } from "./outbox.js";

export interface CommandHandlers {
  pause(actor: string, reason: string): Promise<string>;
  resume(actor: string): Promise<string>;
  stats(period: string): Promise<string>;
  health(): Promise<string>;
  last(): Promise<string>;
  mode(): Promise<string>;
}

export function telegramApi(token: string): TelegramApi {
  const api = new Api(token);
  api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));
  return {
    async sendMessage(chatId, text, replyTo) {
      const msg = await api.sendMessage(chatId, text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
      });
      return { message_id: msg.message_id };
    },
    async editMessageText(chatId, messageId, text) {
      try {
        await api.editMessageText(chatId, messageId, text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
      } catch (err) {
        // Editing to identical text is not an error for us.
        if (err instanceof GrammyError && err.description.includes("message is not modified")) return;
        throw err;
      }
    },
  };
}

export function startCommandBot(token: string, adminIds: string[], handlers: CommandHandlers, log: Logger): Bot {
  const bot = new Bot(token);
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));
  const admins = new Set(adminIds);

  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private" || !ctx.from || !admins.has(String(ctx.from.id))) return; // ignore everyone else
    await next();
  });

  const reply = (text: string) => ({ parse_mode: "HTML" as const, link_preview_options: { is_disabled: true }, text });
  const actor = (id: number) => `telegram:${id}`;

  bot.command("pause", async (ctx) => {
    const r = reply(await handlers.pause(actor(ctx.from!.id), ctx.match || "paused from Telegram"));
    await ctx.reply(r.text, r);
  });
  bot.command("resume", async (ctx) => {
    const r = reply(await handlers.resume(actor(ctx.from!.id)));
    await ctx.reply(r.text, r);
  });
  bot.command("stats", async (ctx) => {
    const r = reply(await handlers.stats(ctx.match || "30d"));
    await ctx.reply(r.text, r);
  });
  bot.command("health", async (ctx) => {
    const r = reply(await handlers.health());
    await ctx.reply(r.text, r);
  });
  bot.command("last", async (ctx) => {
    const r = reply(await handlers.last());
    await ctx.reply(r.text, r);
  });
  bot.command("mode", async (ctx) => {
    const r = reply(await handlers.mode());
    await ctx.reply(r.text, r);
  });
  bot.command(["start", "help"], async (ctx) => {
    await ctx.reply("/pause [reason] · /resume · /stats [7d|30d|all] · /health · /last · /mode");
  });
  bot.catch((err) => log.warn({ err: err.error }, "telegram command failed"));

  const commands = [
    { command: "pause", description: "Stop new signals" },
    { command: "resume", description: "Resume signals" },
    { command: "stats", description: "Track record (7d, 30d, all)" },
    { command: "health", description: "Feed, engine and queue status" },
    { command: "last", description: "Last 5 signals" },
    { command: "mode", description: "Publishing mode" },
  ];
  for (const id of adminIds) {
    bot.api.setMyCommands(commands, { scope: { type: "chat", chat_id: Number(id) } }).catch((err) => log.warn({ err }, "setMyCommands failed"));
  }
  bot.start({ drop_pending_updates: true, onStart: () => log.info("telegram command bot started") }).catch((err) => log.error({ err }, "telegram bot stopped"));
  return bot;
}
