// ?next= open-redirect guard (found 2026-11-18 in review: "/\t/evil.example" passed the old prefix check).
import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

const SITE = "https://solsend-ashen.vercel.app";

describe("safeNext", () => {
  it("keeps in-app paths (with query and hash)", () => {
    expect(safeNext("/cards/new")).toBe("/cards/new");
    expect(safeNext("/activity")).toBe("/activity");
    expect(safeNext("/cards/abc?tab=x#top")).toBe("/cards/abc?tab=x#top");
  });

  it("rejects empty, relative and absolute values", () => {
    for (const v of [null, undefined, "", "cards/new", "https://evil.example", "http:evil.example", "javascript:alert(1)"]) {
      expect(safeNext(v)).toBeNull();
    }
  });

  it("rejects every off-site trick a browser would resolve to another host", () => {
    const tricks = [
      "//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/\r/evil.example",
      "\t//evil.example", "/ /evil.example", "/\\/evil.example", "/\u0000/evil.example", "/" + "a".repeat(600),
    ];
    for (const v of tricks) expect(safeNext(v), JSON.stringify(v)).toBeNull();
  });

  it("anything it accepts stays on our origin when the browser resolves it", () => {
    const inputs = ["/home", "/%09/evil.example", "/%2F/evil.example", "/./../home", "/cards/x?next=//evil.example"];
    for (const v of inputs) {
      const out = safeNext(v);
      expect(out, v).not.toBeNull();
      expect(new URL(out!, SITE).origin, v).toBe(SITE);
    }
  });
});
