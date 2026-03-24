import type { DbMarketMonitor, DbTraderMonitor } from "../types/database";

function parseCount(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function addMarketMonitor(
  db: D1Database,
  telegramId: number,
  conditionId: string,
  marketSlug: string,
  marketTitle: string,
  eventSlug: string,
  eventType: string,
  structWebhookId: string,
  filters: Record<string, unknown>
): Promise<DbMarketMonitor | null> {
  await db
    .prepare(
      "INSERT INTO market_monitors (telegram_id, condition_id, market_slug, market_title, event_slug, event_type, struct_webhook_id, filters, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now')) ON CONFLICT(telegram_id, condition_id, event_type) DO UPDATE SET market_slug = excluded.market_slug, market_title = excluded.market_title, event_slug = excluded.event_slug, struct_webhook_id = excluded.struct_webhook_id, filters = excluded.filters, is_active = 1, created_at = datetime('now')"
    )
    .bind(telegramId, conditionId, marketSlug, marketTitle, eventSlug, eventType, structWebhookId, JSON.stringify(filters))
    .run();

  return db
    .prepare(
      "SELECT * FROM market_monitors WHERE telegram_id = ? AND condition_id = ? AND event_type = ? AND is_active = 1"
    )
    .bind(telegramId, conditionId, eventType)
    .first<DbMarketMonitor>();
}

export async function removeMarketMonitor(
  db: D1Database,
  monitorId: number
): Promise<void> {
  await db
    .prepare("DELETE FROM market_monitors WHERE id = ?")
    .bind(monitorId)
    .run();
}

export async function removeAllMonitors(
  db: D1Database,
  telegramId: number
): Promise<void> {
  await db.batch([
    db
      .prepare(
        "DELETE FROM market_monitors WHERE telegram_id = ?"
      )
      .bind(telegramId),
    db
      .prepare(
        "DELETE FROM trader_monitors WHERE telegram_id = ?"
      )
      .bind(telegramId),
  ]);
}

export async function getMarketMonitorsByUser(
  db: D1Database,
  telegramId: number
): Promise<DbMarketMonitor[]> {
  const result = await db
    .prepare(
      "SELECT * FROM market_monitors WHERE telegram_id = ? AND is_active = 1"
    )
    .bind(telegramId)
    .all<DbMarketMonitor>();
  return result.results;
}

export async function getSubscribersByConditionId(
  db: D1Database,
  conditionId: string
): Promise<number[]> {
  const result = await db
    .prepare(
      "SELECT DISTINCT telegram_id FROM market_monitors WHERE condition_id = ? AND is_active = 1"
    )
    .bind(conditionId)
    .all<{ telegram_id: number }>();
  return result.results.map((row) => row.telegram_id);
}

export async function getSubscribersByEventSlug(
  db: D1Database,
  eventSlug: string
): Promise<number[]> {
  const result = await db
    .prepare(
      "SELECT DISTINCT telegram_id FROM market_monitors WHERE event_slug = ? AND is_active = 1"
    )
    .bind(eventSlug)
    .all<{ telegram_id: number }>();
  return result.results.map((row) => row.telegram_id);
}

export async function addTraderMonitor(
  db: D1Database,
  telegramId: number,
  walletAddress: string,
  label: string | null,
  eventType: string,
  structWebhookId: string,
  filters: Record<string, unknown>
): Promise<DbTraderMonitor | null> {
  await db
    .prepare(
      "INSERT INTO trader_monitors (telegram_id, wallet_address, label, event_type, struct_webhook_id, filters, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now')) ON CONFLICT(telegram_id, wallet_address, event_type) DO UPDATE SET label = excluded.label, struct_webhook_id = excluded.struct_webhook_id, filters = excluded.filters, is_active = 1, created_at = datetime('now')"
    )
    .bind(telegramId, walletAddress.toLowerCase(), label, eventType, structWebhookId, JSON.stringify(filters))
    .run();

  return db
    .prepare(
      "SELECT * FROM trader_monitors WHERE telegram_id = ? AND wallet_address = ? AND event_type = ? AND is_active = 1"
    )
    .bind(telegramId, walletAddress.toLowerCase(), eventType)
    .first<DbTraderMonitor>();
}

export async function removeTraderMonitor(
  db: D1Database,
  monitorId: number
): Promise<void> {
  await db
    .prepare("DELETE FROM trader_monitors WHERE id = ?")
    .bind(monitorId)
    .run();
}

export async function getTraderMonitorsByUser(
  db: D1Database,
  telegramId: number
): Promise<DbTraderMonitor[]> {
  const result = await db
    .prepare(
      "SELECT * FROM trader_monitors WHERE telegram_id = ? AND is_active = 1"
    )
    .bind(telegramId)
    .all<DbTraderMonitor>();
  return result.results;
}

export async function getSubscribersByWalletAddress(
  db: D1Database,
  walletAddress: string
): Promise<number[]> {
  const result = await db
    .prepare(
      "SELECT DISTINCT telegram_id FROM trader_monitors WHERE wallet_address = ? AND is_active = 1"
    )
    .bind(walletAddress.toLowerCase())
    .all<{ telegram_id: number }>();
  return result.results.map((row) => row.telegram_id);
}

export async function getTraderMonitorsByWalletAndEvent(
  db: D1Database,
  walletAddress: string,
  eventType: string
): Promise<DbTraderMonitor[]> {
  const result = await db
    .prepare(
      "SELECT * FROM trader_monitors WHERE wallet_address = ? AND event_type = ? AND is_active = 1"
    )
    .bind(walletAddress.toLowerCase(), eventType)
    .all<DbTraderMonitor>();
  return result.results;
}

export async function getMarketMonitorsByConditionAndEvent(
  db: D1Database,
  conditionId: string,
  eventType: string
): Promise<DbMarketMonitor[]> {
  const result = await db
    .prepare(
      "SELECT * FROM market_monitors WHERE condition_id = ? AND event_type = ? AND is_active = 1"
    )
    .bind(conditionId, eventType)
    .all<DbMarketMonitor>();
  return result.results;
}

export async function getMarketMonitorsByWebhookAndEvent(
  db: D1Database,
  webhookId: string,
  eventType: string
): Promise<DbMarketMonitor[]> {
  const result = await db
    .prepare(
      "SELECT * FROM market_monitors WHERE struct_webhook_id = ? AND event_type = ? AND is_active = 1"
    )
    .bind(webhookId, eventType)
    .all<DbMarketMonitor>();
  return result.results;
}

export async function getMarketMonitorByUserConditionAndEvent(
  db: D1Database,
  telegramId: number,
  conditionId: string,
  eventType: string
): Promise<DbMarketMonitor | null> {
  return db
    .prepare(
      "SELECT * FROM market_monitors WHERE telegram_id = ? AND condition_id = ? AND event_type = ? AND is_active = 1"
    )
    .bind(telegramId, conditionId, eventType)
    .first<DbMarketMonitor>();
}

export async function getTraderMonitorByUserWalletAndEvent(
  db: D1Database,
  telegramId: number,
  walletAddress: string,
  eventType: string
): Promise<DbTraderMonitor | null> {
  return db
    .prepare(
      "SELECT * FROM trader_monitors WHERE telegram_id = ? AND wallet_address = ? AND event_type = ? AND is_active = 1"
    )
    .bind(telegramId, walletAddress.toLowerCase(), eventType)
    .first<DbTraderMonitor>();
}

export async function getTraderMonitorsByWebhookAndEvent(
  db: D1Database,
  webhookId: string,
  eventType: string
): Promise<DbTraderMonitor[]> {
  const result = await db
    .prepare(
      "SELECT * FROM trader_monitors WHERE struct_webhook_id = ? AND event_type = ? AND is_active = 1"
    )
    .bind(webhookId, eventType)
    .all<DbTraderMonitor>();
  return result.results;
}

export async function getMarketMonitor(
  db: D1Database,
  monitorId: number
): Promise<DbMarketMonitor | null> {
  return db
    .prepare("SELECT * FROM market_monitors WHERE id = ?")
    .bind(monitorId)
    .first<DbMarketMonitor>();
}

export async function getTraderMonitor(
  db: D1Database,
  monitorId: number
): Promise<DbTraderMonitor | null> {
  return db
    .prepare("SELECT * FROM trader_monitors WHERE id = ?")
    .bind(monitorId)
    .first<DbTraderMonitor>();
}

export async function getMarketMonitorWebhookId(
  db: D1Database,
  monitorId: number
): Promise<string | null> {
  const sub = await db
    .prepare("SELECT struct_webhook_id FROM market_monitors WHERE id = ?")
    .bind(monitorId)
    .first<{ struct_webhook_id: string | null }>();
  return sub?.struct_webhook_id ?? null;
}

export async function getTraderMonitorWebhookId(
  db: D1Database,
  monitorId: number
): Promise<string | null> {
  const sub = await db
    .prepare("SELECT struct_webhook_id FROM trader_monitors WHERE id = ?")
    .bind(monitorId)
    .first<{ struct_webhook_id: string | null }>();
  return sub?.struct_webhook_id ?? null;
}

export async function getAllMonitorWebhookIds(
  db: D1Database,
  telegramId: number
): Promise<string[]> {
  const [markets, traders] = await Promise.all([
    db.prepare("SELECT struct_webhook_id FROM market_monitors WHERE telegram_id = ? AND is_active = 1 AND struct_webhook_id IS NOT NULL")
      .bind(telegramId).all<{ struct_webhook_id: string }>(),
    db.prepare("SELECT struct_webhook_id FROM trader_monitors WHERE telegram_id = ? AND is_active = 1 AND struct_webhook_id IS NOT NULL")
      .bind(telegramId).all<{ struct_webhook_id: string }>(),
  ]);
  return [...markets.results.map(r => r.struct_webhook_id), ...traders.results.map(r => r.struct_webhook_id)];
}

export async function getKnownMonitorWebhookIds(
  db: D1Database,
  telegramId: number
): Promise<string[]> {
  const [markets, traders] = await Promise.all([
    db.prepare("SELECT struct_webhook_id FROM market_monitors WHERE telegram_id = ? AND struct_webhook_id IS NOT NULL")
      .bind(telegramId).all<{ struct_webhook_id: string }>(),
    db.prepare("SELECT struct_webhook_id FROM trader_monitors WHERE telegram_id = ? AND struct_webhook_id IS NOT NULL")
      .bind(telegramId).all<{ struct_webhook_id: string }>(),
  ]);
  return [...markets.results.map((row) => row.struct_webhook_id), ...traders.results.map((row) => row.struct_webhook_id)];
}

export async function countActiveMonitorsByUser(
  db: D1Database,
  telegramId: number
): Promise<number> {
  const [markets, traders] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM market_monitors WHERE telegram_id = ? AND is_active = 1")
      .bind(telegramId).first<{ count: number | string }>(),
    db.prepare("SELECT COUNT(*) AS count FROM trader_monitors WHERE telegram_id = ? AND is_active = 1")
      .bind(telegramId).first<{ count: number | string }>(),
  ]);

  return parseCount(markets?.count) + parseCount(traders?.count);
}

export async function countActiveMonitorWebhookReferences(
  db: D1Database,
  webhookId: string
): Promise<number> {
  const [markets, traders] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM market_monitors WHERE struct_webhook_id = ? AND is_active = 1")
      .bind(webhookId).first<{ count: number | string }>(),
    db.prepare("SELECT COUNT(*) AS count FROM trader_monitors WHERE struct_webhook_id = ? AND is_active = 1")
      .bind(webhookId).first<{ count: number | string }>(),
  ]);

  return parseCount(markets?.count) + parseCount(traders?.count);
}
