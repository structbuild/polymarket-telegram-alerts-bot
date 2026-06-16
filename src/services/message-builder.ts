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
import {
  bold,
  italic,
  code,
  escapeHtml,
  formatPercentage,
  formatUsd,
  formatShares,
  link,
} from "../utils/formatting";
import { toFiniteNumber } from "./monitor-filters";

const POLYMARKET_URL = "https://polymarket.com/event";
const POLYGONSCAN_TX = "https://polygonscan.com/tx";
const POLYGONSCAN_ADDR = "https://polygonscan.com/address";

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

export interface OutcomePrice {
  name: string;
  price: number | null;
}

export interface MarketContext {
  question?: string | null;
  event_slug?: string | null;
  image_url?: string | null;
  outcomes?: OutcomePrice[];
}

export interface FormattedMessage {
  text: string;
  imageUrl: string | null;
}

function marketLink(
  title: string,
  eventSlug: string | null | undefined
): string {
  if (!eventSlug) return bold(escapeHtml(title));
  return link(escapeHtml(title), `${POLYMARKET_URL}/${eventSlug}`);
}

function linksSection(
  eventSlug?: string | null,
  hash?: string | null,
  trader?: string | null
): string {
  const parts: string[] = [];
  if (eventSlug) parts.push(link("Polymarket", `${POLYMARKET_URL}/${eventSlug}`));
  if (hash) parts.push(link("TX Hash", `${POLYGONSCAN_TX}/${hash}`));
  if (trader) parts.push(link("Wallet", `${POLYGONSCAN_ADDR}/${trader}`));
  if (parts.length === 0) return "";
  return `🔗 ${parts.join(" | ")}`;
}

function outcomePricesLine(outcomes?: OutcomePrice[]): string | null {
  if (!outcomes || outcomes.length === 0) return null;
  const parts = outcomes
    .filter((o) => o.price != null)
    .map((o) => `${escapeHtml(o.name)}: ${code(`${(o.price! * 100).toFixed(1)}¢`)}`);
  if (parts.length === 0) return null;
  return `📊 ${parts.join(" / ")}`;
}

type SpikePayload = PriceSpikePayload;
type TraderPayload = FirstTradePayload | NewMarketPayload | WhaleTradePayload | NewTradePayload;

function formatSpikeLevelDisplay(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function spikeLevels(payload: SpikePayload): { previous: number | null; current: number | null } {
  return {
    previous: toFiniteNumber(payload.previous_price),
    current: toFiniteNumber(payload.current_price),
  };
}

function buildSpikeMessage(
  title: string,
  payload: SpikePayload,
  market: MarketContext | null
): string {
  const direction = payload.spike_direction === "up" ? "UP" : "DOWN";
  const directionEmoji = payload.spike_direction === "up" ? "📈" : "📉";
  const spikePct = toFiniteNumber(payload.spike_pct) ?? Number.NaN;
  const change = Number.isFinite(spikePct)
    ? `${spikePct > 0 ? "+" : ""}${spikePct.toFixed(2)}%`
    : "—";
  const question = market?.question ?? null;
  const eventSlug = payload.event_slug ?? market?.event_slug ?? null;
  const { previous: previousValue, current: currentValue } = spikeLevels(payload);
  const rangeLine = `📊 ${code(formatSpikeLevelDisplay(previousValue))} → ${code(formatSpikeLevelDisplay(currentValue))} (${code(change)})`;

  const lines = [
    `${directionEmoji} ${bold(`${title} ${direction}`)}`,
  ];

  if (question) {
    lines.push("", marketLink(question, eventSlug));
  }

  lines.push(
    "",
    `🎯 Outcome: ${bold(escapeHtml(payload.outcome ?? ""))}`,
    rangeLine,
  );

  const linkLine = linksSection(eventSlug);
  if (linkLine) lines.push("", linkLine);

  return lines.join("\n");
}

function buildTraderMessage(emoji: string, title: string, payload: TraderPayload, market: MarketContext | null): string {
  const sideEmoji = payload.side.toLowerCase() === "buy" ? "🟢" : "🔴";
  const question = payload.question ?? market?.question ?? null;
  const eventSlug = payload.event_slug ?? market?.event_slug ?? null;

  const lines = [
    `${emoji} ${bold(title)}`,
  ];

  if (question) {
    lines.push("", marketLink(question, eventSlug));
  }

  const prices = outcomePricesLine(market?.outcomes);
  if (prices) lines.push(prices);

  lines.push(
    "",
    `👤 ${code(payload.trader)}`,
    `🏷 Outcome: ${bold(escapeHtml(payload.outcome ?? ""))}`,
    `${sideEmoji} Side: ${italic(escapeHtml(payload.side))}`,
    `💵 Amount: ${code(formatUsd(payload.amount_usd))}`,
    `💲 Price: ${code(formatPercentage(payload.price))}`,
  );

  if (payload.shares_amount) {
    lines.push(`📦 Shares: ${code(formatShares(payload.shares_amount))}`);
  }

  lines.push("", linksSection(eventSlug, payload.hash, payload.trader));

  return lines.join("\n");
}

function buildPriceThresholdMessage(payload: PriceThresholdPayload, market: MarketContext | null): string {
  const direction = String(payload.direction ?? "").toLowerCase();
  const directionEmoji = direction === "down" ? "📉" : "📈";
  const question = payload.question ?? market?.question ?? null;
  const eventSlug = payload.event_slug ?? market?.event_slug ?? null;

  const lines = [
    `${directionEmoji} ${bold("Price Threshold Crossed")}`,
  ];

  if (question) {
    lines.push("", marketLink(question, eventSlug));
  }

  lines.push(
    "",
    `🎯 Outcome: ${bold(escapeHtml(payload.outcome ?? ""))}`,
    `📊 ${code(formatPercentage(payload.previous_price))} → ${code(formatPercentage(payload.price))}`,
    `🚩 Threshold: ${code(formatPercentage(payload.threshold))}`,
  );

  lines.push("", linksSection(eventSlug, payload.hash, payload.trader));

  return lines.join("\n");
}

function buildVolumeSpikeMessage(payload: MarketVolumeSpikePayload, market: MarketContext | null): string {
  const question = payload.question ?? market?.question ?? null;
  const eventSlug = payload.event_slug ?? market?.event_slug ?? null;

  const lines = [
    `📊 ${bold("Volume Spike")}`,
  ];

  if (question) {
    lines.push("", marketLink(question, eventSlug));
  }

  lines.push(
    "",
    `⏱ Timeframe: ${code(payload.timeframe ?? "")}`,
    `💵 Volume: ${code(formatUsd(payload.snapshot_volume_usd))} → ${code(formatUsd(payload.current_volume_usd))}`,
  );

  const spikePct = toFiniteNumber(payload.spike_pct);
  if (spikePct !== null) lines.push(`🚀 Spike: ${code(`+${spikePct.toFixed(1)}%`)}`);
  if (payload.txns != null) lines.push(`📈 Transactions: ${code(payload.txns.toLocaleString("en-US"))}`);
  if (payload.fees != null && payload.fees > 0) lines.push(`💰 Fees: ${code(formatUsd(payload.fees))}`);

  const linkLine = linksSection(eventSlug);
  if (linkLine) lines.push("", linkLine);

  return lines.join("\n");
}

function buildVolumeMilestoneMessage(payload: VolumeMilestonePayload, market: MarketContext | null): string {
  const question = market?.question ?? null;
  const eventSlug = market?.event_slug ?? null;

  const lines = [
    `🏆 ${bold("Volume Milestone")}`,
  ];

  if (question) {
    lines.push("", marketLink(question, eventSlug));
  }

  lines.push(
    "",
    `🎯 Milestone: ${code(formatUsd(payload.milestone_usd))}`,
    `💵 Volume: ${code(formatUsd(payload.current_volume_usd))}`,
    `⏱ Timeframe: ${code(payload.timeframe ?? "")}`,
  );

  if (payload.txns != null) lines.push(`📈 Transactions: ${code(payload.txns.toLocaleString("en-US"))}`);

  const linkLine = linksSection(eventSlug);
  if (linkLine) lines.push("", linkLine);

  return lines.join("\n");
}

function buildGlobalPnlMessage(payload: GlobalPnlPayload, _market: MarketContext | null): string {
  const trader = payload.trader ?? "";
  const realizedPnl = toFiniteNumber(payload.realized_pnl_usd);
  const pnlEmoji = realizedPnl !== null && realizedPnl < 0 ? "🔻" : "🟢";

  const lines = [
    `${pnlEmoji} ${bold("Global PnL Update")}`,
    "",
    `👤 ${code(trader)}`,
    `⏱ Timeframe: ${code(payload.timeframe ?? "")}`,
    `💰 Realized PnL: ${code(formatUsd(realizedPnl ?? 0))}`,
  ];

  if (payload.total_volume_usd != null) lines.push(`💵 Volume: ${code(formatUsd(payload.total_volume_usd))}`);
  if (payload.market_win_rate_pct != null) lines.push(`🎯 Win Rate: ${code(`${payload.market_win_rate_pct.toFixed(1)}%`)}`);
  if (payload.markets_traded != null) lines.push(`📊 Markets: ${code(payload.markets_traded.toLocaleString("en-US"))}`);

  lines.push("", linksSection(null, null, trader));

  return lines.join("\n");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MESSAGE_CONFIGS: Partial<Record<PolymarketWebhookEvent, (payload: any, market: MarketContext | null) => string>> = {
  condition_metrics: (p: ConditionMetricsPayload, market: MarketContext | null) => {
    const question = market?.question ?? null;
    const eventSlug = market?.event_slug ?? null;

    const lines = [
      `📊 ${bold("Market Metrics Update")}`,
    ];

    if (question) {
      lines.push("", marketLink(question, eventSlug));
    }

    const prices = outcomePricesLine(market?.outcomes);
    if (prices) lines.push(prices);

    lines.push(
      "",
      `⏱ Timeframe: ${code(p.timeframe ?? "24h")}`,
    );

    if (p.volume_usd != null) lines.push(`💵 Volume: ${code(formatUsd(p.volume_usd))}`);
    if (p.txns != null) lines.push(`📈 Transactions: ${code(p.txns.toLocaleString("en-US"))}`);
    if (p.unique_traders != null) lines.push(`👥 Unique Traders: ${code(p.unique_traders.toLocaleString("en-US"))}`);
    if (p.fees != null && p.fees > 0) lines.push(`💰 Fees: ${code(formatUsd(p.fees))}`);

    const linkLine = linksSection(eventSlug);
    if (linkLine) lines.push("", linkLine);

    return lines.join("\n");
  },

  probability_spike: (p: PriceSpikePayload, market: MarketContext | null) =>
    buildSpikeMessage("Probability Spike", p, market),

  price_spike: (p: PriceSpikePayload, market: MarketContext | null) =>
    buildSpikeMessage("Price Spike", p, market),

  price_threshold: (p: PriceThresholdPayload, market: MarketContext | null) =>
    buildPriceThresholdMessage(p, market),

  market_volume_spike: (p: MarketVolumeSpikePayload, market: MarketContext | null) =>
    buildVolumeSpikeMessage(p, market),

  market_volume_milestone: (p: VolumeMilestonePayload, market: MarketContext | null) =>
    buildVolumeMilestoneMessage(p, market),

  close_to_bond: (p: CloseToBondPayload, market: MarketContext | null) => {
    const sideEmoji = p.side.toLowerCase() === "buy" ? "🟢" : "🔴";
    const question = p.question ?? market?.question ?? null;
    const eventSlug = p.event_slug ?? market?.event_slug ?? null;

    const lines = [
      `🎯 ${bold("Close-to-Bond Trade")}`,
    ];

    if (question) {
      lines.push("", marketLink(question, eventSlug));
    }

    const prices = outcomePricesLine(market?.outcomes);
    if (prices) lines.push(prices);

    lines.push(
      "",
      `🏷 Outcome: ${bold(escapeHtml(p.outcome ?? ""))}`,
      `💲 Price: ${code(formatPercentage(p.price))}`,
      `💵 Amount: ${code(formatUsd(p.amount_usd))}`,
      `${sideEmoji} Side: ${italic(escapeHtml(p.side))}`,
    );

    if (p.shares_amount) {
      lines.push(`📦 Shares: ${code(formatShares(p.shares_amount))}`);
    }

    lines.push("", linksSection(eventSlug, p.hash, p.trader));

    return lines.join("\n");
  },

  trader_first_trade: (p: FirstTradePayload, market: MarketContext | null) =>
    buildTraderMessage("🆕", "First Trade", p, market),

  trader_new_market: (p: NewMarketPayload, market: MarketContext | null) =>
    buildTraderMessage("🆕", "New Market Entry", p, market),

  trader_whale_trade: (p: WhaleTradePayload, market: MarketContext | null) =>
    buildTraderMessage("💰", "Whale Trade", p, market),

  trader_new_trade: (p: NewTradePayload, market: MarketContext | null) =>
    buildTraderMessage("🔔", "Trade", p, market),

  trader_global_pnl: (p: GlobalPnlPayload, market: MarketContext | null) =>
    buildGlobalPnlMessage(p, market),
};

interface ExamplePayload {
  event: PolymarketWebhookEvent;
  payload: WebhookPayload;
  market: MarketContext;
}

export const EXAMPLE_PAYLOADS: ExamplePayload[] = [
  {
    event: "condition_metrics",
    payload: {
      condition_id: "0x1a2b3c4d5e6f7890abcdef1234567890abcdef12",
      timeframe: "24h",
      volume_usd: 1_250_000.50,
      txns: 4832,
      unique_traders: 1247,
      fees: 6250.25,
    } satisfies ConditionMetricsPayload,
    market: {
      question: "Will Bitcoin hit $100k in 2026?",
      event_slug: "will-bitcoin-hit-100k-2026",
      image_url: null,
      outcomes: [
        { name: "Yes", price: 0.72 },
        { name: "No", price: 0.28 },
      ],
    },
  },
  {
    event: "probability_spike",
    payload: {
      position_id: "98765",
      condition_id: "0xabcdef1234567890abcdef1234567890abcdef12",
      event_slug: "will-bitcoin-hit-100k-2026",
      outcome: "Yes",
      previous_price: 0.64,
      current_price: 0.72,
      spike_direction: "up",
      spike_pct: 12.5,
    } satisfies PriceSpikePayload,
    market: {
      question: "Will Bitcoin hit $100k in 2026?",
      event_slug: "will-bitcoin-hit-100k-2026",
      image_url: null,
      outcomes: [
        { name: "Yes", price: 0.72 },
        { name: "No", price: 0.28 },
      ],
    },
  },
  {
    event: "price_spike",
    payload: {
      position_id: "54321",
      condition_id: "0xfedcba0987654321fedcba0987654321fedcba09",
      event_slug: "us-presidential-election-2028",
      outcome: "No",
      previous_price: 0.6,
      current_price: 0.55,
      spike_direction: "down",
      spike_pct: -8.33,
    } satisfies PriceSpikePayload,
    market: {
      question: "Will the Democrats win the 2028 Presidential Election?",
      event_slug: "us-presidential-election-2028",
      image_url: null,
      outcomes: [
        { name: "Yes", price: 0.45 },
        { name: "No", price: 0.55 },
      ],
    },
  },
  {
    event: "price_threshold",
    payload: {
      trader: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      taker: "0x1234567890abcdef1234567890abcdef12345678",
      position_id: "67890",
      condition_id: "0xabcdef1234567890abcdef1234567890abcdef12",
      outcome: "Yes",
      question: "Will Bitcoin hit $100k in 2026?",
      event_slug: "will-bitcoin-hit-100k-2026",
      trade_id: "trade-100",
      hash: "0xthreshold1",
      block: 19500400,
      confirmed_at: 1711932000,
      amount_usd: 12000.0,
      shares_amount: 13333.33,
      fee: 60.0,
      side: "Buy",
      previous_price: 0.78,
      price: 0.82,
      direction: "up",
      threshold: 0.8,
    } satisfies PriceThresholdPayload,
    market: {
      question: "Will Bitcoin hit $100k in 2026?",
      event_slug: "will-bitcoin-hit-100k-2026",
      image_url: null,
      outcomes: [
        { name: "Yes", price: 0.82 },
        { name: "No", price: 0.18 },
      ],
    },
  },
  {
    event: "market_volume_spike",
    payload: {
      condition_id: "0xabcdef1234567890abcdef1234567890abcdef12",
      question: "Will Bitcoin hit $100k in 2026?",
      event_slug: "will-bitcoin-hit-100k-2026",
      timeframe: "1h",
      current_volume_usd: 480_000.0,
      snapshot_volume_usd: 120_000.0,
      delta_volume_usd: 360_000.0,
      spike_pct: 300.0,
      txns: 1842,
      fees: 2400.0,
    } satisfies MarketVolumeSpikePayload,
    market: {
      question: "Will Bitcoin hit $100k in 2026?",
      event_slug: "will-bitcoin-hit-100k-2026",
      image_url: null,
      outcomes: [
        { name: "Yes", price: 0.72 },
        { name: "No", price: 0.28 },
      ],
    },
  },
  {
    event: "market_volume_milestone",
    payload: {
      condition_id: "0xabcdef1234567890abcdef1234567890abcdef12",
      timeframe: "24h",
      milestone_usd: 1_000_000.0,
      current_volume_usd: 1_024_500.0,
      fees: 5122.5,
      txns: 6231,
    } satisfies VolumeMilestonePayload,
    market: {
      question: "Will Bitcoin hit $100k in 2026?",
      event_slug: "will-bitcoin-hit-100k-2026",
      image_url: null,
      outcomes: [
        { name: "Yes", price: 0.72 },
        { name: "No", price: 0.28 },
      ],
    },
  },
  {
    event: "close_to_bond",
    payload: {
      trader: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      taker: "0x1234567890abcdef1234567890abcdef12345678",
      position_id: "11111",
      condition_id: "0xabcdef",
      outcome: "Yes",
      question: "Will ETH hit $10k by end of 2026?",
      event_slug: "will-eth-hit-10k-2026",
      trade_id: "trade-001",
      hash: "0xabc123",
      block: 19500000,
      confirmed_at: 1711929600,
      amount_usd: 75000.0,
      shares_amount: 78947.37,
      fee: 375.0,
      side: "Buy",
      price: 0.95,
      bond_side: "high",
      threshold: 0.93,
    } satisfies CloseToBondPayload,
    market: {
      question: "Will ETH hit $10k by end of 2026?",
      event_slug: "will-eth-hit-10k-2026",
      image_url: null,
      outcomes: [
        { name: "Yes", price: 0.95 },
        { name: "No", price: 0.05 },
      ],
    },
  },
  {
    event: "trader_first_trade",
    payload: {
      trader: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      taker: "0x1234567890abcdef1234567890abcdef12345678",
      position_id: "22222",
      condition_id: "0xdeadbeef",
      outcome: "Yes",
      question: "Will SpaceX launch Starship successfully in Q2 2026?",
      event_slug: "spacex-starship-q2-2026",
      trade_id: "trade-002",
      hash: "0xdef456",
      block: 19500100,
      confirmed_at: 1711930000,
      amount_usd: 500.0,
      shares_amount: 714.29,
      fee: 2.5,
      side: "Buy",
      price: 0.70,
      exchange: "CTFExchange",
      trade_type: "OrderFilled",
    } satisfies FirstTradePayload,
    market: {
      question: "Will SpaceX launch Starship successfully in Q2 2026?",
      event_slug: "spacex-starship-q2-2026",
      image_url: null,
      outcomes: [
        { name: "Yes", price: 0.70 },
        { name: "No", price: 0.30 },
      ],
    },
  },
  {
    event: "trader_new_market",
    payload: {
      trader: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      taker: "0xfedcba0987654321fedcba0987654321fedcba09",
      position_id: "33333",
      condition_id: "0xcafebabe",
      outcome: "No",
      question: "Will the Fed cut rates in June 2026?",
      event_slug: "fed-rate-cut-june-2026",
      trade_id: "trade-003",
      hash: "0x789abc",
      block: 19500200,
      confirmed_at: 1711930500,
      amount_usd: 2500.0,
      shares_amount: 5000.0,
      fee: 12.5,
      side: "Sell",
      price: 0.50,
      exchange: "CTFExchange",
      trade_type: "OrdersMatched",
    } satisfies NewMarketPayload,
    market: {
      question: "Will the Fed cut rates in June 2026?",
      event_slug: "fed-rate-cut-june-2026",
      image_url: null,
      outcomes: [
        { name: "Yes", price: 0.50 },
        { name: "No", price: 0.50 },
      ],
    },
  },
  {
    event: "trader_new_trade",
    payload: {
      trader: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      taker: "0x1234567890abcdef1234567890abcdef12345678",
      position_id: "55555",
      condition_id: "0xdeadbeef",
      outcome: "No",
      question: "Will the Fed cut rates in June 2026?",
      event_slug: "fed-rate-cut-june-2026",
      trade_id: "trade-005",
      hash: "0xnewtrade1",
      block: 19500500,
      confirmed_at: 1711931500,
      amount_usd: 1500.0,
      shares_amount: 3000.0,
      fee: 7.5,
      side: "Sell",
      price: 0.50,
      exchange: "CTFExchange",
      trade_type: "OrderFilled",
    } satisfies NewTradePayload,
    market: {
      question: "Will the Fed cut rates in June 2026?",
      event_slug: "fed-rate-cut-june-2026",
      image_url: null,
      outcomes: [
        { name: "Yes", price: 0.50 },
        { name: "No", price: 0.50 },
      ],
    },
  },
  {
    event: "trader_global_pnl",
    payload: {
      trader: "0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8",
      timeframe: "7d",
      realized_pnl_usd: 48_250.75,
      total_volume_usd: 1_250_000.0,
      markets_traded: 87,
      markets_won: 61,
      markets_lost: 26,
      market_win_rate_pct: 70.1,
    } satisfies GlobalPnlPayload,
    market: {
      question: "",
      event_slug: "",
      image_url: null,
      outcomes: [],
    },
  },
];

export function formatMessage(
  eventType: PolymarketWebhookEvent,
  payload: WebhookPayload,
  market?: MarketContext | null
): FormattedMessage | null {
  const formatter = MESSAGE_CONFIGS[eventType];
  if (!formatter) return null;
  return {
    text: formatter(payload, market ?? null),
    imageUrl: market?.image_url ?? null,
  };
}
