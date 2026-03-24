export interface DbUser {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  is_active: number;
  created_at: string;
}

export interface DbMarketMonitor {
  id: number;
  telegram_id: number;
  condition_id: string;
  market_slug: string;
  market_title: string;
  event_slug: string;
  event_type: string;
  struct_webhook_id: string | null;
  filters: string;
  is_active: number;
  created_at: string;
}

export interface DbTraderMonitor {
  id: number;
  telegram_id: number;
  wallet_address: string;
  label: string | null;
  event_type: string;
  struct_webhook_id: string | null;
  filters: string;
  is_active: number;
  created_at: string;
}

export interface DbMonitorDraft {
  telegram_id: number;
  draft_type: "market" | "trader";
  condition_id: string | null;
  market_slug: string | null;
  market_title: string | null;
  event_slug: string | null;
  wallet_address: string | null;
  event_type: string | null;
  filters: string;
  awaiting_input: string | null;
  message_id: number | null;
  created_at: string;
}
