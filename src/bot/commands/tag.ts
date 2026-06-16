import { Bot } from "grammy";
import type { Context } from "grammy";
import type { Env } from "../../env";
import { upsertTagDraft, updateDraftMessageId } from "../../db/drafts";
import { bold, code, escapeHtml } from "../../utils/formatting";
import { buildEventTypeKeyboard, TAG_EVENT_TYPES } from "../keyboards/filters";

const MAX_SCOPE_LENGTH = 64;

async function startTagScope(
  ctx: Context,
  env: Env,
  scopeType: "tag" | "series",
  value: string
): Promise<void> {
  await upsertTagDraft(env.DB, ctx.from!.id, scopeType, value);

  const keyboard = buildEventTypeKeyboard(TAG_EVENT_TYPES);
  const msg = await ctx.reply(
    `${bold(`Monitor ${scopeType}:`)} ${code(escapeHtml(value))}\n\nSelect an event type:`,
    { parse_mode: "HTML", reply_markup: keyboard }
  );
  await updateDraftMessageId(env.DB, ctx.from!.id, msg.message_id);
}

function registerScopeCommand(
  bot: Bot,
  env: Env,
  command: "tag" | "series",
  scopeType: "tag" | "series",
  example: string
): void {
  bot.command(command, async (ctx) => {
    const input = ctx.match?.trim();

    if (!input) {
      await ctx.reply(
        `${bold("Usage:")} /${command} &lt;${scopeType}&gt;\n\nExample: /${command} ${example}`,
        { parse_mode: "HTML" }
      );
      return;
    }

    if (input.length > MAX_SCOPE_LENGTH) {
      await ctx.reply(`That ${scopeType} is too long (max ${MAX_SCOPE_LENGTH} characters).`);
      return;
    }

    await startTagScope(ctx, env, scopeType, input);
  });
}

export function registerTag(bot: Bot, env: Env): void {
  registerScopeCommand(bot, env, "tag", "tag", "Sports");
  registerScopeCommand(bot, env, "series", "series", "nfl");
}
