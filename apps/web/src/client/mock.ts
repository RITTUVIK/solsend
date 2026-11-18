// MOCK MODE (NEXT_PUBLIC_MOCK_API=1): an in-browser implementation of EVERY route in api.ROUTES with realistic
// state transitions. Nothing here touches a network. Signatures are obviously fake ("mock…" prefix) and the UI
// marks them MOCK. State persists in localStorage so a reload keeps the demo going.
import { api, explorerTx, centsToBase } from "@solsend/shared";
import { isPresetStore } from "./format";

type Kind = "STORE_LOCKED" | "ONE_TIME" | "SUBSCRIPTION";
type CardStatus = "ACTIVE" | "FROZEN" | "USED" | "CLOSED";
type IssueState = "onchain_pending" | "onchain_confirmed" | "lithic_pending" | "issued" | "lithic_failed" | "failed";

interface MCard {
  cardPda: string; cardId: string; label: string; merchantName: string; kind: Kind; status: CardStatus; issueState: IssueState;
  lastFour: string | null; cardToken: string | null; totalBase: number; remainingBase: number; periodSecs: number | null;
  settledBase: number; refundedBase: number; lockedTo: string | null; delegationLive: boolean; delegation: string;
  createdAt: string; registerSignature: string | null; confirmedAt: number | null; failIssue: boolean; idle: boolean; idleSeen?: boolean;
}
interface MAuth { token: string; cardPda: string; amountBase: number; merchant: string; voided: boolean }
interface MIntent { id: string; type: "setup" | "create" | "freeze" | "unfreeze" | "close" | "revoke_all"; cardPda: string | null; consumed: boolean; expires: number }
interface MRefund { at: number; token: string }
interface State {
  bound: boolean; wallet: string; usdc: number; lastFaucet: number; saReady: boolean;
  cards: MCard[]; feed: api.TFeedRow[]; intents: MIntent[]; auths: MAuth[]; refunds: MRefund[];
  /** The first wallet-setup submit after login returns tx_expired once (exercises the automatic re-prepare + re-sign). */
  setupExpiredShown?: boolean;
}

const KEY = "solsend.mock.v1";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const rand = (n: number): string => {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => B58[b % 58]).join("");
};
const fakeSig = (): string => `mockMockMock${rand(76)}`; // base58-valid, 88 chars, unmistakably fake
const fakePda = (): string => rand(44);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const jitter = (a: number, b: number) => a + Math.floor(Math.random() * (b - a));

let state: State | null = null;
const fresh = (): State => ({ bound: false, wallet: `Mock${rand(40)}`, usdc: 0, lastFaucet: 0, saReady: false, cards: [], feed: [], intents: [], auths: [], refunds: [] });
function load(): State {
  if (state) return state;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) { state = JSON.parse(raw) as State; return state; }
  } catch { /* storage unavailable: in-memory only */ }
  state = fresh();
  return state;
}
function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}
export function mockWallet(): string { return load().wallet; }
export function mockReset(): void { state = fresh(); save(); }

function pushFeed(s: State, r: Partial<api.TFeedRow> & { kind: api.TFeedRow["kind"]; source: api.TFeedRow["source"] }): api.TFeedRow {
  const row: api.TFeedRow = {
    id: crypto.randomUUID(), cardPda: null, at: new Date().toISOString(), amountBase: null, remainingBase: null, signature: null,
    explorer: null, lithicToken: null, merchant: null, reason: null, sandbox: true, ...r,
  };
  if (row.signature && !row.explorer) row.explorer = explorerTx(row.signature);
  s.feed.unshift(row);
  if (s.feed.length > 200) s.feed.length = 200;
  return row;
}

/** Time-driven transitions (issuance, delayed refunds) are applied lazily on every request. */
function tick(s: State): void {
  const now = Date.now();
  for (const c of s.cards) {
    if (c.confirmedAt == null) continue;
    if (c.issueState === "onchain_confirmed" && now >= c.confirmedAt + 900) c.issueState = "lithic_pending";
    if (c.issueState === "lithic_pending" && now >= c.confirmedAt + 2200) {
      if (c.failIssue) { c.issueState = "lithic_failed"; }
      else issue(s, c);
    }
  }
  const due = s.refunds.filter((r) => r.at <= now);
  if (due.length) {
    s.refunds = s.refunds.filter((r) => r.at > now);
    for (const r of due) {
      const a = s.auths.find((x) => x.token === r.token);
      const c = a && s.cards.find((x) => x.cardPda === a.cardPda);
      if (!a || !c) continue;
      s.usdc += a.amountBase;
      c.refundedBase += a.amountBase;
      pushFeed(s, { kind: "refunded", source: "quicknode", cardPda: c.cardPda, amountBase: String(a.amountBase), remainingBase: String(c.remainingBase), signature: fakeSig(), lithicToken: a.token, merchant: a.merchant });
    }
  }
  save();
}
function issue(s: State, c: MCard): void {
  c.issueState = "issued";
  c.lastFour = String(jitter(1000, 9999));
  c.cardToken = crypto.randomUUID();
  void s;
}

function view(c: MCard): api.TCardView {
  return {
    cardPda: c.cardPda, cardId: c.cardId, label: c.label, merchantName: c.merchantName, kind: c.kind, status: c.status, issueState: c.issueState,
    expiresAt: null, expired: false, // TODO(UI): mock free-trial expiry
    lithic: { cardToken: c.cardToken, lastFour: c.lastFour, state: c.issueState === "issued" ? (c.status === "FROZEN" ? "PAUSED" : c.status === "CLOSED" ? "CLOSED" : "OPEN") : null },
    limit: { type: c.kind === "SUBSCRIPTION" ? "per_period" : "lifetime", totalBase: String(c.totalBase), remainingBase: String(c.delegationLive ? c.remainingBase : 0), periodSecs: c.periodSecs },
    totals: { settledBase: String(c.settledBase), refundedBase: String(c.refundedBase) },
    merchantLocked: c.lockedTo != null, delegationLive: c.delegationLive, delegation: c.delegation, createdAt: c.createdAt, registerSignature: c.registerSignature,
  };
}

interface Res { status: number; json: unknown }
const ok = (json: unknown, status = 200): Res => ({ status, json });
const err = (status: number, error: string, code?: string, extra?: Record<string, unknown>): Res => ({ status, json: { error, code, ...extra } });

const DECLINE_REASON: Record<string, string> = {
  INSUFFICIENT_FUNDS: "Over this card's limit",
  VELOCITY_EXCEEDED: "Monthly cap reached",
  CARD_PAUSED: "Card frozen",
  UNAUTHORIZED_MERCHANT: "Card locked to another store",
  NETWORK_SAFETY_LIMIT: "Declined by card-network safety limit (sandbox)",
};

export interface MockReq { method: string; path: string; query: URLSearchParams; body: unknown; hasToken: boolean }

export async function mockRequest(req: MockReq): Promise<Res> {
  const s = load();
  const { method, path } = req;
  await sleep(jitter(120, 320));
  tick(s);

  if (path === "/api/status" && method === "GET") return ok(mockStatus());
  if (!req.hasToken) return err(401, "missing bearer token", "unauthenticated");

  if (path === "/api/auth/bind" && method === "GET") {
    const w = req.query.get("wallet") ?? "";
    return ok({ message: api.BindMessage(w, `did:privy:mock-user:${Math.floor(Date.now() / 600_000)}`) });
  }
  if (path === "/api/auth/bind" && method === "POST") {
    const b = api.BindWalletRequest.safeParse(req.body);
    if (!b.success || !b.data.message.startsWith("SolSend devnet login")) return err(400, "bad bind request", "bad_request");
    s.bound = true; save();
    return ok({ userId: "mock-user", wallet: s.wallet });
  }
  if (!s.bound) return err(403, "wallet not bound", "wallet_unbound");

  if (path === "/api/wallet" && method === "GET") {
    return ok({ wallet: s.wallet, usdcBase: String(s.usdc), solLamports: "0", subscriptionAuthorityReady: s.saReady, delegateHealthy: true });
  }
  if (path === "/api/wallet/setup" && method === "POST") {
    if (s.saReady) return err(409, "Your wallet is already set up.", "already_setup");
    const intent = newIntent(s, "setup", null); save();
    return ok(preparedTx(intent));
  }
  if (path === "/api/wallet/faucet" && method === "POST") {
    await sleep(900);
    if (Date.now() - s.lastFaucet < 60_000) return err(429, "Faucet is limited to once per hour per wallet (mock: 60 s).", "rate_limited");
    s.lastFaucet = Date.now();
    const amountBase = 100_000_000; // mock faucet: 100 devnet test USDC
    s.usdc += amountBase;
    const signature = fakeSig();
    pushFeed(s, { kind: "faucet", source: "app", amountBase: String(amountBase), signature });
    save();
    return ok({ signature, explorer: explorerTx(signature), amountBase: String(amountBase), label: "devnet test USDC" });
  }
  if (path === "/api/cards" && method === "GET") return ok({ cards: s.cards.map(view).reverse() });
  if (path === "/api/cards/prepare" && method === "POST") {
    const b = api.PrepareCardRequest.safeParse(req.body);
    if (!b.success) return err(400, "Check the card details and try again.", "bad_request");
    if (!s.saReady) return err(409, "wallet setup required (POST /api/wallet/setup)", "setup_required");
    const { kind, label, merchantName, limitCents, periodDays } = b.data;
    const pda = fakePda();
    s.cards.push({
      cardPda: pda, cardId: String(jitter(1e9, 9e9)), label, merchantName, kind, status: "ACTIVE", issueState: "onchain_pending", lastFour: null, cardToken: null,
      totalBase: Number(centsToBase(limitCents)), remainingBase: Number(centsToBase(limitCents)), periodSecs: kind === "SUBSCRIPTION" ? (periodDays ?? 30) * 86400 : null,
      settledBase: 0, refundedBase: 0, lockedTo: isPresetStore(merchantName) ? merchantName.trim().toUpperCase() : null, delegationLive: true, delegation: fakePda(), createdAt: new Date().toISOString(), registerSignature: null,
      confirmedAt: null, failIssue: /fail/i.test(label), idle: false,
    });
    const intent = newIntent(s, "create", pda);
    save();
    return ok({ intentId: intent.id, txBase64: btoa(`mock-tx:${intent.id}`), expiresAt: new Date(intent.expires).toISOString(), cardPda: pda, cardId: s.cards[s.cards.length - 1]!.cardId });
  }
  if (path === "/api/cards/revoke-all" && method === "POST") {
    if (!s.cards.some((c) => c.delegationLive && c.issueState !== "failed")) return err(400, "You have no live cards to revoke.", "nothing_to_revoke");
    const intent = newIntent(s, "revoke_all", null); save();
    return ok(preparedTx(intent));
  }
  const m = path.match(/^\/api\/cards\/([^/]+)\/(action|retry-issue|embed)$/);
  if (m) {
    const card = s.cards.find((c) => c.cardPda === m[1]);
    if (!card) return err(404, "Card not found", "not_found");
    if (m[2] === "action" && method === "POST") {
      const b = api.CardActionRequest.safeParse(req.body);
      if (!b.success) return err(400, "Unknown card action", "bad_request");
      if (card.issueState !== "issued") return err(409, "This card isn't ready yet.", "not_ready");
      const t = b.data.action;
      if (t === "freeze" && card.status !== "ACTIVE") return err(409, "Only an active card can be frozen.", "bad_state");
      if (t === "unfreeze" && card.status !== "FROZEN" && !card.idle) return err(409, "This card isn't frozen.", "bad_state");
      if (t === "close" && card.status === "CLOSED") return err(409, "This card is already closed.", "bad_state");
      const intent = newIntent(s, t, card.cardPda); save();
      return ok(preparedTx(intent));
    }
    if (m[2] === "retry-issue" && method === "POST") {
      await sleep(900);
      if (card.issueState !== "lithic_failed") return err(409, "Nothing to retry for this card.", "bad_state");
      card.failIssue = false; issue(s, card); save();
      return ok({ card: view(card) });
    }
    if (m[2] === "embed" && method === "POST") {
      if (card.issueState !== "issued") return err(409, "This card isn't ready yet.", "not_ready");
      return ok({
        iframeUrl: mockEmbedUrl(card, "all"), expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        iframes: { pan: mockEmbedUrl(card, "pan"), cvv: mockEmbedUrl(card, "cvv"), expMonth: mockEmbedUrl(card, "expMonth"), expYear: mockEmbedUrl(card, "expYear") },
      });
    }
  }
  if (path === "/api/tx/submit" && method === "POST") {
    const b = api.SubmitTxRequest.safeParse(req.body);
    if (!b.success) return err(400, "Bad transaction payload", "bad_request");
    const intent = s.intents.find((i) => i.id === b.data.intentId);
    if (!intent) return err(404, "Unknown transaction", "not_found");
    if (intent.consumed) return err(409, "That transaction was already sent.", "consumed");
    if (Date.now() > intent.expires) return err(410, "That transaction expired. Please start again.", "intent_expired");
    if (intent.type === "setup" && !s.setupExpiredShown) {
      s.setupExpiredShown = true; intent.consumed = true; save();
      return err(409, "the network moved on before you signed; please try again", "tx_expired");
    }
    await sleep(jitter(900, 1400)); // "waiting for confirmed"
    intent.consumed = true;
    const signature = fakeSig();
    applyIntent(s, intent, signature);
    save();
    return ok({ signature, explorer: explorerTx(signature), confirmed: true });
  }
  if (path === "/api/feed" && method === "GET") {
    const pda = req.query.get("cardPda");
    const rows = s.feed.filter((r) => !pda || r.cardPda === pda).slice(0, 50);
    return ok({ rows, cursor: rows[0]?.at ?? null });
  }
  if (path === "/api/demo-merchant/checkout" && method === "POST") return checkout(s, req.body);
  if (path === "/api/demo-merchant/void" && method === "POST") {
    const b = api.DemoVoidRequest.safeParse(req.body);
    if (!b.success) return err(400, "Bad void request", "bad_request");
    const a = s.auths.find((x) => x.token === b.data.lithicToken);
    if (!a) return err(404, "Unknown purchase", "not_found");
    await sleep(jitter(500, 900));
    if (a.voided) {
      const done = s.feed.find((r) => r.kind === "refunded" && r.lithicToken === a.token);
      return err(409, "This purchase was already voided.", "already_voided", { refundSignature: done?.signature ?? null });
    }
    a.voided = true;
    s.refunds.push({ at: Date.now() + 1800, token: a.token });
    save();
    return ok({ lithicStatus: "VOIDED", refundSignature: null, explorer: null, note: "Void accepted by Lithic (sandbox). The refund transaction follows." });
  }
  if (path === "/api/admin/issuer-outage" && method === "POST") return ok({ ok: true });
  return err(404, `No mock for ${method} ${path}`, "not_found");
}

function newIntent(s: State, type: MIntent["type"], cardPda: string | null): MIntent {
  const i: MIntent = { id: crypto.randomUUID(), type, cardPda, consumed: false, expires: Date.now() + 120_000 };
  s.intents.push(i);
  return i;
}
const preparedTx = (i: MIntent) => ({ intentId: i.id, txBase64: btoa(`mock-tx:${i.id}`), expiresAt: new Date(i.expires).toISOString() });

function applyIntent(s: State, i: MIntent, signature: string): void {
  const c = i.cardPda ? s.cards.find((x) => x.cardPda === i.cardPda) : undefined;
  switch (i.type) {
    case "setup": s.saReady = true; break;
    case "create":
      if (!c) return;
      c.issueState = "onchain_confirmed"; c.confirmedAt = Date.now(); c.registerSignature = signature;
      pushFeed(s, { kind: "registered", source: "quicknode", cardPda: c.cardPda, amountBase: String(c.totalBase), signature, merchant: c.merchantName });
      break;
    case "freeze": if (c) { c.status = "FROZEN"; pushFeed(s, { kind: "frozen", source: "quicknode", cardPda: c.cardPda, signature }); } break;
    case "unfreeze": if (c) { c.status = "ACTIVE"; c.idle = false; pushFeed(s, { kind: "unfrozen", source: "quicknode", cardPda: c.cardPda, signature }); } break;
    case "close": if (c) { c.status = "CLOSED"; c.delegationLive = false; pushFeed(s, { kind: "closed", source: "quicknode", cardPda: c.cardPda, signature }); } break;
    case "revoke_all":
      for (const x of s.cards) if (x.delegationLive) { x.delegationLive = false; pushFeed(s, { kind: "closed", source: "quicknode", cardPda: x.cardPda, signature, reason: "Allowance revoked by owner" }); }
      break;
  }
}

async function checkout(s: State, body: unknown): Promise<Res> {
  const b = api.DemoCheckoutRequest.safeParse(body);
  if (!b.success) return err(400, "Pick a card, a store and an amount up to $50.", "bad_request");
  const { cardPda, merchant, amountCents } = b.data;
  const c = s.cards.find((x) => x.cardPda === cardPda);
  if (!c) return err(404, "Card not found", "not_found");
  const t0 = performance.now();
  await sleep(jitter(650, 1100));
  const amountBase = Number(centsToBase(amountCents));
  const token = crypto.randomUUID();
  let result: string | null = null;
  let idleDecline = false;
  if (c.issueState === "issued" && c.status === "ACTIVE" && c.delegationLive && (c.idle || (/idle/i.test(c.label) && !c.idleSeen))) { c.idle = true; c.idleSeen = true; idleDecline = true; }
  if (idleDecline) result = "CARD_PAUSED";
  else if (c.issueState !== "issued" || !c.delegationLive || c.status === "FROZEN" || c.status === "CLOSED" || c.status === "USED") result = "CARD_PAUSED";
  else if (amountBase > c.totalBase * 2) result = "NETWORK_SAFETY_LIMIT"; // Lithic outer limit = 2x onchain limit: no onchain tx
  else if (c.lockedTo && c.lockedTo !== merchant) result = "UNAUTHORIZED_MERCHANT";
  else if (amountBase > c.remainingBase) result = c.kind === "SUBSCRIPTION" ? "VELOCITY_EXCEEDED" : "INSUFFICIENT_FUNDS";
  else if (amountBase > s.usdc) result = "INSUFFICIENT_FUNDS";
  const latencyMs = Math.max(1, Math.round(performance.now() - t0) + jitter(40, 220));
  if (result) {
    const failedSig = result === "CARD_PAUSED" || result === "NETWORK_SAFETY_LIMIT" ? null : fakeSig();
    pushFeed(s, { kind: "authorization_declined", source: "lithic", cardPda, amountBase: String(amountBase), lithicToken: token, merchant, reason: idleDecline ? "Card idle — unfreeze to reactivate" : DECLINE_REASON[result] ?? result, signature: failedSig });
    save();
    return ok({ lithicToken: token, decision: "DECLINED", lithicResult: result, reason: idleDecline ? "Card idle — unfreeze to reactivate" : DECLINE_REASON[result] ?? result, settleSignature: failedSig, explorer: failedSig ? explorerTx(failedSig) : null, remainingBase: String(c.remainingBase), latencyMs, label: "SANDBOX" });
  }
  const signature = fakeSig();
  c.remainingBase -= amountBase; c.settledBase += amountBase; c.lockedTo = merchant; s.usdc -= amountBase;
  if (c.kind === "ONE_TIME") c.status = "USED";
  s.auths.push({ token, cardPda, amountBase, merchant, voided: false });
  pushFeed(s, { kind: "authorization_approved", source: "lithic", cardPda, amountBase: String(amountBase), lithicToken: token, merchant });
  pushFeed(s, { kind: "settled", source: "quicknode", cardPda, amountBase: String(amountBase), remainingBase: String(c.remainingBase), signature, lithicToken: token, merchant });
  save();
  return ok({ lithicToken: token, decision: "APPROVED", lithicResult: "APPROVED", reason: null, settleSignature: signature, explorer: explorerTx(signature), remainingBase: String(c.remainingBase), latencyMs, label: "SANDBOX" });
}

function mockStatus(): api.TStatusResponse {
  const checks = [
    ["Solana devnet RPC", "MOCK: slot 000,000,000 (not a real node)"],
    ["SolSend program", "MOCK: deployed on devnet (simulated)"],
    ["Settlement authority", "MOCK: funded for fees (simulated)"],
    ["Lithic sandbox", "MOCK: ASA webhook reachable (simulated)"],
    ["QuickNode Stream", "MOCK: streaming (simulated)"],
    ["Database", "MOCK: in-browser store"],
    ["Demo faucet", "MOCK: devnet USDC available (simulated)"],
  ] as const;
  return { ok: true, checkedAt: new Date().toISOString(), checks: checks.map(([name, detail]) => ({ name, ok: true, detail })) };
}

function mockEmbedUrl(c: MCard, field: "all" | "pan" | "cvv" | "expMonth" | "expYear"): string {
  // Stand-ins for Lithic's hosted iframes. They never contain a card number or CVV: the real iframes (Lithic's origin) render those.
  const text = { all: `•••• •••• •••• ${c.lastFour ?? "0000"}`, pan: `•••• •••• •••• ${c.lastFour ?? "0000"}`, cvv: "•••", expMonth: "••", expYear: "••" }[field];
  const html = `<!doctype html><meta charset=utf-8><body style="margin:0;font:14px system-ui;background:#18181b;color:#e4e4e7;display:grid;place-items:center;height:100vh">
<div style="text-align:center;padding:6px"><div style="font-size:9px;letter-spacing:.12em;color:#fbbf24">MOCK · SANDBOX</div>
<div style="font-size:${field === "all" ? 20 : 16}px;letter-spacing:.15em;margin:4px 0">${text}</div>${field === "all" ? '<div style="color:#a1a1aa;font-size:12px">Lithic\'s hosted frame shows the card details here.<br>SolSend never sees them.</div>' : ""}</div>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
