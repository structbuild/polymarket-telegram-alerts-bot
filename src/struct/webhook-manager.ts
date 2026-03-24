import { HttpError } from "@structbuild/sdk";
import type { StructClient, PolymarketWebhookEvent, WebhookResponse } from "@structbuild/sdk";
import {
  areStructWebhookFiltersEqual,
  getStructWebhookReuseScore,
  normalizeStructWebhookFilters,
  type MonitorFilters,
} from "../services/monitor-filters";
import { logError } from "../utils/logging";

interface WebhookDeps {
  client: StructClient;
  webhookBaseUrl: string;
  webhookSecret: string;
}

const WEBHOOK_URL_PATH = "/struct/webhook";

function placeholderWebhookUrl(baseUrl: string): string {
  return `${baseUrl}${WEBHOOK_URL_PATH}/pending`;
}

export function webhookUrl(baseUrl: string, webhookId: string): string {
  return `${baseUrl}${WEBHOOK_URL_PATH}/${webhookId}`;
}

export async function createMonitorWebhook(
  deps: WebhookDeps,
  eventType: PolymarketWebhookEvent,
  filters: MonitorFilters,
  description: string
): Promise<string> {
  const createPayload = {
    url: placeholderWebhookUrl(deps.webhookBaseUrl),
    event: eventType,
    secret: deps.webhookSecret,
    filters,
    description,
  };

  let response: Awaited<ReturnType<WebhookDeps["client"]["webhooks"]["create"]>>;
  try {
    response = await deps.client.webhooks.create(createPayload);
  } catch (error) {
    logError("Failed to create Struct webhook", {
      eventType,
      description,
      filters,
      webhookBaseUrl: deps.webhookBaseUrl,
    }, error);
    throw error;
  }

  const webhookId = response.data.id;
  try {
    await deps.client.webhooks.update({
      webhookId,
      url: webhookUrl(deps.webhookBaseUrl, webhookId),
    });
  } catch (error) {
    await deleteMonitorWebhook(deps, webhookId);
    logError("Failed to update Struct webhook route", {
      webhookId,
      eventType,
      description,
      filters,
      webhookBaseUrl: deps.webhookBaseUrl,
      expectedUrl: webhookUrl(deps.webhookBaseUrl, webhookId),
    }, error);
    throw error;
  }

  return webhookId;
}

async function getWebhook(
  deps: WebhookDeps,
  webhookId: string
): Promise<WebhookResponse | null> {
  try {
    const response = await deps.client.webhooks.getWebhook({ webhookId });
    return response.data;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return null;
    }

    throw error;
  }
}

async function ensureWebhookRoute(
  deps: WebhookDeps,
  webhookId: string,
  currentUrl: string
): Promise<void> {
  const expectedUrl = webhookUrl(deps.webhookBaseUrl, webhookId);
  if (currentUrl === expectedUrl) {
    return;
  }

  await deps.client.webhooks.update({
    webhookId,
    url: expectedUrl,
  });
}

export async function findReusableMonitorWebhook(
  deps: WebhookDeps,
  eventType: PolymarketWebhookEvent,
  requestedFilters: MonitorFilters,
  candidateWebhookIds: string[]
): Promise<string | null> {
  let bestMatch: { webhookId: string; score: number; exact: boolean; url: string } | null = null;

  for (const webhookId of candidateWebhookIds) {
    const webhook = await getWebhook(deps, webhookId);
    if (!webhook || webhook.event !== eventType) {
      continue;
    }

    const existingFilters = normalizeStructWebhookFilters(eventType, webhook.filters ?? {});
    const score = getStructWebhookReuseScore(eventType, existingFilters, requestedFilters);
    if (score === null) {
      continue;
    }

    const exact = areStructWebhookFiltersEqual(eventType, existingFilters, requestedFilters);
    if (
      bestMatch === null ||
      score < bestMatch.score ||
      (score === bestMatch.score && exact && !bestMatch.exact) ||
      (score === bestMatch.score && exact === bestMatch.exact && webhookId < bestMatch.webhookId)
    ) {
      bestMatch = { webhookId, score, exact, url: webhook.url };
    }
  }

  if (!bestMatch) {
    return null;
  }

  await ensureWebhookRoute(deps, bestMatch.webhookId, bestMatch.url);
  return bestMatch.webhookId;
}

export async function findAndExpandWebhook(
  deps: WebhookDeps,
  eventType: PolymarketWebhookEvent,
  requestedFilters: MonitorFilters,
  allConditionIds: string[],
  candidateWebhookIds: string[]
): Promise<string | null> {
  const requestedNormalized = normalizeStructWebhookFilters(eventType, requestedFilters);
  const requestedCompare = { ...requestedNormalized };
  delete requestedCompare.condition_ids;

  for (const webhookId of candidateWebhookIds) {
    const webhook = await getWebhook(deps, webhookId);
    if (!webhook || webhook.event !== eventType) continue;

    const existingFilters = normalizeStructWebhookFilters(eventType, webhook.filters ?? {});
    const existingCompare = { ...existingFilters };
    delete existingCompare.condition_ids;

    if (JSON.stringify(existingCompare) !== JSON.stringify(requestedCompare)) continue;

    const sortedIds = [...new Set(allConditionIds)].sort();
    const existingIds = Array.isArray(existingFilters.condition_ids)
      ? [...new Set(existingFilters.condition_ids as string[])].sort()
      : [];

    const expectedUrl = webhookUrl(deps.webhookBaseUrl, webhookId);
    const needsUpdate = JSON.stringify(existingIds) !== JSON.stringify(sortedIds) || webhook.url !== expectedUrl;

    if (needsUpdate) {
      await deps.client.webhooks.update({
        webhookId,
        url: expectedUrl,
        event: webhook.event,
        description: webhook.description ?? undefined,
        filters: { ...existingFilters, condition_ids: sortedIds } as Record<string, unknown>,
      });
    }

    return webhookId;
  }

  return null;
}

export async function deleteMonitorWebhook(
  deps: WebhookDeps,
  webhookId: string
): Promise<void> {
  try {
    await deps.client.webhooks.deleteWebhook({ webhookId });
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return;
    }

    logError("Failed to delete Struct webhook", {
      webhookId,
      webhookBaseUrl: deps.webhookBaseUrl,
      expectedUrl: webhookUrl(deps.webhookBaseUrl, webhookId),
    }, error);
  }
}

export async function removeConditionIdFromWebhook(
  deps: WebhookDeps,
  webhookId: string,
  conditionId: string
): Promise<void> {
  const webhook = await getWebhook(deps, webhookId);
  if (!webhook?.filters) return;

  const filters = webhook.filters as Record<string, unknown>;
  const conditionIds = Array.isArray(filters.condition_ids) ? filters.condition_ids as string[] : [];
  const updated = conditionIds.filter((id) => id !== conditionId);

  if (updated.length === conditionIds.length) return;

  await deps.client.webhooks.update({
    webhookId,
    url: webhook.url,
    event: webhook.event,
    description: webhook.description ?? undefined,
    filters: { ...filters, condition_ids: updated } as Record<string, unknown>,
  });
}

export async function deleteMonitorWebhookStrict(
  deps: WebhookDeps,
  webhookId: string
): Promise<void> {
  try {
    await deps.client.webhooks.deleteWebhook({ webhookId });
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return;
    }

    throw error;
  }
}
