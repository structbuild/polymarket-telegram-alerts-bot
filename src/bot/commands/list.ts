import { Bot } from "grammy";
import type { Env } from "../../env";
import { buildMonitorListReply } from "../utils/monitor-pages";

export function registerList(bot: Bot, env: Env): void {
  bot.command("list", async (ctx) => {
    const result = await buildMonitorListReply(env, ctx.from!.id);
    await ctx.reply(
      result?.text ?? "No active monitors. Send a condition ID or Polymarket URL to get started.",
      {
        parse_mode: "HTML",
        reply_markup: result?.keyboard,
      }
    );
  });
}
