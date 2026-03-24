import { Bot, InlineKeyboard } from "grammy";
import type { Env } from "../../env";
import {
  getMarketMonitorsByUser,
  getTraderMonitorsByUser,
} from "../../db/monitors";
import { shortenAddress, truncate } from "../../utils/formatting";

export async function buildUnsubscribeReply(
  env: Env,
  telegramId: number
): Promise<{ text: string; keyboard: InlineKeyboard } | null> {
  const [marketSubs, traderSubs] = await Promise.all([
    getMarketMonitorsByUser(env.DB, telegramId),
    getTraderMonitorsByUser(env.DB, telegramId),
  ]);

  if (marketSubs.length === 0 && traderSubs.length === 0) {
    return null;
  }

  const keyboard = new InlineKeyboard();

  marketSubs.forEach((sub) => {
    keyboard.text(truncate(sub.market_title, 40), `um:${sub.id}`).row();
  });

  traderSubs.forEach((sub) => {
    const label = sub.label ?? shortenAddress(sub.wallet_address);
    keyboard.text(`[Trader] ${label}`, `ut:${sub.id}`).row();
  });

  keyboard.text("Remove All", "ua").row();

  return { text: "Select a monitor to remove:", keyboard };
}

export function registerUnsubscribe(bot: Bot, env: Env): void {
  bot.command("unsubscribe", async (ctx) => {
    const result = await buildUnsubscribeReply(env, ctx.from!.id);
    if (!result) {
      await ctx.reply("You have no active monitors.");
      return;
    }
    await ctx.reply(result.text, { reply_markup: result.keyboard });
  });
}
