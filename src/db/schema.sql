CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS market_monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    condition_id TEXT NOT NULL,
    market_slug TEXT,
    market_title TEXT,
    event_slug TEXT,
    event_type TEXT NOT NULL,
    struct_webhook_id TEXT,
    filters TEXT DEFAULT '{}',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id),
    UNIQUE(telegram_id, condition_id, event_type)
);

CREATE TABLE IF NOT EXISTS trader_monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    wallet_address TEXT NOT NULL,
    label TEXT,
    event_type TEXT NOT NULL,
    struct_webhook_id TEXT,
    filters TEXT DEFAULT '{}',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id),
    UNIQUE(telegram_id, wallet_address, event_type)
);

CREATE TABLE IF NOT EXISTS monitor_drafts (
    telegram_id INTEGER PRIMARY KEY,
    draft_type TEXT NOT NULL DEFAULT 'market',
    condition_id TEXT,
    market_slug TEXT,
    market_title TEXT,
    event_slug TEXT,
    wallet_address TEXT,
    event_type TEXT,
    filters TEXT DEFAULT '{}',
    awaiting_input TEXT,
    message_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_market_mons_condition ON market_monitors(condition_id, is_active);
CREATE INDEX IF NOT EXISTS idx_market_mons_event_slug ON market_monitors(event_slug, is_active);
CREATE INDEX IF NOT EXISTS idx_trader_mons_wallet ON trader_monitors(wallet_address, is_active);
CREATE INDEX IF NOT EXISTS idx_trader_mons_user ON trader_monitors(telegram_id, is_active);
