import { pgTable, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const notificationSettingsTable = pgTable("notification_settings", {
  userId:          text("user_id").primaryKey(),
  telegramToken:   text("telegram_token"),
  telegramChatId:  text("telegram_chat_id"),
  telegramEnabled: boolean("telegram_enabled").notNull().default(false),
  emailTo:         text("email_to"),
  smtpHost:        text("smtp_host"),
  smtpPort:        integer("smtp_port").notNull().default(587),
  smtpUser:        text("smtp_user"),
  smtpPass:        text("smtp_pass"),
  emailEnabled:    boolean("email_enabled").notNull().default(false),
  events:          text("events").array().notNull().default(["signal", "trade_opened", "trade_closed"]),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
});

export type DbNotificationSettings = typeof notificationSettingsTable.$inferSelect;
