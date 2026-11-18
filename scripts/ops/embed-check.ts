// Checks that Lithic SANDBOX accepts our embed-session request for a card (modern flow). Prints only the
// flow, HTTP outcome, URL host/path/type and expiry — NEVER the session token (a bearer capability), and
// never fetches the iframe (that would pull the PAN onto this machine).
//   npx tsx@4.23.15 --conditions=react-server scripts/ops/embed-check.ts --card <lithic card token> [--origin http://localhost:3000]
import { appEnv } from "./_lib";

for (const [k, v] of appEnv()) if (!process.env[k]) process.env[k] = v;
const args = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1]! : d; };
const { LithicClient } = await import("../../apps/web/src/server/lithic/client");
const client = new LithicClient(process.env.LITHIC_API_KEY!);
const s = await client.createEmbed(opt("card")!, { targetOrigin: opt("origin", "http://localhost:3000")!, ttlSecs: 300, nowMs: Date.now() });
const shape = (u: string) => { const x = new URL(u); return `${x.origin}${x.pathname}?type=${x.searchParams.get("type") ?? "(legacy)"}`; };
console.log(JSON.stringify({ flow: s.flow, expiresAt: s.expiresAt, iframeUrl: shape(s.iframeUrl), iframes: Object.fromEntries(Object.entries(s.iframes).map(([k, v]) => [k, shape(v)])) }, null, 1));
