// CP0b — run the ASA handler.
//   mock:   ASA_MODE=mock ASA_SECRET=whsec_<b64> pnpm exec tsx src/s3-asa-server.ts
//   lithic: ASA_MODE=lithic (ASA_SECRET from GET /v1/auth_stream/secret) behind the ngrok static domain
import { env, optEnv } from "./lib/env.js";
import { record } from "./lib/evidence.js";
import { devnet, loadKeypair } from "./lib/solana.js";
import { createAsaHandler, type AsaMode } from "./asa/handler.js";

const mode = (optEnv("ASA_MODE") ?? "mock") as AsaMode;
const port = Number(optEnv("ASA_PORT") ?? 8790);
const server = createAsaHandler({
  conn: await devnet(),
  settler: loadKeypair("settlement-authority"),
  mode,
  secret: env("ASA_SECRET"),
  budgetMs: Number(optEnv("ASA_BUDGET_MS") ?? 2500),
  log: (d) => record(mode === "mock" ? "s3-mock" : "s2-lithic", "asa_decision", d as unknown as Record<string, unknown>),
});
server.listen(port, () => console.log(`ASA handler (${mode}) on http://localhost:${port}/asa`));
