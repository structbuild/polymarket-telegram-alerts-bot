import type { DbUser } from "../types/database";

export async function upsertUser(
  db: D1Database,
  telegramId: number,
  username: string | null,
  firstName: string | null
): Promise<void> {
  await db
    .prepare(
      "INSERT OR REPLACE INTO users (telegram_id, username, first_name, is_active, created_at) VALUES (?, ?, ?, 1, datetime('now'))"
    )
    .bind(telegramId, username, firstName)
    .run();
}

export async function getUser(
  db: D1Database,
  telegramId: number
): Promise<DbUser | null> {
  return db
    .prepare("SELECT * FROM users WHERE telegram_id = ?")
    .bind(telegramId)
    .first<DbUser>();
}

export async function deactivateUser(
  db: D1Database,
  telegramId: number
): Promise<void> {
  await db
    .prepare("UPDATE users SET is_active = 0 WHERE telegram_id = ?")
    .bind(telegramId)
    .run();
}
