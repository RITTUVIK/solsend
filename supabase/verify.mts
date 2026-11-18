// LEAD-OWNED. Security verification of the Supabase schema (read-only). Never prints credentials.
// Usage: npx tsx supabase/verify.mts   (reads SUPABASE_DB_URL from spikes/.env)
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const root = path.dirname(new URL(import.meta.url).pathname);
const env = Object.fromEntries(readFileSync(path.resolve(root, "../spikes/.env"), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const m = /^postgres(?:ql)?:\/\/([^:]+):(.*)@([^@/:]+)(?::(\d+))?\/([^?]*)/.exec(env.SUPABASE_DB_URL ?? "");
if (!m) throw new Error("SUPABASE_DB_URL missing/invalid");
const sql = postgres({ username: m[1]!, password: m[2]!, host: m[3]!, port: Number(m[4] ?? 5432), database: m[5] || "postgres", ssl: "require", max: 1, prepare: false, onnotice: () => {} });
let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); };
try {
  const tables = await sql`select c.relname as t, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`;
  check(tables.every((r) => r.rls), `RLS enabled on all ${tables.length} public tables`);
  const pol = await sql`select count(*)::int as n from pg_policies where schemaname = 'public'`;
  check(pol[0]!.n === 0, `no RLS policies in public (found ${pol[0]!.n}) → anon/authenticated get zero rows`);
  for (const role of ["anon", "authenticated"]) {
    const priv = await sql`select table_name, string_agg(privilege_type, ',') as p from information_schema.role_table_grants where grantee = ${role} and table_schema = 'public' group by 1 order by 1`;
    check(priv.length === 0, `${role}: no table privileges in public (found on ${priv.map((r) => r.table_name).join(", ") || "none"})`);
    const fn = await sql`select has_function_privilege(${role}, 'public.rate_limit_hit(text,integer,integer)', 'execute') as x`;
    check(!fn[0]!.x, `${role}: cannot EXECUTE rate_limit_hit (SECURITY DEFINER)`);
  }
  const pub = await sql`select has_function_privilege('public', 'public.rate_limit_hit(text,integer,integer)', 'execute') as x`.catch(() => [{ x: null }]);
  check(pub[0]!.x === false, `PUBLIC: cannot EXECUTE rate_limit_hit`);
  const srt = await sql`select count(distinct table_name)::int as n from information_schema.role_table_grants where grantee = 'service_role' and table_schema = 'public' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')`;
  check(srt[0]!.n === tables.length, `service_role (server) keeps DML on all ${tables.length} tables (has ${srt[0]!.n})`);
  const sr = await sql`select has_function_privilege('service_role', 'public.rate_limit_hit(text,integer,integer)', 'execute') as x`;
  check(sr[0]!.x === true, `service_role (server, sb_secret_ key): CAN execute rate_limit_hit`);
  const secdef = await sql`select p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='rate_limit_hit'`;
  check(JSON.stringify(secdef[0]?.proconfig ?? []).includes("search_path"), `rate_limit_hit pins search_path`);
  const cols = await sql`select table_name, column_name from information_schema.columns where table_schema='public' and column_name ~* '(pan|cvv|cvc|card_number|secret|private_key)'`;
  check(cols.length === 0, `no PAN/CVV/secret-like columns (found ${cols.map((c) => `${c.table_name}.${c.column_name}`).join(", ") || "none"})`);
} finally { await sql.end({ timeout: 5 }); }
console.log(fail ? `\n${fail} check(s) FAILED` : "\nall checks passed");
process.exit(fail ? 1 : 0);
