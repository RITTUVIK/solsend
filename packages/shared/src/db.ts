// CP1 CONTRACT — Supabase row types (mirror of supabase/migrations/0001_init.sql).
// The browser NEVER talks to Supabase directly: all access goes through API routes using the
// service-role key server-side (RLS enabled with no anon policies).
export type UserRow = { id: string; privy_user_id: string; wallet: string; bound_at: string };
export type CardRow = {
  card_pda: string; owner_wallet: string; card_id: string; kind: "STORE_LOCKED" | "ONE_TIME" | "SUBSCRIPTION";
  label: string; merchant_name: string; limit_base: string; period_secs: number | null;
  issue_state: "onchain_pending" | "onchain_confirmed" | "lithic_pending" | "issued" | "lithic_failed" | "failed";
  register_signature: string | null; lithic_card_token: string | null; lithic_last_four: string | null; lithic_error: string | null;
  created_at: string; updated_at: string;
};
export type TxIntentRow = { id: string; owner_wallet: string; kind: string; card_pda: string | null; message_sha256: string; expires_at: string; consumed_at: string | null; signature: string | null; created_at: string };
export type AuthorizationRow = {
  lithic_token: string; card_pda: string | null; amount_cents: number; merchant_descriptor: string | null; acceptor_id: string | null;
  decision: string; reason: string; settle_signature: string | null; confirmed_at: string | null; replied_at: string | null; timings: Record<string, number>;
  lithic_final_status: string | null; reconcile_action: string | null; refund_signature: string | null; created_at: string; updated_at: string;
};
export type FeedEventRow = {
  id: string; card_pda: string | null; kind: string; amount_base: string | null; remaining_base: string | null; signature: string | null;
  lithic_token: string | null; merchant: string | null; reason: string | null; source: "quicknode" | "lithic" | "reconciler" | "app"; slot: number | null; at: string;
};
export type WebhookReceiptRow = { provider: "lithic_asa" | "lithic_events" | "quicknode"; receipt_id: string; received_at: string };
export type AppSettingRow = { key: "issuer_outage"; value: string; updated_at: string };
export type RateLimitRow = { bucket: string; window_start: string; count: number };
