import { Bot } from "grammy";
import type {
  ConditionMetricsPayload,
  PriceSpikePayload,
  CloseToBondPayload,
  FirstTradePayload,
  NewMarketPayload,
  WhaleTradePayload,
  NewTradePayload,
  GlobalPnlPayload,
  MarketVolumeSpikePayload,
  VolumeMilestonePayload,
  WebhookSchemas,
  PolymarketWebhookEvent,
} from "@structbuild/sdk";
import { verifyWebhookSignature } from "../utils/hmac";
import {
  getMarketMonitorsByWebhookAndEvent,
  getTraderMonitorsByWebhookAndEvent,
  getTagMonitorsByWebhookAndEvent,
} from "../db/monitors";
import { notifySubscribers } from "../services/notification";
import { formatMessage, type MarketContext } from "../services/message-builder";
import { lookupByConditionId } from "../services/market-lookup";
import { createStructClient } from "./client";
import { matchesExcludeShortTerm } from "./filter-matchers";
import type { Env } from "../env";
import { parseStoredFilters, toFiniteNumber } from "../services/monitor-filters";

type PriceThresholdPayload = WebhookSchemas["PriceThresholdPayload"];

type WebhookPayload =
  | ConditionMetricsPayload
  | PriceSpikePayload
  | PriceThresholdPayload
  | CloseToBondPayload
  | FirstTradePayload
  | NewMarketPayload
  | WhaleTradePayload
  | NewTradePayload
  | GlobalPnlPayload
  | MarketVolumeSpikePayload
  | VolumeMilestonePayload;

function jsonResponse(status: number, body?: string): Response {
  return new Response(body ?? null, { status });
}

function createBot(env: Env): Bot {
  const bot = new Bot(env.BOT_TOKEN, { botInfo: JSON.parse(env.BOT_INFO) });
  bot.api.config.use((prev, method, payload, signal) =>
    prev(method, { ...payload, link_preview_options: { is_disabled: true } }, signal)
  );
  return bot;
}

const TRADER_EVENTS: PolymarketWebhookEvent[] = [
  "trader_first_trade",
  "trader_new_market",
  "trader_whale_trade",
  "trader_new_trade",
  "trader_global_pnl",
];
const SUPPORTED_EVENTS = new Set<PolymarketWebhookEvent>([
  "condition_metrics",
  "probability_spike",
  "price_spike",
  "price_threshold",
  "market_volume_spike",
  "market_volume_milestone",
  "close_to_bond",
  ...TRADER_EVENTS,
]);

type StoredFilters = Record<string, unknown>;

function isTraderEvent(eventType: PolymarketWebhookEvent): boolean {
  return TRADER_EVENTS.includes(eventType);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSupportedEvent(value: unknown): value is PolymarketWebhookEvent {
  return typeof value === "string" && SUPPORTED_EVENTS.has(value as PolymarketWebhookEvent);
}

function getString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function getNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => toFiniteNumber(entry))
    .filter((entry): entry is number => entry !== null);
}

function matchesStringList(
  filterValue: unknown,
  actual: string | null,
  normalize: (value: string) => string = (value) => value
): boolean {
  const expected = getStringArray(filterValue);
  if (expected.length === 0) return true;
  if (!actual) return false;
  const normalizedActual = normalize(actual);
  return expected.some((value) => normalize(value) === normalizedActual);
}

function matchesNumberList(filterValue: unknown, actual: number | null): boolean {
  const expected = getNumberArray(filterValue);
  if (expected.length === 0) return true;
  if (actual === null) return false;
  return expected.includes(actual);
}

function matchesMin(filterValue: unknown, actual: number | null): boolean {
  const min = toFiniteNumber(filterValue);
  if (min === null) return true;
  return actual !== null && actual >= min;
}

function matchesMax(filterValue: unknown, actual: number | null): boolean {
  const max = toFiniteNumber(filterValue);
  if (max === null) return true;
  return actual !== null && actual <= max;
}

function getTradeProbability(payload: Record<string, unknown>): number | null {
  return toFiniteNumber(payload.probability) ?? toFiniteNumber(payload.price);
}

function matchesMonitorFilters(
  eventType: PolymarketWebhookEvent,
  payload: Record<string, unknown>,
  filters: StoredFilters
): boolean {
  const conditionId = getString(payload, "condition_id");
  const eventSlug = getString(payload, "event_slug");
  const outcome = getString(payload, "outcome");
  const outcomeIndex = toFiniteNumber(payload.outcome_index);
  const positionId = getString(payload, "position_id");

  if (
    !matchesStringList(filters.condition_ids, conditionId) ||
    !matchesStringList(filters.event_slugs, eventSlug) ||
    !matchesStringList(filters.outcomes, outcome) ||
    !matchesNumberList(filters.position_outcome_indices, outcomeIndex) ||
    !matchesStringList(filters.position_ids, positionId) ||
    !matchesExcludeShortTerm(filters, eventSlug)
  ) {
    return false;
  }

  switch (eventType) {
    case "condition_metrics": {
      const timeframe = getString(payload, "timeframe");
      const volumeUsd = toFiniteNumber(payload.volume_usd);
      const fees = toFiniteNumber(payload.fees);
      const txns = toFiniteNumber(payload.txns);
      return (
        matchesStringList(filters.timeframes, timeframe) &&
        matchesMin(filters.min_volume_usd, volumeUsd) &&
        matchesMax(filters.max_volume_usd, volumeUsd) &&
        matchesMin(filters.min_fees, fees) &&
        matchesMin(filters.min_txns, txns)
      );
    }
    case "probability_spike": {
      const spikePct = toFiniteNumber(payload.spike_pct);
      const direction = getString(payload, "spike_direction");
      const spikeDirection = typeof filters.spike_direction === "string" ? filters.spike_direction : null;
      return (
        matchesMin(filters.min_probability_change_pct, spikePct === null ? null : Math.abs(spikePct)) &&
        (spikeDirection === null || spikeDirection === "both" || (direction !== null && direction === spikeDirection))
      );
    }
    case "price_spike": {
      const spikePct = toFiniteNumber(payload.spike_pct);
      const direction = getString(payload, "spike_direction");
      const expectedDirection = typeof filters.spike_direction === "string" ? filters.spike_direction : null;
      const currentPrice = toFiniteNumber(payload.current_price);
      return (
        matchesMin(filters.min_price_change_pct, spikePct === null ? null : Math.abs(spikePct)) &&
        matchesMin(filters.min_price, currentPrice) &&
        matchesMax(filters.max_price, currentPrice) &&
        (expectedDirection === null || expectedDirection === "both" || (direction !== null && direction === expectedDirection))
      );
    }
    case "price_threshold": {
      const price = getTradeProbability(payload);
      return matchesMin(filters.min_price, price) && matchesMax(filters.max_price, price);
    }
    case "market_volume_spike": {
      const timeframe = getString(payload, "timeframe");
      const snapshot = toFiniteNumber(payload.snapshot_volume_usd);
      const current = toFiniteNumber(payload.current_volume_usd);
      const ratio = snapshot !== null && snapshot > 0 && current !== null ? current / snapshot : null;
      return matchesStringList(filters.timeframes, timeframe) && matchesMin(filters.spike_ratio, ratio);
    }
    case "market_volume_milestone": {
      const timeframe = getString(payload, "timeframe");
      return matchesStringList(filters.timeframes, timeframe);
    }
    case "close_to_bond": {
      const probability = getTradeProbability(payload);
      return matchesMin(filters.min_probability, probability) && matchesMax(filters.max_probability, probability);
    }
    case "trader_first_trade":
    case "trader_new_market":
    case "trader_whale_trade":
    case "trader_new_trade": {
      const trader = getString(payload, "trader");
      const amountUsd = toFiniteNumber(payload.amount_usd);
      const probability = getTradeProbability(payload);
      return (
        matchesStringList(filters.wallet_addresses, trader, (value) => value.toLowerCase()) &&
        matchesMin(filters.min_usd_value, amountUsd) &&
        matchesMin(filters.min_probability, probability) &&
        matchesMax(filters.max_probability, probability)
      );
    }
    case "trader_global_pnl": {
      const trader = getString(payload, "trader");
      const timeframe = getString(payload, "timeframe");
      const realizedPnl = toFiniteNumber(payload.realized_pnl_usd);
      const volumeUsd = toFiniteNumber(payload.total_volume_usd);
      return (
        matchesStringList(filters.traders, trader, (value) => value.toLowerCase()) &&
        matchesStringList(filters.timeframes, timeframe) &&
        matchesMin(filters.min_realized_pnl_usd, realizedPnl) &&
        matchesMin(filters.min_volume_usd, volumeUsd)
      );
    }
  }

  return false;
}

function detectEventType(
  payload: Record<string, unknown>,
  header: string | null
): PolymarketWebhookEvent | null {
  if (isSupportedEvent(header)) return header;

  const payloadEvent = payload.event_type ?? payload.event;
  if (isSupportedEvent(payloadEvent)) return payloadEvent;

  if ("bond_side" in payload && "threshold" in payload) {
    return "close_to_bond";
  }

  if ("volume_usd" in payload && "timeframe" in payload && "condition_id" in payload) {
    return "condition_metrics";
  }

  return null;
}

function matchingSubscribers(
  monitors: { filters: string; telegram_id: number }[],
  eventType: PolymarketWebhookEvent,
  payload: WebhookPayload
): number[] {
  return monitors
    .filter((monitor) => matchesMonitorFilters(eventType, payload as Record<string, unknown>, parseStoredFilters(monitor.filters)))
    .map((monitor) => monitor.telegram_id);
}

async function collectSubscribers(
  db: D1Database,
  webhookId: string,
  eventType: PolymarketWebhookEvent,
  payload: WebhookPayload
): Promise<number[]> {
  if (isTraderEvent(eventType)) {
    const monitors = await getTraderMonitorsByWebhookAndEvent(db, webhookId, eventType);
    return [...new Set(matchingSubscribers(monitors, eventType, payload))];
  }

  const [marketMonitors, tagMonitors] = await Promise.all([
    getMarketMonitorsByWebhookAndEvent(db, webhookId, eventType),
    getTagMonitorsByWebhookAndEvent(db, webhookId, eventType),
  ]);
  return [
    ...new Set([
      ...matchingSubscribers(marketMonitors, eventType, payload),
      ...matchingSubscribers(tagMonitors, eventType, payload),
    ]),
  ];
}

function extractConditionId(payload: Record<string, unknown>): string | null {
  const id = payload.condition_id;
  return typeof id === "string" ? id : null;
}

async function enrichWithMarketData(
  env: Env,
  payload: Record<string, unknown>
): Promise<MarketContext | null> {
  const conditionId = extractConditionId(payload);
  if (!conditionId) return null;

  try {
    const client = createStructClient(env.STRUCT_API_KEY);
    const market = await lookupByConditionId(client, conditionId);
    if (!market) return null;
    return {
      question: market.question,
      event_slug: market.event_slug,
      market_slug: market.market_slug,
      image_url: market.image_url,
      outcomes: market.outcomes?.map((o) => ({ name: o.name, price: o.price })) ?? [],
    };
  } catch {
    return null;
  }
}

export async function handleStructWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  webhookId: string
): Promise<Response> {
  const body = await request.text();

  const signature =
    request.headers.get("x-struct-signature") ??
    request.headers.get("x-webhook-signature");

  if (!signature) {
    return jsonResponse(401);
  }

  const valid = await verifyWebhookSignature(body, signature, env.STRUCT_WEBHOOK_SECRET);
  if (!valid) {
    return jsonResponse(401);
  }

  const raw = JSON.parse(body) as Record<string, unknown>;
  const envelope = isSupportedEvent(raw.event) && isRecord(raw.data)
    ? { event: raw.event, data: raw.data }
    : null;
  const eventType = envelope
    ? envelope.event
    : detectEventType(raw, request.headers.get("x-webhook-event"));
  const payload = envelope
    ? envelope.data
    : raw;
  if (!eventType) return jsonResponse(200);

  console.log(
    JSON.stringify({
      scope: "struct_webhook",
      webhookId,
      eventType,
      xWebhookEvent: request.headers.get("x-webhook-event"),
      body,
    })
  );

  const market = await enrichWithMarketData(env, payload);

  const result = formatMessage(eventType, payload as WebhookPayload, market);
  if (!result) return jsonResponse(200);

  ctx.waitUntil(
    collectSubscribers(env.DB, webhookId, eventType, payload as WebhookPayload).then(
      (subscribers) => {
        if (subscribers.length === 0) return;
        const bot = createBot(env);
        return notifySubscribers(bot, subscribers, result.text, result.imageUrl, result.keyboard);
      }
    ).catch((err) => {
      console.error("Webhook processing error:", err);
    })
  );

  return jsonResponse(200);
}
