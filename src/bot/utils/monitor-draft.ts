import type { DbMonitorDraft } from "../../types/database";
import { bold, code, escapeHtml } from "../../utils/formatting";
import { MARKET_EVENT_TYPES, TRADER_EVENT_TYPES } from "../keyboards/filters";

const MIN_USD_REQUIRED_EVENTS = new Set([
  "trader_first_trade",
  "trader_new_trade",
]);

const LEGACY_EVENT_LABELS: Record<string, string> = {
  trader_whale_trade: "Whale Trade",
};

export function getEventTypeLabel(eventType: string): string {
  const all = [...MARKET_EVENT_TYPES, ...TRADER_EVENT_TYPES];
  return all.find((entry) => entry.key === eventType)?.label
    ?? LEGACY_EVENT_LABELS[eventType]
    ?? eventType;
}

export function requiresMinUsd(eventType: string | null): boolean {
  return eventType != null && MIN_USD_REQUIRED_EVENTS.has(eventType);
}

export function traderScopeFilterKey(eventType: string | null): "traders" | "wallet_addresses" {
  return eventType === "trader_global_pnl" ? "traders" : "wallet_addresses";
}

export function buildFilterText(
  draft: Pick<DbMonitorDraft, "draft_type" | "event_type" | "market_title" | "wallet_address">
): string {
  const label = getEventTypeLabel(draft.event_type ?? "");

  if (draft.draft_type === "trader") {
    const address = draft.wallet_address ?? "";
    if (requiresMinUsd(draft.event_type)) {
      return `${bold(label)} for trader ${code(address)}\n\nMin USD is required (minimum $1). Configure filters, then tap Create Monitor:`;
    }
    return `${bold(label)} for trader ${code(address)}\n\nConfigure filters (optional), then tap Create Monitor:`;
  }

  const title = draft.market_title ?? "Unknown Market";
  return `${bold(label)} for ${escapeHtml(title)}\n\nConfigure filters (optional), then tap Create Monitor:`;
}
