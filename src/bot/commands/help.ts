import { Bot } from "grammy";
import type { Menu } from "@grammyjs/menu";
import type { Env } from "../../env";
import { buildWelcomeText } from "../menus/main";

export function registerHelp(bot: Bot, env: Env, mainMenu: Menu): void {
  bot.command("help", async (ctx) => {
    const from = ctx.from!;
    await ctx.reply(buildWelcomeText(env, from.first_name, from.username ?? undefined), {
      parse_mode: "HTML",
      reply_markup: mainMenu,
      link_preview_options: { is_disabled: true },
    });
  });
}
