import { pgTable, serial, text, timestamp, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const telegramSessions = pgTable("telegram_sessions", {
  id: serial("id").primaryKey(),
  chatId: bigint("chat_id", { mode: "number" }).notNull().unique(),
  username: text("username"),
  firstName: text("first_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).defaultNow().notNull(),
});

export const telegramMessages = pgTable("telegram_messages", {
  id: serial("id").primaryKey(),
  chatId: bigint("chat_id", { mode: "number" }).notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertTelegramSessionSchema = createInsertSchema(telegramSessions).omit({
  id: true,
  createdAt: true,
  lastMessageAt: true,
});

export const insertTelegramMessageSchema = createInsertSchema(telegramMessages).omit({
  id: true,
  createdAt: true,
});

export type TelegramSession = typeof telegramSessions.$inferSelect;
export type InsertTelegramSession = z.infer<typeof insertTelegramSessionSchema>;
export type TelegramMessage = typeof telegramMessages.$inferSelect;
export type InsertTelegramMessage = z.infer<typeof insertTelegramMessageSchema>;
