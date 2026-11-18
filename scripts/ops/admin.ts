// Ops admin calls against a SolSend deployment, with bearer tokens read in-process from apps/web/.env.local
// (never printed).
//   npx tsx@4.23.15 scripts/ops/admin.ts outage on|off|status [--url http://localhost:3000]
//   npx tsx@4.23.15 scripts/ops/admin.ts reconcile [token ...]   [--url …]
import { appEnv } from "./_lib";

const args = process.argv.slice(2);
const i = args.indexOf("--url");
const base = (i >= 0 ? args.splice(i, 2)[1]! : "http://localhost:3000").replace(/\/+$/, "");
const [cmd, ...rest] = args;
const env = appEnv();
const bearer = (k: string) => { const v = env.get(k); if (!v) throw new Error(`${k} missing in apps/web/.env.local`); return { authorization: `Bearer ${v}`, "content-type": "application/json" }; };

if (cmd === "outage") {
  const h = bearer("ADMIN_API_TOKEN");
  const res = rest[0] === "status"
    ? await fetch(`${base}/api/admin/issuer-outage`, { headers: h })
    : await fetch(`${base}/api/admin/issuer-outage`, { method: "POST", headers: h, body: JSON.stringify({ enabled: rest[0] === "on" }) });
  console.log(`issuer-outage ${rest[0]}: HTTP ${res.status} ${await res.text()}`);
} else if (cmd === "reconcile") {
  const res = await fetch(`${base}/api/reconcile`, { method: "POST", headers: bearer("RECONCILE_CRON_SECRET"), body: JSON.stringify(rest.length ? { tokens: rest } : {}) });
  console.log(`reconcile: HTTP ${res.status}`, JSON.stringify(await res.json(), null, 2));
} else if (cmd === "recover") {
  const [cardPda, ...tokens] = rest;
  const res = await fetch(`${base}/api/reconcile`, { method: "POST", headers: bearer("RECONCILE_CRON_SECRET"), body: JSON.stringify({ items: tokens.map((token) => ({ token, cardPda })) }) });
  console.log(`recover: HTTP ${res.status}`, JSON.stringify(await res.json(), null, 2));
} else {
  console.log("usage: admin.ts recover <cardPda> <token…> [--url …]");
  console.log("usage: admin.ts outage on|off|status | reconcile [token…] [--url …]");
}
