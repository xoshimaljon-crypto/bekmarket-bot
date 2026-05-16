import { Router } from "express";
import TelegramBot from "node-telegram-bot-api";
import { openai } from "@workspace/integrations-openai-ai-server";
import { db } from "@workspace/db";
import { telegramSessions, telegramMessages } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { KNOWLEDGE_BASE } from "../knowledge-base.js";
import { logger } from "../lib/logger.js";

const router = Router();

if (!process.env.TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable is required");
}

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

const SYSTEM_PROMPT = `Siz Bek Market kompaniyasining xodimlariga yordam beradigan AI yordamchisisiz. Sizning vazifangiz - xodimlarga kompaniya qoidalari, ichki nizomlar, HR moslashuvi (adaptatsiya) va ish ko'rsatmalari bo'yicha savollarga javob berishdir.

Quyida kompaniyaning bilimlar bazasi keltirilgan:

${KNOWLEDGE_BASE}

Muhim qoidalar:
1. Faqat o'zbek tilida javob bering
2. Faqat bilimlar bazasidagi ma'lumotlarga asoslanib javob bering
3. Bilimlar bazasida topilmagan ma'lumot so'ralsa, "Bu haqda aniq ma'lumotim yo'q. HR bo'limiga yoki bevosita rahbaringizga murojaat qiling." deb javob bering
4. Xodimga hurmat bilan murojaat qiling
5. Javoblaringizni aniq, qisqa va tushunarli qiling
6. Kerak bo'lsa, xodimni tegishli bo'limga yo'llang
7. Emoji ishlata olmaysiz`;

async function getOrCreateSession(chatId: number, username?: string, firstName?: string) {
  await db
    .insert(telegramSessions)
    .values({ chatId, username, firstName })
    .onConflictDoUpdate({
      target: telegramSessions.chatId,
      set: { lastMessageAt: new Date(), username, firstName },
    });

  const [session] = await db
    .select()
    .from(telegramSessions)
    .where(eq(telegramSessions.chatId, chatId))
    .limit(1);

  return session;
}

async function getChatHistory(chatId: number) {
  const messages = await db
    .select()
    .from(telegramMessages)
    .where(eq(telegramMessages.chatId, chatId))
    .orderBy(desc(telegramMessages.createdAt))
    .limit(10);

  return messages.reverse();
}

async function saveMessage(chatId: number, role: "user" | "assistant", content: string) {
  await db.insert(telegramMessages).values({ chatId, role, content });
}

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from?.first_name;

  await getOrCreateSession(chatId, msg.from?.username, firstName);

  const welcomeMessage = `Assalomu alaykum${firstName ? `, ${firstName}` : ""}!

Men Bek Market korporativ yordamchi botiman. Quyidagi mavzular bo'yicha savollaringizga javob bera olaman:

- Kompaniya qoidalari va nizomlar
- Ish vaqti va tartib-intizom
- HR va moslashuv (adaptatsiya)
- Maosh va to'lovlar
- Ta'til va dam olish
- Kiyim talablari (Dress Code)
- Karyera rivojlanish

Savolingizni yozing, men javob beraman!`;

  await bot.sendMessage(chatId, welcomeMessage);
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  const helpText = `Quyidagi mavzular bo'yicha savol berishingiz mumkin:

/start - Botni qayta ishga tushirish
/help - Yordam
/reset - Suhbat tarixini tozalash

Har qanday savolingizni oddiygina yozing, men javob beraman.`;
  await bot.sendMessage(chatId, helpText);
});

bot.onText(/\/reset/, async (msg) => {
  const chatId = msg.chat.id;
  await db.delete(telegramMessages).where(eq(telegramMessages.chatId, chatId));
  await bot.sendMessage(chatId, "Suhbat tarixi tozalandi. Yangi savol bering!");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  try {
    await bot.sendChatAction(chatId, "typing");

    await getOrCreateSession(chatId, msg.from?.username, msg.from?.first_name);
    await saveMessage(chatId, "user", text);

    const history = await getChatHistory(chatId);

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.slice(0, -1).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: text },
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 1024,
      messages,
    });

    const reply = response.choices[0]?.message?.content ?? "Kechirasiz, javob berishda xatolik yuz berdi. Iltimos, qayta urinib ko'ring.";

    await saveMessage(chatId, "assistant", reply);
    await bot.sendMessage(chatId, reply);
  } catch (err) {
    logger.error({ err, chatId }, "Error handling telegram message");
    await bot.sendMessage(
      chatId,
      "Kechirasiz, texnik xatolik yuz berdi. Iltimos, biroz kutib, qayta urinib ko'ring."
    );
  }
});

logger.info("Telegram bot started with polling");

router.get("/telegram/status", (_req, res) => {
  res.json({ status: "ok", message: "Telegram bot is running" });
});

export default router;
