import { Bot } from "grammy";
import type { Env } from "../../env";
import { createMonitorRemovalSession, deleteMonitorRemovalSession } from "../../db/monitor-removal-sessions";
import { buildUnsubscribeReply } from "../utils/monitor-pages";

type ReplyContext = {
  reply: (
    text: string,
    options?: any
  ) => Promise<{ message_id: number }>;
};

export async function sendUnsubscribeReply(
  ctx: ReplyContext,
  env: Env,
  telegramId: number
): Promise<void> {
  const result = await buildUnsubscribeReply(env, telegramId);
  if (!result) {
    await deleteMonitorRemovalSession(env.DB, telegramId);
    await ctx.reply("You have no active monitors.");
    return;
  }

  const message = await ctx.reply(result.text, {
    parse_mode: "HTML",
    reply_markup: result.keyboard,
  });
  await createMonitorRemovalSession(env.DB, telegramId, message.message_id);
}

export function registerUnsubscribe(bot: Bot, env: Env): void {
  bot.command("unsubscribe", async (ctx) => {
    await sendUnsubscribeReply(ctx, env, ctx.from!.id);
  });
}
