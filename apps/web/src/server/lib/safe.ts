// Secret-free error text for logs/DB: strips URLs (RPC endpoints embed tokens) and whsec_ secrets.
export function safeErr(e: unknown, max = 160): string {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "unknown error";
  return msg.replace(/https?:\/\/\S+/g, "<url>").replace(/whsec_\S+/g, "<secret>").slice(0, max);
}
