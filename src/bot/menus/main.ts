import { Menu } from "@grammyjs/menu";
import type { Env } from "../../env";
import { bold, escapeHtml, link } from "../../utils/formatting";
import { buildMarketOnboardingText, buildTraderOnboardingText } from "../utils/onboarding";
import { sendUnsubscribeReply } from "../commands/unsubscribe";
import { BOT_COMMANDS } from "../commands/catalog";
import { buildMonitorListReply } from "../utils/monitor-pages";

function getBotUsername(env: Pick<Env, "BOT_INFO">): string | null {
	try {
		const botInfo = JSON.parse(env.BOT_INFO) as { username?: unknown };
		return typeof botInfo.username === "string" && botInfo.username.length > 0
			? botInfo.username
			: null;
	} catch {
		return null;
	}
}

function buildStartLink(botUsername: string | null, startParam: string, text: string): string {
	if (!botUsername) return text;
	return link(text, `https://t.me/${botUsername}?start=${encodeURIComponent(startParam)}`);
}

function buildWelcomeText(env: Pick<Env, "BOT_INFO">, firstName?: string, username?: string): string {
	const name = firstName ?? username;
	const greeting = name ? `👋 ${escapeHtml(name)}, welcome` : "👋 Welcome";
	const botUsername = getBotUsername(env);
	return [
		`${greeting} to <b>Struct Alerts Bot</b>!`,
		"",
		`👀 ${buildStartLink(botUsername, "market", "Monitor")} Polymarket events, odds and outcomes in real time.`,
		"",
		`🔎 ${buildStartLink(botUsername, "trader", "Track")} trader wallets and get alerts on their activity.`,
		"",
		"Send me a Polymarket event URL or wallet address to get started.",
	].join("\n");
}

const HELP_TEXT = [
	bold("Getting Started"),
	"",
	bold("How to set up a monitor:"),
	"Send a condition ID (0x...) or a Polymarket event URL directly in the chat.",
	"",
	bold("Available alert types:"),
	"- Probability spikes",
	"- Price spikes",
	"- Market metrics updates",
	"- Close-to-bond trades",
	"- Trader first trades, new market entries, trades",
	"",
	bold("Commands:"),
	...BOT_COMMANDS,
].join("\n");

export { buildWelcomeText };

export function createMainMenu(env: Env) {
	const mainMenu = new Menu("main-menu")
		.text("🏪 Market", async (ctx) => {
			await ctx.reply(buildMarketOnboardingText(), { parse_mode: "HTML" });
		})
		.text("👤 Trader", async (ctx) => {
			await ctx.reply(buildTraderOnboardingText(), { parse_mode: "HTML" });
		})
		.row()
		.submenu("🔍 Monitors", "monitors-menu", async (ctx) => {
			await ctx.editMessageText(`${bold("🔍 Manage Monitors")}\n\nView or manage your active monitors.`, { parse_mode: "HTML" });
		})
		.row()
		.submenu("💬 Help", "help-menu", async (ctx) => {
			await ctx.editMessageText(HELP_TEXT, { parse_mode: "HTML" });
		});

	const monitorsMenu = new Menu("monitors-menu")
		.text("🔍 View Monitors", async (ctx) => {
			const result = await buildMonitorListReply(env, ctx.from!.id);
			await ctx.reply(result?.text ?? "No active monitors.", {
				parse_mode: "HTML",
				reply_markup: result?.keyboard,
			});
		})
		.row()
		.text("🔧 Manage / Remove", async (ctx) => {
			await sendUnsubscribeReply(ctx, env, ctx.from!.id);
		})
		.row()
		.back("⬅️ Back", async (ctx) => {
			await ctx.editMessageText(buildWelcomeText(env, ctx.from?.first_name, ctx.from?.username), {
				parse_mode: "HTML",
				link_preview_options: { is_disabled: true },
			});
		});

	const helpMenu = new Menu("help-menu").back("⬅️ Back", async (ctx) => {
		await ctx.editMessageText(buildWelcomeText(env, ctx.from?.first_name, ctx.from?.username), {
			parse_mode: "HTML",
			link_preview_options: { is_disabled: true },
		});
	});

	mainMenu.register(monitorsMenu);
	mainMenu.register(helpMenu);

	return mainMenu;
}
