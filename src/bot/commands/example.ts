import { Bot } from "grammy";
import { formatMessage, EXAMPLE_PAYLOADS } from "../../services/message-builder";

export function registerExample(bot: Bot): void {
  bot.command("example", async (ctx) => {
    const input = ctx.match?.trim();
    const index = input ? parseInt(input, 10) : NaN;

    if (isNaN(index) || index < 1 || index > EXAMPLE_PAYLOADS.length) {
      const list = EXAMPLE_PAYLOADS.map(
        (ex, i) => `${i + 1}. ${ex.event}`
      ).join("\n");
      await ctx.reply(`Usage: /example [1-${EXAMPLE_PAYLOADS.length}]\n\n${list}`);
      return;
    }

    const { event, payload, market } = EXAMPLE_PAYLOADS[index - 1];
    const result = formatMessage(event, payload, market);
    if (!result) {
      await ctx.reply("Failed to format message.");
      return;
    }

    if (result.imageUrl) {
      try {
        await ctx.replyWithPhoto(result.imageUrl, {
          caption: result.text,
          parse_mode: "HTML",
        });
        return;
      } catch {
        // fall through to text message
      }
    }
    await ctx.reply(result.text, { parse_mode: "HTML" });
  });
}
