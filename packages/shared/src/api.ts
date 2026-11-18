// CP1 CONTRACT — HTTP API between apps/web UI (W3) and apps/web API routes (W2/W4).
// All amounts in USDC base units are decimal STRINGS (bigint-safe). All money-moving onchain
// transactions are built by the server and signed by the user's embedded wallet (owner) and the
// server fee payer; the server never holds user keys. Every response that references an onchain
// action includes the devnet signature + explorer link (hard rule 2).
import { z } from "zod";

export const Base = z.string().regex(/^\d+$/); // USDC base units (6 decimals)
export const Pubkey = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const Signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
export const CardKindZ = z.enum(["STORE_LOCKED", "ONE_TIME", "SUBSCRIPTION"]);
export const CardStatusZ = z.enum(["ACTIVE", "FROZEN", "USED", "CLOSED"]);
/** Card creation is a RECOVERABLE workflow, not one atomic op: onchain first, then Lithic issuance. */
export const IssueStateZ = z.enum(["onchain_pending", "onchain_confirmed", "lithic_pending", "issued", "lithic_failed", "failed"]);
export const DemoMerchantZ = z.enum(["TEMU", "AMAZON", "NETFLIX", "OTHER_STORE"]);
export const ApiError = z.object({ error: z.string(), code: z.string().optional() });

// ── Auth: Privy access token (Authorization: Bearer) + one-time wallet binding ───────────────
export const BindWalletRequest = z.object({ wallet: Pubkey, message: z.string().max(300), signatureBase64: z.string() });
export const BindWalletResponse = z.object({ userId: z.string(), wallet: Pubkey });
export const BindMessage = (wallet: string, nonce: string) => `SolSend devnet login\nWallet: ${wallet}\nNonce: ${nonce}`;
/** GET /api/auth/bind?wallet= → the exact message the wallet must sign (server owns the nonce format). */
export const BindMessageResponse = z.object({ message: z.string() });

// ── Wallet ───────────────────────────────────────────────────────────────────────────────
export const WalletResponse = z.object({ wallet: Pubkey, usdcBase: Base, solLamports: z.string(), subscriptionAuthorityReady: z.boolean(), delegateHealthy: z.boolean() });
/** POST /api/wallet/setup → owner-signed tx creating/re-arming the Allowances SubscriptionAuthority. Must confirm BEFORE
 *  the first card: Allowances sets SA.init_id to the creation slot, so SA-create + delegation in one tx fails (Custom 136).
 *  /api/cards/prepare returns 409 {code:"setup_required"} until WalletResponse.subscriptionAuthorityReady is true. */
export const WalletSetupResponse = z.lazy(() => PreparedTx);
export const FaucetResponse = z.object({ signature: Signature, explorer: z.string(), amountBase: Base, label: z.literal("devnet test USDC") });

// ── Transactions (server builds → user signs → server cosigns + sends) ───────────────────
export const PreparedTx = z.object({ intentId: z.string(), txBase64: z.string(), expiresAt: z.string() });
export const SubmitTxRequest = z.object({ intentId: z.string(), signedTxBase64: z.string() });
export const SubmitTxResponse = z.object({ signature: Signature, explorer: z.string(), confirmed: z.literal(true) });

// ── Cards ────────────────────────────────────────────────────────────────────────────────
export const PrepareCardRequest = z.object({
  kind: CardKindZ, label: z.string().min(1).max(32), merchantName: z.string().min(1).max(40),
  limitCents: z.number().int().min(100).max(50_000), periodDays: z.number().int().min(1).max(366).optional(), // SUBSCRIPTION only
  /** Optional ONCHAIN expiry (Allowances delegation expiry_ts): after it, every pull fails onchain — e.g. a free-trial card
   *  that can't roll into a paid plan. 2 min (demo) … 90 days. Omitted = never expires. */
  expiresInMinutes: z.number().int().min(2).max(129_600).optional(),
});
export const PrepareCardResponse = PreparedTx.extend({ cardPda: Pubkey, cardId: z.string() });
export const CardView = z.object({
  cardPda: Pubkey, cardId: z.string(), label: z.string(), merchantName: z.string(), kind: CardKindZ, status: CardStatusZ, issueState: IssueStateZ,
  lithic: z.object({ cardToken: z.string().nullable(), lastFour: z.string().nullable(), state: z.string().nullable() }),
  limit: z.object({ type: z.enum(["lifetime", "per_period"]), totalBase: Base, remainingBase: Base, periodSecs: z.number().nullable() }),
  totals: z.object({ settledBase: Base, refundedBase: Base }), merchantLocked: z.boolean(),
  /** false once the owner revoked the Allowances delegation (in SolSend or directly) — card can never pay again. */
  delegationLive: z.boolean(),
  /** Onchain delegation expiry (ISO) or null; `expired` = now ≥ expiresAt (pulls fail onchain). */
  expiresAt: z.string().nullable().default(null),
  expired: z.boolean().default(false),
  delegation: Pubkey, createdAt: z.string(), registerSignature: Signature.nullable(),
});
export const ListCardsResponse = z.object({ cards: z.array(CardView) });
export const CardActionRequest = z.object({ action: z.enum(["freeze", "unfreeze", "close"]) });
export const RevokeAllResponse = PreparedTx; // owner-signed tx revoking every delegation directly in Allowances
export const RetryIssueResponse = z.object({ card: CardView });
/** Lithic hosted iframe session (PAN/CVV rendered by Lithic in the browser; never touches our servers). */
export const EmbedSessionResponse = z.object({
  iframeUrl: z.string().url(), expiresAt: z.string(),
  /** Per-field Lithic hosted iframes (sandbox). All render inside Lithic's origin; values never reach our servers. */
  iframes: z.object({ pan: z.string().url(), cvv: z.string().url(), expMonth: z.string().url(), expYear: z.string().url() }).partial().optional(),
});

// ── Activity feed ────────────────────────────────────────────────────────────────────────
export const FeedKindZ = z.enum(["registered", "authorization_approved", "authorization_declined", "settled", "refunded", "frozen", "unfrozen", "closed", "faucet"]);
export const FeedRow = z.object({
  id: z.string(), cardPda: Pubkey.nullable(), kind: FeedKindZ, at: z.string(), source: z.enum(["quicknode", "lithic", "reconciler", "app"]),
  amountBase: Base.nullable(), remainingBase: Base.nullable(), signature: Signature.nullable(), explorer: z.string().nullable(),
  lithicToken: z.string().nullable(), merchant: z.string().nullable(), reason: z.string().nullable(), sandbox: z.literal(true),
});
/** GET /api/feed?cardPda=&since=<iso> — UI polls every ~1.5 s (no direct browser→Supabase access). */
export const FeedResponse = z.object({ rows: z.array(FeedRow), cursor: z.string().nullable() }); // rows newest-first; cursor = newest `at` (pass as since=)

// ── Demo Merchant (sandbox only; PAN fetched in server memory, never returned/logged/stored) ─
export const DemoCheckoutRequest = z.object({ cardPda: Pubkey, merchant: DemoMerchantZ, amountCents: z.number().int().min(1).max(5_000) });
export const DemoCheckoutResponse = z.object({
  lithicToken: z.string(), decision: z.enum(["APPROVED", "DECLINED"]), lithicResult: z.string().nullable(), reason: z.string().nullable(),
  settleSignature: Signature.nullable(), explorer: z.string().nullable(), remainingBase: Base.nullable(), latencyMs: z.number(), label: z.literal("SANDBOX"),
});
export const DemoVoidRequest = z.object({ lithicToken: z.string() });
export const DemoVoidResponse = z.object({ lithicStatus: z.string(), refundSignature: Signature.nullable(), explorer: z.string().nullable(), note: z.string() });

// ── QuickNode Stream webhook payload (output of infra/quicknode/filter.js; W4) ──────────────
/** u64 fields are decimal strings; pubkeys base58; [u8;32] hex. Settles carry NO memo (security review): the link to the
 *  Lithic authorization is the event's `auth_hash` = authCommitment(token) (see commitments.ts). */
export const QnEvent = z.object({ name: z.enum(["CardRegistered", "CardSettled", "CardRefunded", "CardFrozen", "CardUnfrozen", "CardClosed", "ConfigUpdated"]) }).catchall(z.union([z.string(), z.number(), z.boolean()]));
export const QnMatch = z.object({ signature: Signature, slot: z.number(), blockTime: z.number().nullable(), success: z.boolean(), events: z.array(QnEvent) });
export const QnPayload = z.object({ solsend: z.literal("v1"), matches: z.array(QnMatch) });

// ── Ops / status ─────────────────────────────────────────────────────────────────────────
export const StatusCheck = z.object({ name: z.string(), ok: z.boolean(), detail: z.string() });
export const StatusResponse = z.object({ ok: z.boolean(), checkedAt: z.string(), checks: z.array(StatusCheck) });
export const IssuerOutageRequest = z.object({ enabled: z.boolean() });

export type TCardView = z.infer<typeof CardView>;
export type TFeedRow = z.infer<typeof FeedRow>;
export type TDemoCheckoutResponse = z.infer<typeof DemoCheckoutResponse>;
export type TStatusResponse = z.infer<typeof StatusResponse>;

/** Route table (path → method, request schema, response schema). Owners: W2 unless noted. */
export const ROUTES = {
  bindWallet: { method: "POST", path: "/api/auth/bind" },
  bindMessage: { method: "GET", path: "/api/auth/bind" }, // ?wallet=
  wallet: { method: "GET", path: "/api/wallet" },
  walletSetup: { method: "POST", path: "/api/wallet/setup" }, // → PreparedTx (sign + /api/tx/submit)
  faucet: { method: "POST", path: "/api/wallet/faucet" },
  prepareCard: { method: "POST", path: "/api/cards/prepare" },
  listCards: { method: "GET", path: "/api/cards" },
  cardAction: { method: "POST", path: "/api/cards/[cardPda]/action" }, // → PreparedTx
  revokeAll: { method: "POST", path: "/api/cards/revoke-all" }, // → PreparedTx
  retryIssue: { method: "POST", path: "/api/cards/[cardPda]/retry-issue" },
  embed: { method: "POST", path: "/api/cards/[cardPda]/embed" },
  submitTx: { method: "POST", path: "/api/tx/submit" },
  feed: { method: "GET", path: "/api/feed" }, // ?cardPda=&since=<iso> — newest first, max 50 rows; both params optional
  demoCheckout: { method: "POST", path: "/api/demo-merchant/checkout" },
  demoVoid: { method: "POST", path: "/api/demo-merchant/void" },
  issuerOutage: { method: "POST", path: "/api/admin/issuer-outage" },
  lithicAsa: { method: "POST", path: "/api/lithic/asa" }, // Lithic → us (hot path)
  lithicEvents: { method: "POST", path: "/api/lithic/events" }, // Lithic → us (reconciler)
  quicknode: { method: "POST", path: "/api/quicknode" }, // QuickNode Stream → us (W4)
  status: { method: "GET", path: "/api/status" }, // W4
  reconcile: { method: "POST", path: "/api/reconcile" }, // GitHub Actions cron / ops (Bearer RECONCILE_CRON_SECRET)
} as const;
