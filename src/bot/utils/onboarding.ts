export type StartRoute = "market" | "trader" | "tag" | null;
export type StartReplyKind = "welcome" | "market" | "trader" | "tag";

export function buildMarketOnboardingText(): string {
  return "<b>🏪 Market</b>\n\nSend a condition ID (0x...) or a Polymarket event URL in the chat.\n\nExamples:\n• 0xabc123...def456\n• https://polymarket.com/event/some-event";
}

export function buildTraderOnboardingText(): string {
  return "<b>👤 Trader</b>\n\nSend /trader followed by a wallet address.\n\nExample: /trader 0x1234...abcd";
}

export function buildTagOnboardingText(): string {
  return "<b>🏷 Tags & Series</b>\n\nMonitor every market in a tag/category or series — no specific market needed.\n\nTags are category names (e.g. Sports, \"FIFA World Cup\"). Series use the slug from the Polymarket URL (e.g. nfl, epl).\n\nExamples:\n• /tag Sports\n• /tag FIFA World Cup\n• /series nfl";
}

export function resolveStartRoute(match: string | undefined): StartRoute {
  const route = match?.trim().toLowerCase();
  return route === "market" || route === "trader" || route === "tag" ? route : null;
}

export function getStartReplyKind(match: string | undefined): StartReplyKind {
  return resolveStartRoute(match) ?? "welcome";
}
