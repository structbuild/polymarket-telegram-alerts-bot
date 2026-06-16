import { Bot } from "grammy";
import type { Context } from "grammy";
import type { Env } from "../../env";
import { createStructClient } from "../../struct/client";
import { lookupByConditionId, lookupByEventSlug, lookupByMarketSlug } from "../../services/market-lookup";
import { getDraft, upsertMarketDraft, updateDraftAwaitingInput, updateDraftFilter, updateDraftMessageId } from "../../db/drafts";
import { bold, escapeHtml } from "../../utils/formatting";
import { buildEventTypeKeyboard, buildFilterKeyboard, buildEventMarketSelectKeyboard, MARKET_EVENT_TYPES, FILTER_CONFIGS } from "../keyboards/filters";
import { isValidAddress, handleWalletAddress } from "../commands/trader";
import { buildFilterText } from "../utils/monitor-draft";

async function handleConditionId(ctx: Context, env: Env, conditionId: string): Promise<void> {
  const telegramId = ctx.from!.id;
  const msg = await ctx.reply("Looking up market...");
  const client = createStructClient(env.STRUCT_API_KEY);
  const market = await lookupByConditionId(client, conditionId);

  if (!market) {
    await ctx.api.editMessageText(telegramId, msg.message_id, "Market not found.");
    return;
  }

  const title = market.question ?? market.title ?? "";
  await upsertMarketDraft(env.DB, telegramId, market.condition_id, market.market_slug ?? "", title, market.event_slug ?? "");

  const keyboard = buildEventTypeKeyboard(MARKET_EVENT_TYPES);
  const text = `${bold(escapeHtml(title))}\n\nChoose an event type:`;
  await ctx.api.editMessageText(telegramId, msg.message_id, text, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
  await updateDraftMessageId(env.DB, telegramId, msg.message_id);
}

async function handlePolymarketUrl(ctx: Context, env: Env, eventSlug: string, marketSlug: string | null): Promise<void> {
  const telegramId = ctx.from!.id;
  const msg = await ctx.reply("Looking up market...");
  const client = createStructClient(env.STRUCT_API_KEY);

  if (marketSlug) {
    const market = await lookupByMarketSlug(client, marketSlug);
    if (!market) {
      await ctx.api.editMessageText(telegramId, msg.message_id, "Market not found.");
      return;
    }

    const title = market.question ?? market.title ?? "";
    await upsertMarketDraft(env.DB, telegramId, market.condition_id, market.market_slug ?? "", title, market.event_slug ?? "");

    const keyboard = buildEventTypeKeyboard(MARKET_EVENT_TYPES);
    const text = `${bold(escapeHtml(title))}\n\nChoose an event type:`;
    await ctx.api.editMessageText(telegramId, msg.message_id, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
    await updateDraftMessageId(env.DB, telegramId, msg.message_id);
    return;
  }

  const event = await lookupByEventSlug(client, eventSlug);
  if (!event) {
    await ctx.api.editMessageText(telegramId, msg.message_id, "Event not found.");
    return;
  }

  const markets = (event.markets ?? []).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));

  if (markets.length === 1) {
    const market = markets[0];
    const title = market.question ?? market.title ?? "";
    await upsertMarketDraft(env.DB, telegramId, market.condition_id, market.market_slug, title, eventSlug);

    const keyboard = buildEventTypeKeyboard(MARKET_EVENT_TYPES);
    const text = `${bold(escapeHtml(title))}\n\nChoose an event type:`;
    await ctx.api.editMessageText(telegramId, msg.message_id, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
    await updateDraftMessageId(env.DB, telegramId, msg.message_id);
    return;
  }

  if (markets.length === 0) {
    await ctx.api.editMessageText(telegramId, msg.message_id, "No markets found for this event.");
    return;
  }

  const eventTitle = event.title ?? eventSlug;
  await upsertMarketDraft(env.DB, telegramId, "", "", "", eventSlug);
  await updateDraftFilter(env.DB, telegramId, "_event_title", eventTitle);
  await updateDraftFilter(env.DB, telegramId, "_event_markets", markets.map((m) => ({
    condition_id: m.condition_id,
    market_slug: m.market_slug,
    question: m.question ?? null,
    title: m.title ?? null,
  })));
  await updateDraftFilter(env.DB, telegramId, "_selected_indices", []);

  const keyboard = buildEventMarketSelectKeyboard(markets, []);
  const text = `${bold(escapeHtml(eventTitle))}\n\nThis event has ${markets.length} markets. Select the ones you want to monitor:`;
  await ctx.api.editMessageText(telegramId, msg.message_id, text, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
  await updateDraftMessageId(env.DB, telegramId, msg.message_id);
}

async function handleFilterInput(ctx: Context, env: Env, awaitingInput: string, text: string): Promise<void> {
  const telegramId = ctx.from!.id;
  const draft = await getDraft(env.DB, telegramId);
  if (!draft || !draft.event_type) return;

  const configs = FILTER_CONFIGS[draft.event_type] ?? [];
  const filterConfig = configs.find((c) => c.key === awaitingInput);
  if (!filterConfig) return;

  let parsedValue: unknown = text;
  if (filterConfig.type === "number") {
    const num = parseFloat(text);
    if (isNaN(num)) {
      await ctx.reply("Please enter a valid number.");
      return;
    }
    if (awaitingInput === "min_usd_value" && num < 1) {
      await ctx.reply("Minimum USD value must be at least $1.");
      return;
    }
    parsedValue = num;
  } else if (filterConfig.type === "list") {
    parsedValue = text
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  const draftFilters = JSON.parse(draft.filters);
  const promptMessageId = draftFilters._prompt_message_id;

  await updateDraftFilter(env.DB, telegramId, awaitingInput, parsedValue);
  await updateDraftFilter(env.DB, telegramId, "_prompt_message_id", null);
  await updateDraftAwaitingInput(env.DB, telegramId, null);

  try {
    await ctx.deleteMessage();
  } catch {}

  if (promptMessageId) {
    try {
      await ctx.api.deleteMessage(telegramId, promptMessageId);
    } catch {}
  }

  if (!draft.message_id) return;

  const updatedDraft = await getDraft(env.DB, telegramId);
  if (!updatedDraft) return;

  const filters = JSON.parse(updatedDraft.filters);
  const keyboard = buildFilterKeyboard(updatedDraft.event_type!, filters);
  const msgText = buildFilterText(updatedDraft);

  await ctx.api.editMessageText(telegramId, draft.message_id, msgText, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
}

export function registerTextHandler(bot: Bot, env: Env): void {
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    const telegramId = ctx.from.id;

    const draft = await getDraft(env.DB, telegramId);
    if (draft?.awaiting_input) {
      await handleFilterInput(ctx, env, draft.awaiting_input, text);
      return;
    }

    const conditionIdMatch = text.match(/^(0x[a-fA-F0-9]{64})$/);
    if (conditionIdMatch) {
      await handleConditionId(ctx, env, conditionIdMatch[1]);
      return;
    }

    const urlMatch = text.match(/polymarket\.com\/event\/([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9_-]+))?/);
    if (urlMatch) {
      const eventSlug = urlMatch[1];
      const marketSlug = urlMatch[2] || null;
      await handlePolymarketUrl(ctx, env, eventSlug, marketSlug);
      return;
    }

    if (isValidAddress(text.toLowerCase())) {
      await handleWalletAddress(ctx, env, text.toLowerCase());
      return;
    }
  });
}
