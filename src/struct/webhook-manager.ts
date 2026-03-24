import { HttpError } from "@structbuild/sdk";
import type { StructClient, PolymarketWebhookEvent, WebhookResponse } from "@structbuild/sdk";
import {
  areStructWebhookFiltersEqual,
  getStructWebhookReuseScore,
  normalizeStructWebhookFilters,
  type MonitorFilters,
} from "../services/monitor-filters";

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
  const response = await deps.client.webhooks.create({
    url: placeholderWebhookUrl(deps.webhookBaseUrl),
    event: eventType,
    secret: deps.webhookSecret,
    filters,
    description,
  });

  const webhookId = response.data.id;
  try {
    await deps.client.webhooks.update({
      webhookId,
      url: webhookUrl(deps.webhookBaseUrl, webhookId),
    });
  } catch (error) {
    await deleteMonitorWebhook(deps, webhookId);
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

    console.error("Failed to delete Struct webhook", webhookId, error);
  }
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
