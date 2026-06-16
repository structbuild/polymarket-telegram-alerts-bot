import type { Bot, InlineKeyboard } from "grammy";

async function sendToUser(
  bot: Bot,
  chatId: number,
  message: string,
  imageUrl?: string | null,
  keyboard?: InlineKeyboard
): Promise<void> {
  if (imageUrl) {
    try {
      await bot.api.sendPhoto(chatId, imageUrl, {
        caption: message,
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
      return;
    } catch {
      // fall through to text message
    }
  }
  await bot.api.sendMessage(chatId, message, { parse_mode: "HTML", reply_markup: keyboard });
}

export async function notifySubscribers(
  bot: Bot,
  telegramIds: number[],
  message: string,
  imageUrl?: string | null,
  keyboard?: InlineKeyboard
): Promise<void> {
  await Promise.allSettled(
    telegramIds.map((id) => sendToUser(bot, id, message, imageUrl, keyboard))
  );
}
