// Post-login destination (/?next=…) validation. The value comes from the URL, so anyone can craft it: it must resolve
// to a path on THIS site. Prefix checks alone are bypassable because browsers drop tabs/newlines and read "\" as "/"
// when they parse a URL ("/\t/evil.example" becomes "//evil.example", another host). So reject control characters,
// whitespace and backslashes outright, then resolve the value the way the browser will and require our own origin.
const BASE = "https://solsend.invalid";

/** Same-origin app path (pathname + search + hash) or null. */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 512 || !raw.startsWith("/") || /[\u0000- \u007f\\]/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (u.origin !== BASE) return null;
  return u.pathname + u.search + u.hash;
}
