import { Bot } from "grammy";
import type { Env } from "../../env";
import type { PolymarketWebhookEvent } from "@structbuild/sdk";
import type {
  DbMarketMonitor,
  DbMonitorDraft,
  DbMonitorRemovalSession,
  DbTraderMonitor,
} from "../../types/database";
import { createStructClient } from "../../struct/client";
import {
  isActiveDraftCallbackMessage,
  STALE_DRAFT_CALLBACK_MESSAGE,
} from "../utils/draft-callback";
import {
  createMonitorWebhook,
  deleteMonitorWebhook,
  deleteMonitorWebhookStrict,
  findAndExpandWebhook,
  findReusableMonitorWebhook,
  removeConditionIdFromWebhook,
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
  mergeDraftFilters,
  updateDraftEventType,
  updateDraftAwaitingInput,
  updateDraftFilter,
  deleteDraft,
} from "../../db/drafts";
import {
  createMonitorRemovalSession,
  deleteMonitorRemovalSession,
  getMonitorRemovalSession,
  updateMonitorRemovalSessionSelection,
} from "../../db/monitor-removal-sessions";
import {
  buildFilterKeyboard,
  buildEnumOptionsKeyboard,
  buildMultiOptionsKeyboard,
  buildEventTypeKeyboard,
  buildEventMarketSelectKeyboard,
  FILTER_CONFIGS,
  MARKET_EVENT_TYPES,
  TRADER_EVENT_TYPES,
} from "../keyboards/filters";
import { bold, code, escapeHtml } from "../../utils/formatting";
import {
  buildFilterText,
  getEventTypeLabel,
  requiresMinUsd,
  traderScopeFilterKey,
} from "../utils/monitor-draft";
import { upsertUser } from "../../db/users";
import {
  normalizeStructWebhookFilters,
  parseStoredFilters,
  toFiniteNumber,
} from "../../services/monitor-filters";
import {
  buildMonitorKey,
  buildMonitorListReply,
  buildUnsubscribeReply,
  getMonitorEntriesForUser,
  parseMonitorRemovalCallbackData,
  parseMonitorSelectionCallbackData,
  sanitizeSelectedMonitorKeys,
} from "../utils/monitor-pages";
import { logError } from "../../utils/logging";

type EventMarket = { condition_id: string; market_slug: string; question: string | null; title: string | null };
type DraftFilters = Record<string, unknown>;
type DraftCallbackContext = {
  callbackQuery: {
    message?: {
      message_id?: number;
    };
  };
  answerCallbackQuery: (text?: string) => Promise<unknown>;
};
type EditableCallbackContext = DraftCallbackContext & {
  editMessageText: (
    text: string,
    other?: Record<string, unknown>
  ) => Promise<unknown>;
};

function parseDraftFilters(filters: string): DraftFilters {
  return parseStoredFilters(filters);
}

function applyFilterPatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) {
      delete out[key];
    } else {
      out[key] = value;
    }
  }
  return out;
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

function parseSelectedMonitorKeys(selectedMonitorKeys: string): string[] {
  try {
    const parsed = JSON.parse(selectedMonitorKeys);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
  } catch {
    return [];
  }
}

async function getActiveMonitorRemovalSessionForCallback(
  ctx: DraftCallbackContext,
  env: Env,
  telegramId: number
): Promise<DbMonitorRemovalSession | null> {
  const session = await getMonitorRemovalSession(env.DB, telegramId);
  if (!session) {
    await ctx.answerCallbackQuery("No active removal list. Use /unsubscribe.");
    return null;
  }

  if (!isActiveDraftCallbackMessage(session.message_id, ctx.callbackQuery.message?.message_id)) {
    await ctx.answerCallbackQuery("This remove message is no longer active. Use /unsubscribe again.");
    return null;
  }

  return session;
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

function parsePageCallback(data: string, prefix: string): number | null {
  if (!data.startsWith(prefix)) {
    return null;
  }

  const page = Number.parseInt(data.slice(prefix.length), 10);
  return Number.isInteger(page) && page >= 0 ? page : null;
}

async function refreshUnsubscribeMessage(
  ctx: EditableCallbackContext,
  env: Env,
  telegramId: number,
  selectedMonitorKeys: string[],
  page: number
): Promise<void> {
  const result = await buildUnsubscribeReply(env, telegramId, selectedMonitorKeys, page);
  if (!result) {
    await deleteMonitorRemovalSession(env.DB, telegramId);
    await ctx.editMessageText("You have no active monitors.");
    return;
  }

  await ctx.editMessageText(result.text, {
    parse_mode: "HTML",
    reply_markup: result.keyboard,
  });
}

async function removeMarketMonitorForUser(
  env: Env,
  telegramId: number,
  monitorId: number
): Promise<DbMarketMonitor | null> {
  const monitor = await getMarketMonitor(env.DB, monitorId);
  if (!monitor || monitor.telegram_id !== telegramId || monitor.is_active !== 1) {
    return null;
  }

  const deps = webhookDeps(env);
  await removeMarketMonitor(env.DB, monitorId);
  if (monitor.struct_webhook_id) {
    const refCount = await countActiveMonitorWebhookReferences(env.DB, monitor.struct_webhook_id);
    if (refCount === 0) {
      await deleteMonitorWebhookStrict(deps, monitor.struct_webhook_id);
    } else {
      await removeConditionIdFromWebhook(deps, monitor.struct_webhook_id, monitor.condition_id);
    }
  }

  return monitor;
}

async function removeTraderMonitorForUser(
  env: Env,
  telegramId: number,
  monitorId: number
): Promise<DbTraderMonitor | null> {
  const monitor = await getTraderMonitor(env.DB, monitorId);
  if (!monitor || monitor.telegram_id !== telegramId || monitor.is_active !== 1) {
    return null;
  }

  const deps = webhookDeps(env);
  await removeTraderMonitor(env.DB, monitorId);
  await deleteOrphanedWebhookIdsStrict(env.DB, deps, [monitor.struct_webhook_id]);
  return monitor;
}

export function registerCallbackHandler(bot: Bot, env: Env): void {
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const telegramId = ctx.from.id;
    let errorContext: Record<string, unknown> = {
      callbackData: data,
      callbackMessageId: ctx.callbackQuery.message?.message_id ?? null,
      telegramId,
    };

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

        const existingFilters = parseDraftFilters(draft.filters);
        const filterPatch: Record<string, unknown> = {};

        if (draft.draft_type === "trader") {
          if (eventType === "trader_new_market") {
            filterPatch.min_usd_value = null;
            filterPatch.min_probability = null;
            filterPatch.max_probability = null;
          } else if (requiresMinUsd(eventType) && existingFilters.min_usd_value === undefined) {
            filterPatch.min_usd_value = 1;
          }
        }

        if (eventType === "probability_spike") {
          if (existingFilters.min_probability_change_pct === undefined) {
            filterPatch.min_probability_change_pct = 5;
          }
          if (existingFilters.window_secs === undefined) {
            filterPatch.window_secs = 60;
          }
          if (existingFilters.spike_direction === undefined) {
            filterPatch.spike_direction = "both";
          }
        } else if (eventType === "price_spike") {
          if (existingFilters.min_price_change_pct === undefined) {
            filterPatch.min_price_change_pct = 5;
          }
          if (existingFilters.window_secs === undefined) {
            filterPatch.window_secs = 60;
          }
          if (existingFilters.spike_direction === undefined) {
            filterPatch.spike_direction = "both";
          }
        } else if (eventType === "price_threshold") {
          if (existingFilters.min_price === undefined && existingFilters.max_price === undefined) {
            filterPatch.min_price = 0.9;
          }
        } else if (eventType === "condition_metrics") {
          if (existingFilters.min_volume_usd === undefined) {
            filterPatch.min_volume_usd = 10_000;
          }
          if (existingFilters.timeframes === undefined) {
            filterPatch.timeframes = ["5m"];
          }
        } else if (eventType === "market_volume_spike") {
          if (existingFilters.spike_ratio === undefined) {
            filterPatch.spike_ratio = 2;
          }
          if (existingFilters.timeframes === undefined) {
            filterPatch.timeframes = ["1h"];
          }
        } else if (eventType === "market_volume_milestone") {
          if (existingFilters.timeframes === undefined) {
            filterPatch.timeframes = ["24h"];
          }
        } else if (eventType === "trader_global_pnl") {
          if (existingFilters.timeframes === undefined) {
            filterPatch.timeframes = ["7d"];
          }
        } else if (eventType === "close_to_bond") {
          if (existingFilters.min_probability === undefined) {
            filterPatch.min_probability = 0.95;
          }
          if (existingFilters.max_probability === undefined) {
            filterPatch.max_probability = 1;
          }
        }

        await mergeDraftFilters(env.DB, telegramId, filterPatch);

        const filters = applyFilterPatch(existingFilters, filterPatch);
        await ctx.editMessageText(buildFilterText({ ...draft, event_type: eventType }), {
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

        if (config.type === "number" || config.type === "list") {
          await updateDraftAwaitingInput(env.DB, telegramId, filterName);
          await ctx.answerCallbackQuery();
          const prompt = config.type === "list"
            ? `Enter ${config.label} as a comma-separated list (e.g. crypto, politics):`
            : `Enter value for ${config.label}:`;
          const promptMsg = await ctx.reply(prompt);
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

      const monitorListPage = parsePageCallback(data, "mlp:");
      if (monitorListPage !== null) {
        const result = await buildMonitorListReply(env, telegramId, monitorListPage);
        await ctx.editMessageText(
          result?.text ?? "No active monitors. Send a condition ID or Polymarket URL to get started.",
          {
            parse_mode: "HTML",
            reply_markup: result?.keyboard,
          }
        );
        await ctx.answerCallbackQuery();
        return;
      }

      const unsubscribePage = parsePageCallback(data, "usp:");
      if (unsubscribePage !== null) {
        const session = await getActiveMonitorRemovalSessionForCallback(ctx, env, telegramId);
        if (!session) return;

        const monitorEntries = await getMonitorEntriesForUser(env, telegramId);
        const selectedMonitorKeys = sanitizeSelectedMonitorKeys(
          monitorEntries,
          parseSelectedMonitorKeys(session.selected_monitor_keys)
        );
        await updateMonitorRemovalSessionSelection(
          env.DB,
          telegramId,
          selectedMonitorKeys
        );
        await refreshUnsubscribeMessage(
          ctx,
          env,
          telegramId,
          selectedMonitorKeys,
          unsubscribePage
        );
        await ctx.answerCallbackQuery();
        return;
      }

      const monitorSelection = parseMonitorSelectionCallbackData(data);
      if (monitorSelection) {
        const session = await getActiveMonitorRemovalSessionForCallback(ctx, env, telegramId);
        if (!session) return;

        const monitorEntries = await getMonitorEntriesForUser(env, telegramId);
        const monitorKey = buildMonitorKey(monitorSelection.kind, monitorSelection.id);
        const validMonitorKeys = new Set(monitorEntries.map((entry) => entry.key));
        if (!validMonitorKeys.has(monitorKey)) {
          await ctx.answerCallbackQuery("Monitor not found.");
          return;
        }

        const selectedMonitorKeys = sanitizeSelectedMonitorKeys(
          monitorEntries,
          parseSelectedMonitorKeys(session.selected_monitor_keys)
        );
        const updatedSelection = selectedMonitorKeys.includes(monitorKey)
          ? selectedMonitorKeys.filter((key) => key !== monitorKey)
          : [...selectedMonitorKeys, monitorKey];

        await updateMonitorRemovalSessionSelection(
          env.DB,
          telegramId,
          updatedSelection
        );
        await refreshUnsubscribeMessage(
          ctx,
          env,
          telegramId,
          updatedSelection,
          monitorSelection.page
        );
        await ctx.answerCallbackQuery();
        return;
      }

      const selectAllPage = parsePageCallback(data, "usa:");
      if (selectAllPage !== null) {
        const session = await getActiveMonitorRemovalSessionForCallback(ctx, env, telegramId);
        if (!session) return;

        const monitorEntries = await getMonitorEntriesForUser(env, telegramId);
        const selectedMonitorKeys = sanitizeSelectedMonitorKeys(
          monitorEntries,
          parseSelectedMonitorKeys(session.selected_monitor_keys)
        );
        const updatedSelection = selectedMonitorKeys.length === monitorEntries.length
          ? []
          : monitorEntries.map((entry) => entry.key);

        await updateMonitorRemovalSessionSelection(
          env.DB,
          telegramId,
          updatedSelection
        );
        await refreshUnsubscribeMessage(
          ctx,
          env,
          telegramId,
          updatedSelection,
          selectAllPage
        );
        await ctx.answerCallbackQuery();
        return;
      }

      const confirmRemovalPage = parsePageCallback(data, "usc:");
      if (confirmRemovalPage !== null) {
        const session = await getActiveMonitorRemovalSessionForCallback(ctx, env, telegramId);
        if (!session) return;

        const monitorEntries = await getMonitorEntriesForUser(env, telegramId);
        const selectedMonitorKeys = sanitizeSelectedMonitorKeys(
          monitorEntries,
          parseSelectedMonitorKeys(session.selected_monitor_keys)
        );
        if (selectedMonitorKeys.length === 0) {
          await updateMonitorRemovalSessionSelection(env.DB, telegramId, []);
          await ctx.answerCallbackQuery("Select at least one monitor.");
          return;
        }

        errorContext = {
          ...errorContext,
          operation: "monitor_delete_selected",
          selectedMonitorKeys,
        };

        let removedCount = 0;
        for (const monitorKey of selectedMonitorKeys) {
          if (monitorKey.startsWith("market:")) {
            const monitorId = Number.parseInt(monitorKey.slice("market:".length), 10);
            if (!Number.isInteger(monitorId)) {
              continue;
            }

            const monitor = await removeMarketMonitorForUser(env, telegramId, monitorId);
            if (monitor) {
              removedCount++;
            }
            continue;
          }

          if (monitorKey.startsWith("trader:")) {
            const monitorId = Number.parseInt(monitorKey.slice("trader:".length), 10);
            if (!Number.isInteger(monitorId)) {
              continue;
            }

            const monitor = await removeTraderMonitorForUser(env, telegramId, monitorId);
            if (monitor) {
              removedCount++;
            }
          }
        }

        await updateMonitorRemovalSessionSelection(env.DB, telegramId, []);

        if (removedCount === 0) {
          await refreshUnsubscribeMessage(ctx, env, telegramId, [], confirmRemovalPage);
          await ctx.answerCallbackQuery("Selected monitors were already removed.");
          return;
        }

        await refreshUnsubscribeMessage(ctx, env, telegramId, [], confirmRemovalPage);
        await ctx.answerCallbackQuery(
          `Removed ${removedCount} monitor${removedCount === 1 ? "" : "s"}.`
        );
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
        errorContext = {
          ...errorContext,
          operation: "monitor_setup",
          draftType: draft.draft_type,
          eventType,
          filters: fullFilters,
        };

        if (eventType === "close_to_bond") {
          const minProbability = toFiniteNumber(fullFilters.min_probability);
          const maxProbability = toFiniteNumber(fullFilters.max_probability);
          if (minProbability === null && maxProbability === null) {
            await ctx.answerCallbackQuery("Close-to-Bond needs a min or max probability before it can be created.");
            return;
          }
        }

        if (eventType === "price_threshold") {
          const minPrice = toFiniteNumber(fullFilters.min_price);
          const maxPrice = toFiniteNumber(fullFilters.max_price);
          if (minPrice === null && maxPrice === null) {
            await ctx.answerCallbackQuery("Price Threshold needs a min or max price before it can be created.");
            return;
          }
        }

        if (eventType === "market_volume_spike" || eventType === "market_volume_milestone") {
          const timeframes = Array.isArray(fullFilters.timeframes) ? fullFilters.timeframes : [];
          if (timeframes.length === 0) {
            await ctx.answerCallbackQuery("Select at least one timeframe before creating this monitor.");
            return;
          }
        }

        if (draft.draft_type === "trader" && requiresMinUsd(eventType)) {
          const minUsd = toFiniteNumber(fullFilters.min_usd_value);
          if (minUsd === null || minUsd < 1) {
            await ctx.answerCallbackQuery("Min USD is required (minimum $1). Tap the Min USD button to set it.");
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
          const selectedMarkets = Array.isArray(filters._selected_markets)
            ? (filters._selected_markets as EventMarket[])
            : undefined;
          const marketsToCreate = selectedMarkets && selectedMarkets.length > 0
            ? selectedMarkets
            : draft.condition_id && draft.market_slug && draft.market_title
              ? [{ condition_id: draft.condition_id, market_slug: draft.market_slug, question: draft.market_title, title: draft.market_title }]
              : null;

          if (!marketsToCreate || marketsToCreate.length === 0) {
            await ctx.answerCallbackQuery("This monitor draft is missing market details. Start again from the market link.");
            return;
          }

          const allConditionIds = marketsToCreate.map((m) => m.condition_id);
          const batchFilters = { ...fullFilters, condition_ids: allConditionIds };
          const structFilters = normalizeStructWebhookFilters(eventType, batchFilters);

          const existingMonitorMap = new Map<string, DbMarketMonitor | null>();
          const candidateWebhookIdSet = new Set<string>();
          for (const market of marketsToCreate) {
            const existing = await getMarketMonitorByUserConditionAndEvent(env.DB, telegramId, market.condition_id, draft.event_type);
            existingMonitorMap.set(market.condition_id, existing ?? null);
            const candidates = await getMarketMonitorsByConditionAndEvent(env.DB, market.condition_id, draft.event_type);
            for (const c of candidates) {
              if (c.struct_webhook_id) candidateWebhookIdSet.add(c.struct_webhook_id);
            }
          }

          const firstTitle = marketsToCreate[0].question ?? marketsToCreate[0].title ?? "Unknown";
          const description = marketsToCreate.length === 1
            ? `${getEventTypeLabel(draft.event_type)} — ${firstTitle}`
            : `${getEventTypeLabel(draft.event_type)} — ${marketsToCreate.length} markets`;
          const expandedWebhookId = await findAndExpandWebhook(deps, eventType, batchFilters, allConditionIds, [...candidateWebhookIdSet]);
          const webhookId = expandedWebhookId ?? await createMonitorWebhook(deps, eventType, structFilters, description);
          const createdWebhook = expandedWebhookId === null;

          const createdNames: string[] = [];
          const oldWebhookIds: string[] = [];
          try {
            for (const market of marketsToCreate) {
              const marketTitle = market.question ?? market.title ?? "Unknown";
              await addMarketMonitor(
                env.DB,
                telegramId,
                market.condition_id,
                market.market_slug,
                marketTitle,
                draft.event_slug ?? "",
                draft.event_type,
                webhookId,
                { ...fullFilters, condition_ids: [market.condition_id] }
              );
              const existing = existingMonitorMap.get(market.condition_id);
              if (existing?.struct_webhook_id && existing.struct_webhook_id !== webhookId) {
                oldWebhookIds.push(existing.struct_webhook_id);
              }
              createdNames.push(marketTitle);
            }
          } catch (error) {
            if (createdWebhook && createdNames.length === 0) {
              await deleteMonitorWebhook(deps, webhookId);
            }
            throw error;
          }

          await deleteOrphanedWebhookIdsStrict(env.DB, deps, oldWebhookIds);
          await deleteDraft(env.DB, telegramId);

          const label = bold(getEventTypeLabel(draft.event_type));
          if (createdNames.length === 1) {
            await ctx.editMessageText(
              `Now monitoring ${label} for ${escapeHtml(createdNames[0])}`,
              { parse_mode: "HTML" }
            );
          } else {
            const list = createdNames.map((n) => `• ${escapeHtml(n)}`).join("\n");
            await ctx.editMessageText(
              `Created ${createdNames.length} ${label} monitors:\n\n${list}`,
              { parse_mode: "HTML" }
            );
          }
        } else {
          if (!draft.wallet_address) {
            await ctx.answerCallbackQuery("This monitor draft is missing a wallet address. Start again with /trader.");
            return;
          }

          fullFilters[traderScopeFilterKey(eventType)] = [draft.wallet_address];
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
          errorContext = {
            ...errorContext,
            draftType: "trader",
            walletAddress: draft.wallet_address,
            description,
            structFilters,
            existingWebhookId: existingMonitor?.struct_webhook_id ?? null,
            candidateWebhookIds: uniqueWebhookIds(candidateMonitors.map((monitor) => monitor.struct_webhook_id)),
            reusableWebhookId,
            webhookId,
            createdWebhook,
          };
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

      if (data.startsWith("emsp:")) {
        const page = parseInt(data.slice(5));
        const draft = await getActiveDraftForCallback(ctx, env, telegramId, "No active setup.");
        if (!draft) return;

        const filters = JSON.parse(draft.filters);
        const eventMarkets: EventMarket[] = filters._event_markets ?? [];
        const selectedIndices: number[] = filters._selected_indices ?? [];

        const eventTitle = filters._event_title ?? draft.event_slug ?? "Event";
        const keyboard = buildEventMarketSelectKeyboard(eventMarkets as { condition_id: string; question: string; title: string | null }[], selectedIndices, page);
        await ctx.editMessageText(
          `${bold(escapeHtml(eventTitle))}\n\nThis event has ${eventMarkets.length} markets. Select the ones you want to monitor:`,
          { parse_mode: "HTML", reply_markup: keyboard }
        );
        await ctx.answerCallbackQuery();
        return;
      }

      if (data.startsWith("emt:")) {
        const index = parseInt(data.slice(4));
        const draft = await getActiveDraftForCallback(ctx, env, telegramId, "No active setup.");
        if (!draft) return;

        const filters = JSON.parse(draft.filters);
        const eventMarkets: EventMarket[] = filters._event_markets ?? [];
        if (index < 0 || index >= eventMarkets.length) {
          await ctx.answerCallbackQuery("Invalid selection.");
          return;
        }

        const selectedIndices: number[] = filters._selected_indices ?? [];
        const updated = selectedIndices.includes(index)
          ? selectedIndices.filter((i) => i !== index)
          : [...selectedIndices, index];
        await updateDraftFilter(env.DB, telegramId, "_selected_indices", updated);

        const eventTitle = filters._event_title ?? draft.event_slug ?? "Event";
        const keyboard = buildEventMarketSelectKeyboard(eventMarkets as { condition_id: string; question: string; title: string | null }[], updated);
        await ctx.editMessageText(
          `${bold(escapeHtml(eventTitle))}\n\nThis event has ${eventMarkets.length} markets. Select the ones you want to monitor:`,
          { parse_mode: "HTML", reply_markup: keyboard }
        );
        await ctx.answerCallbackQuery();
        return;
      }

      if (data === "ema") {
        const draft = await getActiveDraftForCallback(ctx, env, telegramId, "No active setup.");
        if (!draft) return;

        const filters = JSON.parse(draft.filters);
        const eventMarkets: EventMarket[] = filters._event_markets ?? [];
        const selectedIndices: number[] = filters._selected_indices ?? [];

        const allSelected = selectedIndices.length === eventMarkets.length;
        const updated = allSelected ? [] : eventMarkets.map((_, i) => i);
        await updateDraftFilter(env.DB, telegramId, "_selected_indices", updated);

        const eventTitle = filters._event_title ?? draft.event_slug ?? "Event";
        const keyboard = buildEventMarketSelectKeyboard(eventMarkets as { condition_id: string; question: string; title: string | null }[], updated);
        await ctx.editMessageText(
          `${bold(escapeHtml(eventTitle))}\n\nThis event has ${eventMarkets.length} markets. Select the ones you want to monitor:`,
          { parse_mode: "HTML", reply_markup: keyboard }
        );
        await ctx.answerCallbackQuery();
        return;
      }

      if (data === "emc") {
        const draft = await getActiveDraftForCallback(ctx, env, telegramId, "No active setup.");
        if (!draft) return;

        const filters = JSON.parse(draft.filters);
        const eventMarkets: EventMarket[] = filters._event_markets ?? [];
        const selectedIndices: number[] = filters._selected_indices ?? [];

        if (selectedIndices.length === 0) {
          await ctx.answerCallbackQuery("Select at least one market.");
          return;
        }

        const selectedMarkets = selectedIndices
          .sort((a, b) => a - b)
          .map((i) => eventMarkets[i])
          .filter(Boolean);

        if (selectedMarkets.length === 1) {
          const market = selectedMarkets[0];
          const marketTitle = market.question ?? market.title ?? "Unknown";
          delete filters._event_markets;
          delete filters._event_title;
          delete filters._selected_indices;

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
        } else {
          const eventTitle = filters._event_title ?? draft.event_slug ?? "Event";
          const displayTitle = `${selectedMarkets.length} markets from ${eventTitle}`;
          delete filters._event_markets;
          delete filters._event_title;
          delete filters._selected_indices;
          filters._selected_markets = selectedMarkets;
          await env.DB.prepare(
            "UPDATE monitor_drafts SET market_title = ?, filters = ? WHERE telegram_id = ?"
          )
            .bind(displayTitle, JSON.stringify(filters), telegramId)
            .run();

          const eventTypes = draft.draft_type === "trader" ? TRADER_EVENT_TYPES : MARKET_EVENT_TYPES;
          await ctx.editMessageText(
            `${bold(escapeHtml(displayTitle))}\n\nSelect an event type:`,
            { parse_mode: "HTML", reply_markup: buildEventTypeKeyboard(eventTypes) }
          );
        }

        await ctx.answerCallbackQuery();
        return;
      }

      const legacyRemoval = parseMonitorRemovalCallbackData(data);
      if (legacyRemoval) {
        if (legacyRemoval.kind === "market") {
          const monitor = await getMarketMonitor(env.DB, legacyRemoval.id);
          if (!monitor || monitor.telegram_id !== telegramId || monitor.is_active !== 1) {
            await ctx.answerCallbackQuery("Monitor not found.");
            return;
          }

          errorContext = {
            ...errorContext,
            operation: "monitor_delete",
            monitorType: "market",
            monitorId: monitor.id,
            conditionId: monitor.condition_id,
            marketSlug: monitor.market_slug,
            marketTitle: monitor.market_title,
            eventSlug: monitor.event_slug,
            eventType: monitor.event_type,
            structWebhookId: monitor.struct_webhook_id,
            filters: parseStoredFilters(monitor.filters),
          };
          await removeMarketMonitorForUser(env, telegramId, legacyRemoval.id);
        } else {
          const monitor = await getTraderMonitor(env.DB, legacyRemoval.id);
          if (!monitor || monitor.telegram_id !== telegramId || monitor.is_active !== 1) {
            await ctx.answerCallbackQuery("Monitor not found.");
            return;
          }

          errorContext = {
            ...errorContext,
            operation: "monitor_delete",
            monitorType: "trader",
            monitorId: monitor.id,
            walletAddress: monitor.wallet_address,
            eventType: monitor.event_type,
            structWebhookId: monitor.struct_webhook_id,
            filters: parseStoredFilters(monitor.filters),
          };
          await removeTraderMonitorForUser(env, telegramId, legacyRemoval.id);
        }

        const callbackMessageId = ctx.callbackQuery.message?.message_id;
        if (typeof callbackMessageId === "number") {
          await createMonitorRemovalSession(env.DB, telegramId, callbackMessageId);
        }
        await refreshUnsubscribeMessage(ctx, env, telegramId, [], legacyRemoval.page);
        await ctx.answerCallbackQuery(
          `${legacyRemoval.kind === "market" ? "Market" : "Trader"} monitor removed.`
        );
        return;
      }

      if (data === "ua") {
        const deps = webhookDeps(env);
        const webhookIds = await getAllMonitorWebhookIds(env.DB, telegramId);
        errorContext = {
          ...errorContext,
          operation: "monitor_delete_all",
          webhookIds,
        };
        await removeAllMonitors(env.DB, telegramId);
        await deleteOrphanedWebhookIdsStrict(env.DB, deps, webhookIds);
        await deleteMonitorRemovalSession(env.DB, telegramId);
        await ctx.editMessageText("All monitors removed.", { parse_mode: "HTML" });
        await ctx.answerCallbackQuery();
        return;
      }

      await ctx.answerCallbackQuery("Unknown action.");
    } catch (error) {
      logError("Callback handler failure", errorContext, error);
      const msg = error instanceof Error ? error.message : "An error occurred";
      try {
        await ctx.answerCallbackQuery(msg.slice(0, 200));
      } catch (answerError) {
        logError("Failed to answer callback query after handler failure", errorContext, answerError);
      }
    }
  });
}
