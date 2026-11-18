// LEAD-OWNED. Supabase service-role client (server only; RLS has no anon policies).
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (client) return client;
  const e = env();
  client = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  return client;
}

/** Fixed-window rate limit via the `rate_limit_hit` SQL function. Fails CLOSED (returns false) on DB error. */
export async function rateLimit(bucket: string, windowSecs: number, max: number): Promise<boolean> {
  const { data, error } = await db().rpc("rate_limit_hit", { p_bucket: bucket, p_window_secs: windowSecs, p_max: max });
  return !error && data === true;
}
