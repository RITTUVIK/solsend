-- CP1 CONTRACT — SolSend Supabase schema (free tier). Mirrors packages/shared/src/db.ts.
-- Security: RLS ON for every table and NO anon/authenticated policies. Only the server
-- (service-role key, never shipped to the browser) reads/writes. The browser uses our API routes.
-- PCI: no column may ever hold a PAN, CVV, expiry, or Lithic API/ASA secret.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  privy_user_id text not null unique,
  wallet text not null unique,
  bound_at timestamptz not null default now()
);

-- Recoverable card-creation workflow: onchain_pending → onchain_confirmed → lithic_pending → issued
-- (or lithic_failed → retry → issued). Onchain is source of truth for limits/status.
create table if not exists cards (
  card_pda text primary key,
  owner_wallet text not null,
  card_id text not null,
  kind text not null check (kind in ('STORE_LOCKED','ONE_TIME','SUBSCRIPTION')),
  label text not null,
  merchant_name text not null,
  limit_base text not null,
  period_secs integer,
  issue_state text not null default 'onchain_pending'
    check (issue_state in ('onchain_pending','onchain_confirmed','lithic_pending','issued','lithic_failed','failed')),
  register_signature text,
  lithic_card_token text unique,
  lithic_last_four text,
  lithic_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_wallet, card_id)
);
create index if not exists cards_owner_idx on cards (owner_wallet, created_at desc);

-- Server-built transactions awaiting the user's signature. Submit is accepted only if the signed
-- message hashes to message_sha256 (byte-identical; CP0b G0.8) and the intent is unexpired + unconsumed.
create table if not exists tx_intents (
  id uuid primary key default gen_random_uuid(),
  owner_wallet text not null,
  kind text not null,
  card_pda text,
  message_sha256 text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  signature text,
  created_at timestamptz not null default now()
);

-- One row per Lithic authorization (ASA). Correctness never depends on this table (the onchain
-- SettlementRecord is the idempotency key and Lithic transaction status is the reconcile source of
-- truth); it powers the UI and the reconciler's work list.
create table if not exists authorizations (
  lithic_token text primary key,
  auth_hash text not null,
  card_pda text,
  amount_cents integer not null,
  merchant_descriptor text,
  acceptor_id text,
  decision text not null default 'PENDING',
  reason text not null default '',
  settle_signature text,
  confirmed_at timestamptz,
  replied_at timestamptz,
  timings jsonb not null default '{}'::jsonb,
  lithic_final_status text,
  reconcile_action text,
  refund_signature text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists authorizations_card_idx on authorizations (card_pda, created_at desc);
create index if not exists authorizations_reconcile_idx on authorizations (reconcile_action, created_at) where reconcile_action is null;

-- Activity feed. Onchain rows come from the QuickNode Stream webhook (source='quicknode'); the
-- unique (signature, kind, card_pda) makes webhook re-deliveries idempotent.
create table if not exists feed_events (
  id uuid primary key default gen_random_uuid(),
  card_pda text,
  kind text not null,
  amount_base text,
  remaining_base text,
  signature text,
  lithic_token text,
  merchant text,
  reason text,
  source text not null check (source in ('quicknode','lithic','reconciler','app')),
  slot bigint,
  at timestamptz not null default now()
);
create unique index if not exists feed_events_dedupe on feed_events (coalesce(signature,''), kind, coalesce(card_pda,''), coalesce(lithic_token,''));
create index if not exists feed_events_card_idx on feed_events (card_pda, at desc);

-- Webhook replay protection across serverless instances (Lithic webhook-id, QuickNode nonce).
create table if not exists webhook_receipts (
  provider text not null check (provider in ('lithic_asa','lithic_events','quicknode')),
  receipt_id text not null,
  received_at timestamptz not null default now(),
  primary key (provider, receipt_id)
);

create table if not exists app_settings (
  key text primary key check (key in ('issuer_outage')),
  value text not null,
  updated_at timestamptz not null default now()
);

-- Fixed-window rate limiting for Demo Merchant / faucet / card creation (per wallet + global).
create table if not exists rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket, window_start)
);
create or replace function rate_limit_hit(p_bucket text, p_window_secs integer, p_max integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_secs) * p_window_secs); c integer;
begin
  insert into rate_limits (bucket, window_start, count) values (p_bucket, w, 1)
    on conflict (bucket, window_start) do update set count = rate_limits.count + 1
    returning count into c;
  return c <= p_max;
end $$;

alter table users enable row level security;
alter table cards enable row level security;
alter table tx_intents enable row level security;
alter table authorizations enable row level security;
alter table feed_events enable row level security;
alter table webhook_receipts enable row level security;
alter table app_settings enable row level security;
alter table rate_limits enable row level security;
revoke all on function rate_limit_hit(text, integer, integer) from anon, authenticated;
