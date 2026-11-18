-- Security hardening found by supabase/verify.mts after 0001 (lead, 2026-11-18).
-- 1) Postgres grants EXECUTE on new functions to PUBLIC by default, so `revoke … from anon, authenticated` in 0001 did
--    NOT stop anon from calling the SECURITY DEFINER rate_limit_hit via PostgREST RPC (could exhaust our rate limits).
-- 2) Supabase's default privileges grant ALL on public tables to anon/authenticated. RLS (no policies) already returns
--    zero rows, but the browser never talks to Supabase at all, so remove the grants too (defense in depth).
-- Only the server (service_role via the sb_secret_ key) may touch this schema.

revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Future objects created by the migration role must not be exposed either.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
