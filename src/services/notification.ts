import type { Bot } from "grammy";

async function sendToUser(
  bot: Bot,
  chatId: number,
  message: string,
  imageUrl?: string | null
): Promise<void> {
  if (imageUrl) {
    try {
      await bot.api.sendPhoto(chatId, imageUrl, {
        caption: message,
        parse_mode: "HTML",
      });
      return;
    } catch {
      // fall through to text message
    }
  }
  await bot.api.sendMessage(chatId, message, { parse_mode: "HTML" });
}

export async function notifySubscribers(
  bot: Bot,
  telegramIds: number[],
  message: string,
  imageUrl?: string | null
): Promise<void> {
  await Promise.allSettled(
    telegramIds.map((id) => sendToUser(bot, id, message, imageUrl))
  );
}
