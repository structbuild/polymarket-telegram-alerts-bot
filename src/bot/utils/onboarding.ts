export type StartRoute = "market" | "trader" | null;
export type StartReplyKind = "welcome" | "market" | "trader";

export function buildMarketOnboardingText(): string {
  return "<b>🏪 Market</b>\n\nSend a condition ID (0x...) or a Polymarket event URL in the chat.\n\nExamples:\n• 0xabc123...def456\n• https://polymarket.com/event/some-event";
}

export function buildTraderOnboardingText(): string {
  return "<b>👤 Trader</b>\n\nSend /trader followed by a wallet address.\n\nExample: /trader 0x1234...abcd";
}

export function resolveStartRoute(match: string | undefined): StartRoute {
  const route = match?.trim().toLowerCase();
  return route === "market" || route === "trader" ? route : null;
}

export function getStartReplyKind(match: string | undefined): StartReplyKind {
  return resolveStartRoute(match) ?? "welcome";
}
