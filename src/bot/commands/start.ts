import { Bot } from "grammy";
import type { Menu } from "@grammyjs/menu";
import type { Env } from "../../env";
import { upsertUser } from "../../db/users";
import {
  buildMarketOnboardingText,
  buildTraderOnboardingText,
  getStartReplyKind,
} from "../utils/onboarding";
import { buildWelcomeText } from "../menus/main";

export function buildStartReplyText(
  env: Pick<Env, "BOT_INFO">,
  firstName?: string,
  username?: string,
  match?: string
): string {
  const route = getStartReplyKind(match);

  if (route === "market") {
    return buildMarketOnboardingText();
  }

  if (route === "trader") {
    return buildTraderOnboardingText();
  }

  return buildWelcomeText(env, firstName, username);
}

export function registerStart(bot: Bot, env: Env, mainMenu: Menu): void {
  bot.command("start", async (ctx) => {
    const from = ctx.from!;
    await upsertUser(env.DB, from.id, from.username ?? null, from.first_name ?? null);
    await ctx.reply(buildStartReplyText(env, from.first_name, from.username ?? undefined, ctx.match), {
      parse_mode: "HTML",
      reply_markup: mainMenu,
      link_preview_options: { is_disabled: true },
    });
  });
}
