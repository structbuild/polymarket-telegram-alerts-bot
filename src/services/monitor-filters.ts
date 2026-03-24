import type { PolymarketWebhookEvent } from "@structbuild/sdk";

export type MonitorFilters = Record<string, unknown>;

const MIN_FILTER_FIELDS = new Set([
  "min_usd_value",
  "min_probability",
  "min_probability_change_pct",
  "min_price_change_pct",
  "min_volume_usd",
  "min_fees",
  "min_txns",
]);

const MAX_FILTER_FIELDS = new Set([
  "max_probability",
  "max_volume_usd",
]);

const EXACT_LIST_FIELDS = new Set([
  "condition_ids",
  "wallet_addresses",
]);

const SUBSET_LIST_FIELDS = new Set([
  "event_slugs",
  "outcomes",
  "position_ids",
  "position_outcome_indices",
  "timeframes",
]);

const EXACT_SCALAR_FIELDS = new Set([
  "window_secs",
]);

const KNOWN_FILTER_FIELDS = new Set([
  ...MIN_FILTER_FIELDS,
  ...MAX_FILTER_FIELDS,
  ...EXACT_LIST_FIELDS,
  ...SUBSET_LIST_FIELDS,
  ...EXACT_SCALAR_FIELDS,
  "exclude_shortterm_markets",
  "spike_direction",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseStoredFilters(filters: unknown): MonitorFilters {
  if (typeof filters === "string") {
    try {
      const parsed = JSON.parse(filters) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  return isRecord(filters) ? filters : {};
}

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeStringArray(
  value: unknown,
  normalize: (entry: string) => string = (entry) => entry
): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .map((entry) => normalize(entry))
  )].sort();
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((entry) => toFiniteNumber(entry))
      .filter((entry): entry is number => entry !== null)
  )].sort((a, b) => a - b);
}

function normalizeListField(key: string, value: unknown): string[] | number[] {
  if (key === "wallet_addresses") {
    return normalizeStringArray(value, (entry) => entry.toLowerCase());
  }
  if (key === "position_outcome_indices") {
    return normalizeNumberArray(value);
  }
  return normalizeStringArray(value);
}

function listValuesEqual(key: string, left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeListField(key, left);
  const normalizedRight = normalizeListField(key, right);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function isListSuperset(key: string, existingValue: unknown, requestedValue: unknown): boolean {
  const existing = normalizeListField(key, existingValue);
  const requested = normalizeListField(key, requestedValue);

  if (requested.length === 0) {
    return existing.length === 0;
  }

  if (existing.length === 0) {
    return true;
  }

  const existingValues = new Set(existing.map((value) => String(value)));
  return requested.every((value) => existingValues.has(String(value)));
}

function canonicalScalarValue(value: unknown): unknown {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  return value;
}

function normalizeSpikeDirection(
  eventType: PolymarketWebhookEvent,
  value: unknown
): "up" | "down" | "both" | null {
  if (eventType !== "probability_spike" && eventType !== "price_spike") {
    return typeof value === "string" && value.length > 0 ? value as "up" | "down" | "both" : null;
  }

  if (value === "up" || value === "down" || value === "both") {
    return value;
  }

  return "both";
}

function minReusePenalty(existingValue: unknown, requestedValue: unknown): number | null {
  const existing = toFiniteNumber(existingValue);
  const requested = toFiniteNumber(requestedValue);

  if (requested === null) {
    return existing === null ? 0 : null;
  }

  if (existing === null) {
    return 1000 + requested;
  }

  if (existing > requested) {
    return null;
  }

  return requested - existing;
}

function maxReusePenalty(existingValue: unknown, requestedValue: unknown): number | null {
  const existing = toFiniteNumber(existingValue);
  const requested = toFiniteNumber(requestedValue);

  if (requested === null) {
    return existing === null ? 0 : null;
  }

  if (existing === null) {
    return 1000 + (1 - requested);
  }

  if (existing < requested) {
    return null;
  }

  return existing - requested;
}

function directionReusePenalty(
  eventType: PolymarketWebhookEvent,
  existingValue: unknown,
  requestedValue: unknown
): number | null {
  const existing = normalizeSpikeDirection(eventType, existingValue);
  const requested = normalizeSpikeDirection(eventType, requestedValue);

  if (requested === null) {
    return existing === null ? 0 : null;
  }

  if (existing === requested) {
    return 0;
  }

  if (existing === "both") {
    return 1;
  }

  return null;
}

function excludeShortTermReusePenalty(existingValue: unknown, requestedValue: unknown): number | null {
  const existing = existingValue === true;
  const requested = requestedValue === true;

  if (!requested && existing) {
    return null;
  }

  return existing === requested ? 0 : 1;
}

export function normalizeStructWebhookFilters(
  eventType: PolymarketWebhookEvent,
  filters: MonitorFilters
): MonitorFilters {
  const normalized: MonitorFilters = {};

  for (const key of Object.keys(filters).sort()) {
    const value = filters[key];
    if (value === null || value === undefined) {
      continue;
    }

    if (EXACT_LIST_FIELDS.has(key) || SUBSET_LIST_FIELDS.has(key)) {
      const list = normalizeListField(key, value);
      if (list.length > 0) {
        normalized[key] = list;
      }
      continue;
    }

    if (MIN_FILTER_FIELDS.has(key)) {
      const numeric = toFiniteNumber(value);
      if (numeric !== null && numeric > 0) {
        normalized[key] = numeric;
      }
      continue;
    }

    if (MAX_FILTER_FIELDS.has(key)) {
      const numeric = toFiniteNumber(value);
      if (numeric !== null && !(key === "max_probability" && numeric >= 1)) {
        normalized[key] = numeric;
      }
      continue;
    }

    if (EXACT_SCALAR_FIELDS.has(key)) {
      const numeric = toFiniteNumber(value);
      if (numeric !== null) {
        normalized[key] = numeric;
      }
      continue;
    }

    if (key === "exclude_shortterm_markets") {
      if (value === true) {
        normalized[key] = true;
      }
      continue;
    }

    if (key === "spike_direction") {
      normalized[key] = normalizeSpikeDirection(eventType, value);
      continue;
    }

    normalized[key] = canonicalScalarValue(value);
  }

  if (
    (eventType === "probability_spike" || eventType === "price_spike") &&
    normalized.spike_direction === undefined
  ) {
    normalized.spike_direction = normalizeSpikeDirection(eventType, undefined);
  }

  return normalized;
}

export function areStructWebhookFiltersEqual(
  eventType: PolymarketWebhookEvent,
  left: MonitorFilters,
  right: MonitorFilters
): boolean {
  return JSON.stringify(normalizeStructWebhookFilters(eventType, left)) ===
    JSON.stringify(normalizeStructWebhookFilters(eventType, right));
}

export function getStructWebhookReuseScore(
  eventType: PolymarketWebhookEvent,
  existingFilters: MonitorFilters,
  requestedFilters: MonitorFilters
): number | null {
  const existing = normalizeStructWebhookFilters(eventType, existingFilters);
  const requested = normalizeStructWebhookFilters(eventType, requestedFilters);
  let score = 0;

  for (const key of EXACT_LIST_FIELDS) {
    if (!listValuesEqual(key, existing[key], requested[key])) {
      return null;
    }
  }

  for (const key of SUBSET_LIST_FIELDS) {
    if (!isListSuperset(key, existing[key], requested[key])) {
      return null;
    }

    const existingList = normalizeListField(key, existing[key]);
    const requestedList = normalizeListField(key, requested[key]);
    if (requestedList.length === 0) {
      score += 0;
    } else if (existingList.length === 0) {
      score += 1000;
    } else {
      score += existingList.length - requestedList.length;
    }
  }

  for (const key of MIN_FILTER_FIELDS) {
    const penalty = minReusePenalty(existing[key], requested[key]);
    if (penalty === null) {
      return null;
    }
    score += penalty;
  }

  for (const key of MAX_FILTER_FIELDS) {
    const penalty = maxReusePenalty(existing[key], requested[key]);
    if (penalty === null) {
      return null;
    }
    score += penalty;
  }

  for (const key of EXACT_SCALAR_FIELDS) {
    if (toFiniteNumber(existing[key]) !== toFiniteNumber(requested[key])) {
      return null;
    }
  }

  const directionPenalty = directionReusePenalty(eventType, existing.spike_direction, requested.spike_direction);
  if (directionPenalty === null) {
    return null;
  }
  score += directionPenalty;

  const excludePenalty = excludeShortTermReusePenalty(
    existing.exclude_shortterm_markets,
    requested.exclude_shortterm_markets
  );
  if (excludePenalty === null) {
    return null;
  }
  score += excludePenalty;

  for (const key of new Set([...Object.keys(existing), ...Object.keys(requested)])) {
    if (KNOWN_FILTER_FIELDS.has(key)) {
      continue;
    }

    if (JSON.stringify(existing[key]) !== JSON.stringify(requested[key])) {
      return null;
    }
  }

  return score;
}
