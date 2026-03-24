import { InlineKeyboard } from "grammy";
import type { PolymarketWebhookEvent } from "@structbuild/sdk";

export const MARKET_EVENT_TYPES: { key: PolymarketWebhookEvent; label: string }[] = [
  { key: "probability_spike", label: "Probability Spike" },
  { key: "price_spike", label: "Price Spike" },
  { key: "condition_metrics", label: "Market Metrics" },
  { key: "close_to_bond", label: "Close-to-Bond" },
];

export const TRADER_EVENT_TYPES: { key: PolymarketWebhookEvent; label: string }[] = [
  { key: "trader_first_trade", label: "First Trade" },
  { key: "trader_new_market", label: "New Market Entry" },
  { key: "trader_whale_trade", label: "Trade" },
];

export interface FilterConfig {
  key: string;
  label: string;
  type: "number" | "boolean" | "enum" | "multi";
  options?: { value: string; label: string }[];
  wide?: boolean;
}

const SPIKE_DIRECTION_OPTIONS = [
  { value: "both", label: "Both" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];

const TIMEFRAME_OPTIONS = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

export const FILTER_CONFIGS: Record<string, FilterConfig[]> = {
  probability_spike: [
    { key: "min_probability_change_pct", label: "Min Change %", type: "number" },
    { key: "spike_direction", label: "Direction", type: "enum", options: SPIKE_DIRECTION_OPTIONS },
    { key: "window_secs", label: "Window (secs)", type: "number" },
    { key: "exclude_shortterm_markets", label: "Excl. Short-term", type: "boolean" },
  ],
  price_spike: [
    { key: "min_price_change_pct", label: "Min Change %", type: "number" },
    { key: "spike_direction", label: "Direction", type: "enum", options: SPIKE_DIRECTION_OPTIONS },
    { key: "window_secs", label: "Window (secs)", type: "number" },
    { key: "exclude_shortterm_markets", label: "Excl. Short-term", type: "boolean" },
  ],
  condition_metrics: [
    { key: "min_volume_usd", label: "Min Volume $", type: "number" },
    { key: "max_volume_usd", label: "Max Volume $", type: "number" },
    { key: "min_fees", label: "Min Fees $", type: "number" },
    { key: "min_txns", label: "Min Txns", type: "number" },
    { key: "timeframes", label: "Timeframes", type: "multi", options: TIMEFRAME_OPTIONS, wide: true },
  ],
  close_to_bond: [
    { key: "min_probability", label: "Min Probability", type: "number" },
    { key: "max_probability", label: "Max Probability", type: "number" },
    { key: "exclude_shortterm_markets", label: "Excl. Short-term", type: "boolean" },
  ],
  trader_first_trade: [
    { key: "min_usd_value", label: "Min USD", type: "number" },
    { key: "min_probability", label: "Min Prob", type: "number" },
    { key: "max_probability", label: "Max Prob", type: "number" },
    { key: "exclude_shortterm_markets", label: "Excl. Short-term", type: "boolean" },
  ],
  trader_new_market: [
    { key: "exclude_shortterm_markets", label: "Excl. Short-term", type: "boolean" },
  ],
  trader_whale_trade: [
    { key: "min_usd_value", label: "Min USD", type: "number" },
    { key: "min_probability", label: "Min Prob", type: "number" },
    { key: "max_probability", label: "Max Prob", type: "number" },
    { key: "exclude_shortterm_markets", label: "Excl. Short-term", type: "boolean" },
  ],
};

export function buildEventTypeKeyboard(
  eventTypes: { key: string; label: string }[]
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let i = 0; i < eventTypes.length; i++) {
    kb.text(eventTypes[i].label, `et:${eventTypes[i].key}`);
    if (i % 2 === 1 || i === eventTypes.length - 1) {
      kb.row();
    }
  }
  return kb;
}

export function buildFilterKeyboard(
  eventType: string,
  currentFilters: Record<string, unknown>
): InlineKeyboard {
  const configs = FILTER_CONFIGS[eventType] ?? [];
  const kb = new InlineKeyboard();
  let rowCount = 0;

  for (const config of configs) {
    const value = currentFilters[config.key];
    let buttonLabel = config.label;

    if (config.type === "boolean") {
      const isOn = value === true || value === "true";
      buttonLabel = `${config.label}: ${value !== undefined ? (isOn ? "On" : "Off") : "Off"}`;
      kb.text(buttonLabel, `fb:${config.key}:toggle`);
    } else if (config.type === "enum") {
      if (value !== undefined) {
        const opt = config.options?.find((o) => o.value === value);
        buttonLabel = `${config.label}: ${opt?.label ?? value}`;
      }
      kb.text(buttonLabel, `ft:${config.key}`);
    } else if (config.type === "multi") {
      if (Array.isArray(value) && value.length > 0) {
        buttonLabel = `${config.label}: ${value.join(", ")}`;
      }
      kb.text(buttonLabel, `ft:${config.key}`);
    } else {
      if (value !== undefined) {
        buttonLabel = `${config.label}: ${value}`;
      }
      kb.text(buttonLabel, `ft:${config.key}`);
    }

    if (config.wide) {
      kb.row();
      rowCount = 0;
    } else {
      rowCount++;
      if (rowCount === 2) {
        kb.row();
        rowCount = 0;
      }
    }
  }

  if (rowCount > 0) {
    kb.row();
  }

  kb.text("✅ Create Monitor", "sub:confirm").row();
  kb.text("❌ Cancel", "sub:cancel");
  return kb;
}

export function buildEnumOptionsKeyboard(
  filterKey: string,
  options: { value: string; label: string }[]
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const opt of options) {
    kb.text(opt.label, `fb:${filterKey}:${opt.value}`).row();
  }
  kb.text("Cancel", `fb:${filterKey}:cancel`);
  return kb;
}

export function buildMultiOptionsKeyboard(
  filterKey: string,
  options: { value: string; label: string }[],
  selected: string[]
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const opt of options) {
    const isSelected = selected.includes(opt.value);
    const label = isSelected ? `${opt.label} ✓` : opt.label;
    kb.text(label, `fb:${filterKey}:${opt.value}`).row();
  }
  kb.text("Done", `fb:${filterKey}:done`);
  return kb;
}

const EVENT_MARKET_PAGE_SIZE = 8;

export function buildEventMarketKeyboard(
  markets: { condition_id: string; question: string; title: string | null }[],
  page = 0
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const totalPages = Math.ceil(markets.length / EVENT_MARKET_PAGE_SIZE);
  const start = page * EVENT_MARKET_PAGE_SIZE;
  const pageMarkets = markets.slice(start, start + EVENT_MARKET_PAGE_SIZE);

  for (let i = 0; i < pageMarkets.length; i++) {
    const market = pageMarkets[i];
    let label = market.question || market.title || "Untitled";
    if (label.length > 40) {
      label = label.slice(0, 37) + "...";
    }
    kb.text(label, `em:${start + i}`).row();
  }

  if (totalPages > 1) {
    if (page > 0) kb.text("« Prev", `emp:${page - 1}`);
    kb.text(`${page + 1}/${totalPages}`, "noop");
    if (page < totalPages - 1) kb.text("Next »", `emp:${page + 1}`);
    kb.row();
  }

  return kb;
}

export function buildEventMarketSelectKeyboard(
  markets: { condition_id: string; question: string; title: string | null }[],
  selectedIndices: number[],
  page = 0
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const totalPages = Math.ceil(markets.length / EVENT_MARKET_PAGE_SIZE);
  const start = page * EVENT_MARKET_PAGE_SIZE;
  const pageMarkets = markets.slice(start, start + EVENT_MARKET_PAGE_SIZE);

  for (let i = 0; i < pageMarkets.length; i++) {
    const globalIndex = start + i;
    const market = pageMarkets[i];
    const isSelected = selectedIndices.includes(globalIndex);
    let label = market.title || market.question || "Untitled";
    if (label.length > 36) {
      label = label.slice(0, 33) + "...";
    }
    kb.text(`${isSelected ? "☑️" : "⏹️"} ${label}`, `emt:${globalIndex}`).row();
  }

  if (totalPages > 1) {
    if (page > 0) kb.text("« Prev", `emsp:${page - 1}`);
    kb.text(`${page + 1}/${totalPages}`, "noop");
    if (page < totalPages - 1) kb.text("Next »", `emsp:${page + 1}`);
    kb.row();
  }

  const allSelected = selectedIndices.length === markets.length;
  kb.text(allSelected ? "Deselect All" : "Select All", "ema").row();

  if (selectedIndices.length > 0) {
    const count = selectedIndices.length;
    kb.text(`Continue with ${count} market${count > 1 ? "s" : ""} →`, "emc");
  } else {
    kb.text("Select at least one market", "noop");
  }

  return kb;
}
