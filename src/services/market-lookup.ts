import type { StructClient, MarketResponse, Event } from "@structbuild/sdk";

export async function lookupByConditionId(
  client: StructClient,
  conditionId: string
): Promise<MarketResponse | null> {
  try {
    const response = await client.markets.getMarket({ conditionId });
    return response.data ?? null;
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
): Promise<MarketResponse | null> {
  try {
    const response = await client.markets.getMarketBySlug({ marketSlug: slug });
    return response.data ?? null;
  } catch {
    return null;
  }
}
