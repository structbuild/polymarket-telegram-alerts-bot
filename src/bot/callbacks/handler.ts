import { Bot } from "grammy";
import type { Env } from "../../env";
import type { PolymarketWebhookEvent } from "@structbuild/sdk";
import type { DbMonitorDraft } from "../../types/database";
import { createStructClient } from "../../struct/client";
import {
  isActiveDraftCallbackMessage,
  STALE_DRAFT_CALLBACK_MESSAGE,
} from "../utils/draft-callback";
import {
  createMonitorWebhook,
  deleteMonitorWebhook,
  deleteMonitorWebhookStrict,
  findReusableMonitorWebhook,
} from "../../struct/webhook-manager";
import {
  addMarketMonitor,
  addTraderMonitor,
  countActiveMonitorWebhookReferences,
  getAllMonitorWebhookIds,
  getMarketMonitor,
  getMarketMonitorByUserConditionAndEvent,
  getMarketMonitorsByConditionAndEvent,
  getTraderMonitor,
  getTraderMonitorByUserWalletAndEvent,
  getTraderMonitorsByWalletAndEvent,
  removeAllMonitors,
  removeMarketMonitor,
  removeTraderMonitor,
} from "../../db/monitors";
import {
  getDraft,
  updateDraftEventType,
  updateDraftAwaitingInput,
  updateDraftFilter,
  deleteDraft,
} from "../../db/drafts";
import {
  buildFilterKeyboard,
  buildEnumOptionsKeyboard,
  buildMultiOptionsKeyboard,
  buildEventTypeKeyboard,
  buildEventMarketKeyboard,
  FILTER_CONFIGS,
  MARKET_EVENT_TYPES,
  TRADER_EVENT_TYPES,
} from "../keyboards/filters";
import { bold, code, escapeHtml } from "../../utils/formatting";
import {
  buildFilterText,
  getEventTypeLabel,
  requiresMinUsd,
} from "../utils/monitor-draft";
import { upsertUser } from "../../db/users";
import {
  normalizeStructWebhookFilters,
  parseStoredFilters,
  toFiniteNumber,
} from "../../services/monitor-filters";

type DraftFilters = Record<string, unknown>;
type DraftCallbackContext = {
  callbackQuery: {
    message?: {
      message_id?: number;
    };
  };
  answerCallbackQuery: (text?: string) => Promise<unknown>;
};

function parseDraftFilters(filters: string): DraftFilters {
  return parseStoredFilters(filters);
}

async function getActiveDraftForCallback(
  ctx: DraftCallbackContext,
  env: Env,
  telegramId: number,
  noActiveSetupMessage: string
): Promise<DbMonitorDraft | null> {
  const draft = await getDraft(env.DB, telegramId);
  if (!draft) {
    await ctx.answerCallbackQuery(noActiveSetupMessage);
    return null;
  }

  if (!isActiveDraftCallbackMessage(draft.message_id, ctx.callbackQuery.message?.message_id)) {
    await ctx.answerCallbackQuery(STALE_DRAFT_CALLBACK_MESSAGE);
    return null;
  }

  return draft;
}

function sanitizeMonitorFilters(
  eventType: string,
  filters: DraftFilters
): Record<string, unknown> {
  const allowedKeys = new Set((FILTER_CONFIGS[eventType] ?? []).map((config) => config.key));
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(filters)) {
    if (!allowedKeys.has(key) || value === null || value === undefined) {
      continue;
    }
    sanitized[key] = value;
  }

  return sanitized;
}

function webhookDeps(env: Env) {
  return {
    client: createStructClient(env.STRUCT_API_KEY),
    webhookBaseUrl: env.WEBHOOK_BASE_URL,
    webhookSecret: env.STRUCT_WEBHOOK_SECRET,
  };
}

function uniqueWebhookIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

async function deleteOrphanedWebhookIdsStrict(
  db: D1Database,
  deps: ReturnType<typeof webhookDeps>,
  webhookIds: Array<string | null | undefined>
): Promise<void> {
  for (const webhookId of uniqueWebhookIds(webhookIds)) {
    const webhookRefCount = await countActiveMonitorWebhookReferences(db, webhookId);
    if (webhookRefCount === 0) {
      await deleteMonitorWebhookStrict(deps, webhookId);
    }
  }
}

export function registerCallbackHandler(bot: Bot, env: Env): void {
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const telegramId = ctx.from.id;

    try {
      if (data.startsWith("et:")) {
        const eventType = data.slice(3);
        const draft = await getActiveDraftForCallback(
          ctx,
          env,
          telegramId,
          "No active setup. Send a condition ID or URL to start."
        );
        if (!draft) return;

        await updateDraftEventType(env.DB, telegramId, eventType);

        if (draft.draft_type === "trader") {
          const existingFilters = parseDraftFilters(draft.filters);
          if (requiresMinUsd(eventType) && existingFilters.min_usd_value === undefined) {
            await updateDraftFilter(env.DB, telegramId, "min_usd_value", 10);
          }
          if (eventType === "trader_new_market") {
            await updateDraftFilter(env.DB, telegramId, "min_usd_value", null);
            await updateDraftFilter(env.DB, telegramId, "min_probability", null);
            await updateDraftFilter(env.DB, telegramId, "max_probability", null);
          }
        }

        const updatedDraft = await getDraft(env.DB, telegramId);
        if (!updatedDraft) return;

        const filters = JSON.parse(updatedDraft.filters);
        await ctx.editMessageText(buildFilterText(updatedDraft), {
          parse_mode: "HTML",
          reply_markup: buildFilterKeyboard(eventType, filters),
        });
        await ctx.answerCallbackQuery();
        return;
      }

      if (data.startsWith("ft:")) {
        const filterName = data.slice(3);
        const draft = await getActiveDraftForCallback(ctx, env, telegramId, "No active setup.");
        if (!draft) return;
        if (!draft.event_type) {
          await ctx.answerCallbackQuery("No active setup.");
          return;
        }

        const configs = FILTER_CONFIGS[draft.event_type] ?? [];
        const config = configs.find((c) => c.key === filterName);
        if (!config) {
          await ctx.answerCallbackQuery("Unknown filter.");
          return;
        }

        if (config.type === "number") {
          await updateDraftAwaitingInput(env.DB, telegramId, filterName);
          await ctx.answerCallbackQuery();
          const promptMsg = await ctx.reply(`Enter value for ${config.label}:`);
          await updateDraftFilter(env.DB, telegramId, "_prompt_message_id", promptMsg.message_id);
          return;
        }

        if (config.type === "enum") {
          await ctx.editMessageText(buildFilterText(draft), {
            parse_mode: "HTML",
            reply_markup: buildEnumOptionsKeyboard(filterName, config.options ?? []),
          });
          await ctx.answerCallbackQuery();
          return;
        }

        if (config.type === "multi") {
          const filters = JSON.parse(draft.filters);
          const selected: string[] = Array.isArray(filters[filterName]) ? filters[filterName] : [];
          await ctx.editMessageText(buildFilterText(draft), {
            parse_mode: "HTML",
            reply_markup: buildMultiOptionsKeyboard(filterName, config.options ?? [], selected),
          });
          await ctx.answerCallbackQuery();
          return;
        }

        await ctx.answerCallbackQuery();
        return;
      }

      if (data.startsWith("fb:")) {
        const parts = data.slice(3).split(":");
        const filterName = parts[0];
        const value = parts.slice(1).join(":");
        const draft = await getActiveDraftForCallback(ctx, env, telegramId, "No active setup.");
        if (!draft) return;
        if (!draft.event_type) {
          await ctx.answerCallbackQuery("No active setup.");
          return;
        }

        const configs = FILTER_CONFIGS[draft.event_type] ?? [];
        const config = configs.find((c) => c.key === filterName);
        if (!config) {
          await ctx.answerCallbackQuery("Unknown filter.");
          return;
        }

        const filters = JSON.parse(draft.filters);

        if (config.type === "boolean" && value === "toggle") {
          const current = filters[filterName] === true || filters[filterName] === "true";
          await updateDraftFilter(env.DB, telegramId, filterName, !current);
        } else if (config.type === "enum") {
          if (value !== "cancel") {
            await updateDraftFilter(env.DB, telegramId, filterName, value);
          }
        } else if (config.type === "multi") {
          if (value !== "done") {
            const current: string[] = Array.isArray(filters[filterName]) ? filters[filterName] : [];
            const updated = current.includes(value)
              ? current.filter((v) => v !== value)
              : [...current, value];
            await updateDraftFilter(env.DB, telegramId, filterName, updated);
          }
        }

        const refreshedDraft = await getDraft(env.DB, telegramId);
        if (!refreshedDraft || !refreshedDraft.event_type) return;

        const updatedFilters = JSON.parse(refreshedDraft.filters);

        if (config.type === "multi" && value !== "done") {
          const selected: string[] = Array.isArray(updatedFilters[filterName]) ? updatedFilters[filterName] : [];
          await ctx.editMessageText(buildFilterText(refreshedDraft), {
            parse_mode: "HTML",
            reply_markup: buildMultiOptionsKeyboard(filterName, config.options ?? [], selected),
          });
        } else {
          await ctx.editMessageText(buildFilterText(refreshedDraft), {
            parse_mode: "HTML",
            reply_markup: buildFilterKeyboard(refreshedDraft.event_type, updatedFilters),
          });
        }

        await ctx.answerCallbackQuery();
        return;
      }

      if (data === "sub:confirm") {
        const draft = await getActiveDraftForCallback(
          ctx,
          env,
          telegramId,
          "No active setup or event type not selected."
        );
        if (!draft) return;
        if (!draft.event_type) {
          await ctx.answerCallbackQuery("No active setup or event type not selected.");
          return;
        }

        const filters = parseDraftFilters(draft.filters);

        const eventType = draft.event_type as PolymarketWebhookEvent;
        const fullFilters: Record<string, unknown> = sanitizeMonitorFilters(eventType, filters);

        if (eventType === "close_to_bond") {
          const minProbability = toFiniteNumber(fullFilters.min_probability);
          const maxProbability = toFiniteNumber(fullFilters.max_probability);
          if (minProbability === null && maxProbability === null) {
            await ctx.answerCallbackQuery("Close-to-Bond needs a min or max probability before it can be created.");
            return;
          }
        }

        if (draft.draft_type === "trader" && requiresMinUsd(eventType)) {
          const minUsd = toFiniteNumber(fullFilters.min_usd_value);
          if (minUsd === null || minUsd < 10) {
            await ctx.answerCallbackQuery("Min USD is required (minimum $10). Tap the Min USD button to set it.");
            return;
          }
        }

        await upsertUser(
          env.DB,
          telegramId,
          ctx.from.username ?? null,
          ctx.from.first_name ?? null
        );

        const deps = webhookDeps(env);

        if (draft.draft_type === "market") {
          if (!draft.condition_id || !draft.market_slug || !draft.market_title) {
            await ctx.answerCallbackQuery("This monitor draft is missing market details. Start again from the market link.");
            return;
          }

          fullFilters.condition_ids = [draft.condition_id];
          const structFilters = normalizeStructWebhookFilters(eventType, fullFilters);
          const description = `${getEventTypeLabel(draft.event_type)} — ${draft.market_title}`;
          const existingMonitor = await getMarketMonitorByUserConditionAndEvent(
            env.DB,
            telegramId,
            draft.condition_id,
            draft.event_type
          );
          const candidateMonitors = await getMarketMonitorsByConditionAndEvent(
            env.DB,
            draft.condition_id,
            draft.event_type
          );
          const reusableWebhookId = await findReusableMonitorWebhook(
            deps,
            eventType,
            structFilters,
            uniqueWebhookIds(candidateMonitors.map((monitor) => monitor.struct_webhook_id))
          );
          const webhookId = reusableWebhookId ?? await createMonitorWebhook(deps, eventType, structFilters, description);
          const createdWebhook = reusableWebhookId === null;
          try {
            await addMarketMonitor(
              env.DB,
              telegramId,
              draft.condition_id,
              draft.market_slug,
              draft.market_title,
              draft.event_slug ?? "",
              draft.event_type,
              webhookId,
              fullFilters
            );
          } catch (error) {
            if (createdWebhook) {
              await deleteMonitorWebhook(deps, webhookId);
            }
            throw error;
          }
          if (existingMonitor?.struct_webhook_id && existingMonitor.struct_webhook_id !== webhookId) {
            await deleteOrphanedWebhookIdsStrict(env.DB, deps, [existingMonitor.struct_webhook_id]);
          }
          await deleteDraft(env.DB, telegramId);
          await ctx.editMessageText(
            `Now monitoring ${bold(getEventTypeLabel(draft.event_type))} for ${escapeHtml(draft.market_title)}`,
            { parse_mode: "HTML" }
          );
        } else {
          if (!draft.wallet_address) {
            await ctx.answerCallbackQuery("This monitor draft is missing a wallet address. Start again with /trader.");
            return;
          }

          fullFilters.wallet_addresses = [draft.wallet_address];
          const structFilters = normalizeStructWebhookFilters(eventType, fullFilters);
          const addr = draft.wallet_address ?? "";
          const description = `${getEventTypeLabel(draft.event_type)} — trader ${addr}`;
          const existingMonitor = await getTraderMonitorByUserWalletAndEvent(
            env.DB,
            telegramId,
            draft.wallet_address,
            draft.event_type
          );
          const candidateMonitors = await getTraderMonitorsByWalletAndEvent(
            env.DB,
            draft.wallet_address,
            draft.event_type
          );
          const reusableWebhookId = await findReusableMonitorWebhook(
            deps,
            eventType,
            structFilters,
            uniqueWebhookIds(candidateMonitors.map((monitor) => monitor.struct_webhook_id))
          );
          const webhookId = reusableWebhookId ?? await createMonitorWebhook(deps, eventType, structFilters, description);
          const createdWebhook = reusableWebhookId === null;
          try {
            await addTraderMonitor(
              env.DB,
              telegramId,
              draft.wallet_address,
              null,
              draft.event_type,
              webhookId,
              fullFilters
            );
          } catch (error) {
            if (createdWebhook) {
              await deleteMonitorWebhook(deps, webhookId);
            }
            throw error;
          }
          if (existingMonitor?.struct_webhook_id && existingMonitor.struct_webhook_id !== webhookId) {
            await deleteOrphanedWebhookIdsStrict(env.DB, deps, [existingMonitor.struct_webhook_id]);
          }
          await deleteDraft(env.DB, telegramId);
          await ctx.editMessageText(
            `Now monitoring ${bold(getEventTypeLabel(draft.event_type))} for trader ${code(addr)}`,
            { parse_mode: "HTML" }
          );
        }

        await ctx.answerCallbackQuery();
        return;
      }

      if (data === "sub:cancel") {
        const draft = await getActiveDraftForCallback(ctx, env, telegramId, "No active setup.");
        if (!draft) return;

        await deleteDraft(env.DB, telegramId);
        await ctx.editMessageText("Monitor creation cancelled.");
        await ctx.answerCallbackQuery();
        return;
      }

      if (data === "noop") {
        await ctx.answerCallbackQuery();
        return;
      }

      if (data.startsWith("emp:")) {
        const page = parseInt(data.slice(4));
        const draft = await getActiveDraftForCallback(ctx, env, telegramId, "No active setup.");
        if (!draft) return;

        const filters = JSON.parse(draft.filters);
        const eventMarkets: { condition_id: string; market_slug: string; question: string | null; title: string | null }[] =
          filters._event_markets ?? [];

        const eventTitle = filters._event_title ?? draft.event_slug ?? "Event";
        const keyboard = buildEventMarketKeyboard(eventMarkets as { condition_id: string; question: string; title: string | null }[], page);
        await ctx.editMessageText(
          `${bold(escapeHtml(eventTitle))}\n\nThis event has multiple markets. Choose one:`,
          { parse_mode: "HTML", reply_markup: keyboard }
        );
        await ctx.answerCallbackQuery();
        return;
      }

      if (data.startsWith("em:")) {
        const index = parseInt(data.slice(3));
        const draft = await getActiveDraftForCallback(ctx, env, telegramId, "No active setup.");
        if (!draft) return;

        const filters = JSON.parse(draft.filters);
        const eventMarkets: { condition_id: string; market_slug: string; question: string | null; title: string | null }[] =
          filters._event_markets ?? [];

        if (index < 0 || index >= eventMarkets.length) {
          await ctx.answerCallbackQuery("Invalid selection.");
          return;
        }

        const market = eventMarkets[index];
        const marketTitle = market.question ?? market.title ?? "Unknown";
        delete filters._event_markets;
        delete filters._event_title;

        await env.DB.prepare(
          "UPDATE monitor_drafts SET condition_id = ?, market_slug = ?, market_title = ?, filters = ? WHERE telegram_id = ?"
        )
          .bind(market.condition_id, market.market_slug, marketTitle, JSON.stringify(filters), telegramId)
          .run();

        const eventTypes = draft.draft_type === "trader" ? TRADER_EVENT_TYPES : MARKET_EVENT_TYPES;

        await ctx.editMessageText(
          `${bold(escapeHtml(marketTitle))}\n\nSelect an event type:`,
          { parse_mode: "HTML", reply_markup: buildEventTypeKeyboard(eventTypes) }
        );
        await ctx.answerCallbackQuery();
        return;
      }

      if (data.startsWith("um:")) {
        const id = parseInt(data.slice(3));
        if (!Number.isInteger(id)) {
          await ctx.answerCallbackQuery("Invalid monitor.");
          return;
        }

        const monitor = await getMarketMonitor(env.DB, id);
        if (!monitor || monitor.telegram_id !== telegramId || monitor.is_active !== 1) {
          await ctx.answerCallbackQuery("Monitor not found.");
          return;
        }

        const deps = webhookDeps(env);
        await removeMarketMonitor(env.DB, id);
        await deleteOrphanedWebhookIdsStrict(env.DB, deps, [monitor.struct_webhook_id]);

        await ctx.editMessageText("Market monitor removed.", { parse_mode: "HTML" });
        await ctx.answerCallbackQuery();
        return;
      }

      if (data.startsWith("ut:")) {
        const id = parseInt(data.slice(3));
        if (!Number.isInteger(id)) {
          await ctx.answerCallbackQuery("Invalid monitor.");
          return;
        }

        const monitor = await getTraderMonitor(env.DB, id);
        if (!monitor || monitor.telegram_id !== telegramId || monitor.is_active !== 1) {
          await ctx.answerCallbackQuery("Monitor not found.");
          return;
        }

        const deps = webhookDeps(env);
        await removeTraderMonitor(env.DB, id);
        await deleteOrphanedWebhookIdsStrict(env.DB, deps, [monitor.struct_webhook_id]);

        await ctx.editMessageText("Trader monitor removed.", { parse_mode: "HTML" });
        await ctx.answerCallbackQuery();
        return;
      }

      if (data === "ua") {
        const deps = webhookDeps(env);
        const webhookIds = await getAllMonitorWebhookIds(env.DB, telegramId);
        await removeAllMonitors(env.DB, telegramId);
        await deleteOrphanedWebhookIdsStrict(env.DB, deps, webhookIds);
        await ctx.editMessageText("All monitors removed.", { parse_mode: "HTML" });
        await ctx.answerCallbackQuery();
        return;
      }

      await ctx.answerCallbackQuery("Unknown action.");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "An error occurred";
      await ctx.answerCallbackQuery(msg.slice(0, 200));
    }
  });
}
