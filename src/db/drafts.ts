import type { DbMonitorDraft } from "../types/database";

export async function getDraft(
  db: D1Database,
  telegramId: number
): Promise<DbMonitorDraft | null> {
  return db
    .prepare("SELECT * FROM monitor_drafts WHERE telegram_id = ?")
    .bind(telegramId)
    .first<DbMonitorDraft>();
}

export async function upsertMarketDraft(
  db: D1Database,
  telegramId: number,
  conditionId: string,
  marketSlug: string,
  marketTitle: string,
  eventSlug: string
): Promise<void> {
  await db
    .prepare(
      "INSERT OR REPLACE INTO monitor_drafts (telegram_id, draft_type, condition_id, market_slug, market_title, event_slug, filters, created_at) VALUES (?, 'market', ?, ?, ?, ?, '{}', datetime('now'))"
    )
    .bind(telegramId, conditionId, marketSlug, marketTitle, eventSlug)
    .run();
}

export async function upsertTraderDraft(
  db: D1Database,
  telegramId: number,
  walletAddress: string
): Promise<void> {
  await db
    .prepare(
      "INSERT OR REPLACE INTO monitor_drafts (telegram_id, draft_type, wallet_address, filters, created_at) VALUES (?, 'trader', ?, '{}', datetime('now'))"
    )
    .bind(telegramId, walletAddress.toLowerCase())
    .run();
}

export async function updateDraftEventType(
  db: D1Database,
  telegramId: number,
  eventType: string
): Promise<void> {
  await db
    .prepare(
      "UPDATE monitor_drafts SET event_type = ? WHERE telegram_id = ?"
    )
    .bind(eventType, telegramId)
    .run();
}

export async function updateDraftFilter(
  db: D1Database,
  telegramId: number,
  filterName: string,
  filterValue: unknown
): Promise<void> {
  const draft = await getDraft(db, telegramId);
  if (!draft) return;

  const filters = JSON.parse(draft.filters);
  if (filterValue === null || filterValue === undefined) {
    delete filters[filterName];
  } else {
    filters[filterName] = filterValue;
  }

  await db
    .prepare(
      "UPDATE monitor_drafts SET filters = ? WHERE telegram_id = ?"
    )
    .bind(JSON.stringify(filters), telegramId)
    .run();
}

export async function updateDraftAwaitingInput(
  db: D1Database,
  telegramId: number,
  filterName: string | null
): Promise<void> {
  await db
    .prepare(
      "UPDATE monitor_drafts SET awaiting_input = ? WHERE telegram_id = ?"
    )
    .bind(filterName, telegramId)
    .run();
}

export async function updateDraftMessageId(
  db: D1Database,
  telegramId: number,
  messageId: number
): Promise<void> {
  await db
    .prepare(
      "UPDATE monitor_drafts SET message_id = ? WHERE telegram_id = ?"
    )
    .bind(messageId, telegramId)
    .run();
}

export async function deleteDraft(
  db: D1Database,
  telegramId: number
): Promise<void> {
  await db
    .prepare("DELETE FROM monitor_drafts WHERE telegram_id = ?")
    .bind(telegramId)
    .run();
}
