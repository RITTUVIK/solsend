-- 0003 — reconcile retry/backoff (backend audit M2/M3). Applied by the lead; NOT applied by W2.
-- A failed reconcile (e.g. refund tx error) leaves reconcile_action NULL, increments reconcile_attempts and sets
-- next_attempt_at = now + min(2^n × 15 s, 30 min). After 8 attempts the row is tagged anomaly_refund_failing.
-- The sweep selects reconcile_action IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= now())
-- ordered by coalesce(next_attempt_at, created_at), so failing rows move BEHIND fresh rows (no starvation).
-- Idempotent: safe to re-run.

alter table authorizations add column if not exists reconcile_attempts integer not null default 0;
alter table authorizations add column if not exists next_attempt_at timestamptz;
alter table authorizations add column if not exists last_error text;

-- PostgREST cannot ORDER BY an expression, so the sweep orders by this stored generated column.
alter table authorizations add column if not exists reconcile_due_at timestamptz
  generated always as (coalesce(next_attempt_at, created_at)) stored;

-- The 0001 partial index covered (reconcile_action, created_at) WHERE reconcile_action IS NULL; replace it with
-- one matching the new sweep predicate + order.
drop index if exists authorizations_reconcile_idx;
create index if not exists authorizations_reconcile_idx
  on authorizations (reconcile_action, next_attempt_at);
create index if not exists authorizations_sweep_due_idx
  on authorizations (reconcile_due_at) where reconcile_action is null;

-- Sanity: attempts never negative.
do $$ begin
  alter table authorizations add constraint authorizations_reconcile_attempts_nonneg check (reconcile_attempts >= 0);
exception when duplicate_object then null; end $$;
