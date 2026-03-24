import { Bot } from "grammy";
import type { Context } from "grammy";
import type { Env } from "../../env";
import { upsertTraderDraft, updateDraftMessageId } from "../../db/drafts";
import { bold, code } from "../../utils/formatting";
import { buildEventTypeKeyboard, TRADER_EVENT_TYPES } from "../keyboards/filters";

export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export async function handleWalletAddress(ctx: Context, env: Env, walletAddress: string): Promise<void> {
  await upsertTraderDraft(env.DB, ctx.from!.id, walletAddress);

  const keyboard = buildEventTypeKeyboard(TRADER_EVENT_TYPES);
  const msg = await ctx.reply(
    `${bold("Track trader:")} ${code(walletAddress)}\n\nSelect an event type:`,
    { parse_mode: "HTML", reply_markup: keyboard }
  );
  await updateDraftMessageId(env.DB, ctx.from!.id, msg.message_id);
}

export function registerTrader(bot: Bot, env: Env): void {
  bot.command("trader", async (ctx) => {
    const input = ctx.match?.trim();

    if (!input) {
      await ctx.reply(
        `${bold("Usage:")} /trader &lt;wallet_address&gt;\n\nExample: /trader 0x1234...abcd`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const walletAddress = input.toLowerCase();

    if (!isValidAddress(walletAddress)) {
      await ctx.reply("Invalid wallet address. Please provide a valid Ethereum address (0x...).");
      return;
    }

    await handleWalletAddress(ctx, env, walletAddress);
  });
}
