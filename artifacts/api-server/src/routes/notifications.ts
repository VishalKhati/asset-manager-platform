/**
 * Notification settings routes.
 *
 * GET  /api/notifications          — get current user's settings (no secrets in response)
 * PUT  /api/notifications          — save settings
 * POST /api/notifications/test     — send a test message via enabled channels
 */

import { Router }       from "express";
import { db }           from "@workspace/db";
import { notificationSettingsTable } from "@workspace/db/schema";
import { eq }           from "drizzle-orm";
import { requireAuth }  from "../middlewares/auth.js";
import { invalidateCache, notifyUser } from "../lib/notificationService.js";

const router = Router();
router.use(requireAuth);

const ALL_EVENTS = ["signal", "trade_opened", "trade_closed", "bot_started", "bot_stopped", "user.login"];

// ─── GET /api/notifications ───────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(notificationSettingsTable)
      .where(eq(notificationSettingsTable.userId, req.userId));

    if (!row) {
      res.json({
        ok: true, settings: {
          telegramEnabled: false, telegramToken: "", telegramChatId: "",
          emailEnabled: false, emailTo: "", smtpHost: "", smtpPort: 587, smtpUser: "", smtpPass: "",
          events: ["signal", "trade_opened", "trade_closed"],
        },
      });
      return;
    }

    // Never expose raw SMTP password or Telegram token — return masked versions
    res.json({
      ok: true,
      settings: {
        telegramEnabled: row.telegramEnabled,
        telegramToken:   row.telegramToken   ? "••••" + row.telegramToken.slice(-6)   : "",
        telegramChatId:  row.telegramChatId  ?? "",
        emailEnabled:    row.emailEnabled,
        emailTo:         row.emailTo         ?? "",
        smtpHost:        row.smtpHost        ?? "",
        smtpPort:        row.smtpPort        ?? 587,
        smtpUser:        row.smtpUser        ?? "",
        smtpPass:        row.smtpPass        ? "••••••••" : "",
        events:          (row.events as string[]) ?? [],
        hasTelegramToken: !!row.telegramToken,
        hasSmtpPass:      !!row.smtpPass,
      },
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to load settings." });
  }
});

// ─── PUT /api/notifications ───────────────────────────────────────────────────

router.put("/", async (req, res) => {
  const {
    telegramEnabled, telegramToken, telegramChatId,
    emailEnabled, emailTo, smtpHost, smtpPort, smtpUser, smtpPass,
    events,
  } = req.body ?? {};

  const validEvents = Array.isArray(events)
    ? events.filter((e: unknown) => typeof e === "string" && ALL_EVENTS.includes(e))
    : ["signal", "trade_opened", "trade_closed"];

  try {
    // Fetch existing row so we can preserve secrets when the masked placeholder is sent back
    const [existing] = await db
      .select()
      .from(notificationSettingsTable)
      .where(eq(notificationSettingsTable.userId, req.userId));

    const resolvedToken   = (telegramToken && !telegramToken.startsWith("••••")) ? telegramToken : (existing?.telegramToken ?? null);
    const resolvedSmtpPass = (smtpPass && !smtpPass.startsWith("••••"))          ? smtpPass       : (existing?.smtpPass     ?? null);

    await db
      .insert(notificationSettingsTable)
      .values({
        userId:          req.userId,
        telegramEnabled: Boolean(telegramEnabled),
        telegramToken:   resolvedToken,
        telegramChatId:  telegramChatId  || null,
        emailEnabled:    Boolean(emailEnabled),
        emailTo:         emailTo         || null,
        smtpHost:        smtpHost        || null,
        smtpPort:        Number(smtpPort ?? 587),
        smtpUser:        smtpUser        || null,
        smtpPass:        resolvedSmtpPass,
        events:          validEvents,
        updatedAt:       new Date(),
      })
      .onConflictDoUpdate({
        target: notificationSettingsTable.userId,
        set: {
          telegramEnabled: Boolean(telegramEnabled),
          telegramToken:   resolvedToken,
          telegramChatId:  telegramChatId  || null,
          emailEnabled:    Boolean(emailEnabled),
          emailTo:         emailTo         || null,
          smtpHost:        smtpHost        || null,
          smtpPort:        Number(smtpPort ?? 587),
          smtpUser:        smtpUser        || null,
          smtpPass:        resolvedSmtpPass,
          events:          validEvents,
          updatedAt:       new Date(),
        },
      });

    invalidateCache(req.userId);
    res.json({ ok: true, message: "Settings saved." });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to save settings." });
  }
});

// ─── POST /api/notifications/test ────────────────────────────────────────────

router.post("/test", async (req, res) => {
  try {
    await notifyUser(req.userId, "signal", {
      symbol:  "XAUUSD",
      price:   2345.50,
      signal:  { signal: "BUY", confidence: 0.87, agreeing: ["FairValueGap", "LiquiditySweep"] },
    });
    res.json({ ok: true, message: "Test notification sent. Check your Telegram / email." });
  } catch {
    res.status(500).json({ ok: false, error: "Test failed." });
  }
});

export default router;
