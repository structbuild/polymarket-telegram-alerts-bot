import { Bot } from "grammy";
import type { Env } from "../../env";
import {
  getMarketMonitorsByUser,
  getTraderMonitorsByUser,
} from "../../db/monitors";
import { bold, code, escapeHtml } from "../../utils/formatting";
import type { DbMarketMonitor, DbTraderMonitor } from "../../types/database";

function formatMonitorList(
  marketSubs: DbMarketMonitor[],
  traderSubs: DbTraderMonitor[]
): string {
  const lines: string[] = [bold("Your Active Monitors"), ""];

  if (marketSubs.length > 0) {
    lines.push(bold("Markets:"));
    marketSubs.forEach((sub, idx) => {
      lines.push(`${idx + 1}. ${escapeHtml(sub.market_title)} (${escapeHtml(sub.event_type)})`);
    });
  }

  if (traderSubs.length > 0) {
    if (marketSubs.length > 0) lines.push("");
    lines.push(bold("Traders:"));
    traderSubs.forEach((sub, idx) => {
      const label = sub.label ?? code(sub.wallet_address);
      lines.push(`${idx + 1}. ${escapeHtml(label)} (${escapeHtml(sub.event_type)})`);
    });
  }

  return lines.join("\n");
}

export async function getFormattedMonitorList(
  env: Env,
  telegramId: number
): Promise<string | null> {
  const [marketSubs, traderSubs] = await Promise.all([
    getMarketMonitorsByUser(env.DB, telegramId),
    getTraderMonitorsByUser(env.DB, telegramId),
  ]);

  if (marketSubs.length === 0 && traderSubs.length === 0) {
    return null;
  }

  return formatMonitorList(marketSubs, traderSubs);
}

export function registerList(bot: Bot, env: Env): void {
  bot.command("list", async (ctx) => {
    const list = await getFormattedMonitorList(env, ctx.from!.id);
    await ctx.reply(
      list ?? "No active monitors. Send a condition ID or Polymarket URL to get started.",
      { parse_mode: "HTML" }
    );
  });
}
