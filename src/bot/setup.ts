import { Bot } from "grammy";
import type { Env } from "../env";
import { createMainMenu } from "./menus/main";
import { registerStart } from "./commands/start";
import { registerHelp } from "./commands/help";
import { registerTrader } from "./commands/trader";
import { registerTag } from "./commands/tag";
import { registerUnsubscribe } from "./commands/unsubscribe";
import { registerList } from "./commands/list";
import { registerExample } from "./commands/example";
import { registerTextHandler } from "./handlers/text";
import { registerCallbackHandler } from "./callbacks/handler";

export function createBot(env: Env): Bot {
  const bot = new Bot(env.BOT_TOKEN, {
    botInfo: JSON.parse(env.BOT_INFO),
  });

  bot.api.config.use((prev, method, payload, signal) =>
    prev(method, { ...payload, link_preview_options: { is_disabled: true } }, signal)
  );

  const mainMenu = createMainMenu(env);
  bot.use(mainMenu);

  registerStart(bot, env, mainMenu);
  registerHelp(bot, env, mainMenu);
  registerTrader(bot, env);
  registerTag(bot, env);
  registerUnsubscribe(bot, env);
  registerList(bot, env);
  registerExample(bot);
  registerCallbackHandler(bot, env);
  registerTextHandler(bot, env);

  return bot;
}
