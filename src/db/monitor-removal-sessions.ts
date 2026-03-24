import type { DbMonitorRemovalSession } from "../types/database";

export async function getMonitorRemovalSession(
  db: D1Database,
  telegramId: number
): Promise<DbMonitorRemovalSession | null> {
  return db
    .prepare("SELECT * FROM monitor_removal_sessions WHERE telegram_id = ?")
    .bind(telegramId)
    .first<DbMonitorRemovalSession>();
}

export async function createMonitorRemovalSession(
  db: D1Database,
  telegramId: number,
  messageId: number
): Promise<void> {
  await db
    .prepare(
      "INSERT OR REPLACE INTO monitor_removal_sessions (telegram_id, selected_monitor_keys, message_id, created_at) VALUES (?, '[]', ?, datetime('now'))"
    )
    .bind(telegramId, messageId)
    .run();
}

export async function updateMonitorRemovalSessionSelection(
  db: D1Database,
  telegramId: number,
  selectedMonitorKeys: string[]
): Promise<void> {
  await db
    .prepare(
      "UPDATE monitor_removal_sessions SET selected_monitor_keys = ? WHERE telegram_id = ?"
    )
    .bind(JSON.stringify(selectedMonitorKeys), telegramId)
    .run();
}

export async function deleteMonitorRemovalSession(
  db: D1Database,
  telegramId: number
): Promise<void> {
  await db
    .prepare("DELETE FROM monitor_removal_sessions WHERE telegram_id = ?")
    .bind(telegramId)
    .run();
}
