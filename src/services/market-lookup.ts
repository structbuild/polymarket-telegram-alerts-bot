import type { StructClient, MarketMetadata, Event } from "@structbuild/sdk";

function normalizeMarket(raw: MarketMetadata): MarketMetadata {
  const market = Array.isArray(raw) ? raw[0] : raw;
  if (!market) return null as unknown as MarketMetadata;
  if (!market.slug && (market as Record<string, unknown>).market_slug) {
    market.slug = (market as Record<string, unknown>).market_slug as string;
  }
  return market;
}

export async function lookupByConditionId(
  client: StructClient,
  conditionId: string
): Promise<MarketMetadata | null> {
  try {
    const response = await client.markets.getMarket({ conditionId });
    return normalizeMarket(response.data);
  } catch {
    return null;
  }
}

export async function lookupByEventSlug(
  client: StructClient,
  slug: string
): Promise<Event | null> {
  try {
    const response = await client.events.getEventBySlug({ slug });
    return response.data;
  } catch {
    return null;
  }
}

export async function lookupByMarketSlug(
  client: StructClient,
  slug: string
): Promise<MarketMetadata | null> {
  try {
    const response = await client.markets.getMarketBySlug({ slug });
    return normalizeMarket(response.data);
  } catch {
    return null;
  }
}
