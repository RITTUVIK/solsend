// LEAD-OWNED. Apply supabase/migrations/*.sql in order, once each, tracked in public._solsend_migrations.
// Usage: npx tsx supabase/migrate.mts [--dry-run]
// Reads SUPABASE_DB_URL (session-pooler connection string) from spikes/.env in-process; never prints it.
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import postgres from "postgres";

const root = path.dirname(new URL(import.meta.url).pathname);
const envFile = path.resolve(root, "../spikes/.env");
const env = Object.fromEntries(readFileSync(envFile, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const url = process.env.SUPABASE_DB_URL ?? env.SUPABASE_DB_URL;
if (!url) { console.error("SUPABASE_DB_URL missing in spikes/.env"); process.exit(2); }
if (!/supabase\.(co|com)/.test(url)) { console.error("refusing: SUPABASE_DB_URL is not a Supabase host"); process.exit(2); }
const dry = process.argv.includes("--dry-run");

/** Parse a Supabase Postgres URI robustly WITHOUT requiring percent-encoding: user = up to the first ':', password =
 *  everything up to the LAST '@' (passwords may contain @ : / ? # etc.), host:port/db after it. Never printed. */
function parseDbUrl(raw: string) {
  const m = /^postgres(?:ql)?:\/\/([^:]+):(.*)@([^@/:]+)(?::(\d+))?\/([^?]*)/.exec(raw.trim().replace(/^["']|["']$/g, ""));
  if (!m) throw new Error("SUPABASE_DB_URL is not a postgres URI");
  const pw = m[2]!;
  let password = pw;
  if (/%[0-9A-Fa-f]{2}/.test(pw)) { try { password = decodeURIComponent(pw); } catch { password = pw; } }
  return { username: decodeURIComponent(m[1]!), password, host: m[3]!, port: Number(m[4] ?? 5432), database: m[5] || "postgres" };
}
const conn = parseDbUrl(url);
const sql = postgres({ ...conn, ssl: "require", max: 1, prepare: false, onnotice: () => {} });
try {
  await sql`create table if not exists public._solsend_migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now())`;
  await sql`alter table public._solsend_migrations enable row level security`;
  const applied = new Map((await sql`select name, sha256 from public._solsend_migrations`).map((r) => [r.name as string, r.sha256 as string]));
  const files = readdirSync(path.join(root, "migrations")).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  for (const f of files) {
    const body = readFileSync(path.join(root, "migrations", f), "utf8");
    const h = createHash("sha256").update(body).digest("hex");
    if (applied.has(f)) {
      console.log(`${applied.get(f) === h ? "ok     " : "CHANGED"} ${f}${applied.get(f) === h ? "" : " (already applied with different content — write a new migration instead)"}`);
      continue;
    }
    if (dry) { console.log(`pending ${f}`); continue; }
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into public._solsend_migrations (name, sha256) values (${f}, ${h})`;
    });
    console.log(`applied ${f}`);
  }
  const tables = await sql`select table_name, (select relrowsecurity from pg_class where relname = table_name and relnamespace = 'public'::regnamespace) as rls
                           from information_schema.tables where table_schema = 'public' order by 1`;
  console.log("tables (rls):", tables.map((t) => `${t.table_name}${t.rls ? "" : " [RLS OFF!]"}`).join(", "));
} finally {
  await sql.end({ timeout: 5 });
}
