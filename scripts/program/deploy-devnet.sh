#!/usr/bin/env bash
# Deploy (or upgrade) the SolSend program on DEVNET and verify the deployed bytes.
#   CARGO_PROFILE_RELEASE_OPT_LEVEL=z NO_DNA=1 anchor build && scripts/program/deploy-devnet.sh
# Since Upgrade 1 the deployed artifact is built with opt-level "z" (size-optimised: 227 KB vs 264 KB)
# so an upgrade buffer fits the devnet SOL budget; tests run against that exact target/deploy/solsend.so.
# An upgrade needs buffer rent (~1.16 SOL, refunded to the payer after the upgrade) on the deployer and
# never auto-extends: a binary larger than the existing ProgramData capacity is refused here.
# Program keypair: target/deploy/solsend-keypair.json (copy of ~/.config/solsend/devnet/solsend-program-keypair.json).
# Deployer + upgrade authority: ~/.config/solsend/devnet/deployer.json. Uses the public devnet RPC (no secrets).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
URL="${DEPLOY_RPC_URL:-https://api.devnet.solana.com}"
DEVNET_GENESIS="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
PROGRAM_ID="GfMyGffqQA7KNUYWByEDtQKEFmHzBPTJgsuYSaruWdZp"
DEPLOYER="$HOME/.config/solsend/devnet/deployer.json"
PROGRAM_KP="$ROOT/target/deploy/solsend-keypair.json"
SO="$ROOT/target/deploy/solsend.so"

[ -f "$PROGRAM_KP" ] || cp "$HOME/.config/solsend/devnet/solsend-program-keypair.json" "$PROGRAM_KP"
[ "$(solana-keygen pubkey "$PROGRAM_KP")" = "$PROGRAM_ID" ] || { echo "program keypair does not yield $PROGRAM_ID" >&2; exit 1; }
[ "$(solana genesis-hash -u "$URL")" = "$DEVNET_GENESIS" ] || { echo "RPC is not devnet" >&2; exit 1; }
[ -f "$SO" ] || { echo "missing $SO (run NO_DNA=1 anchor build)" >&2; exit 1; }

echo "deployer: $(solana-keygen pubkey "$DEPLOYER")  balance: $(solana balance -u "$URL" -k "$DEPLOYER")"
echo "program:  $PROGRAM_ID  size: $(wc -c <"$SO" | tr -d ' ') bytes  rent: $(solana rent -u "$URL" "$(wc -c <"$SO" | tr -d ' ')" | awk '{print $3, $4}')"

# Upgrade: the new binary must fit the allocated ProgramData (no `solana program extend` spend).
if solana program show -u "$URL" "$PROGRAM_ID" >/dev/null 2>&1; then
  CAP=$(solana program show -u "$URL" "$PROGRAM_ID" | awk "/Data Length/ {print \$3}")
  LEN=$(wc -c <"$SO" | tr -d " ")
  echo "upgrade: new $LEN bytes, ProgramData capacity $CAP bytes"
  [ "$LEN" -le "$CAP" ] || { echo "binary exceeds ProgramData capacity; extend explicitly first" >&2; exit 1; }
fi

solana program deploy -u "$URL" \
  --keypair "$DEPLOYER" \
  --upgrade-authority "$DEPLOYER" \
  --program-id "$PROGRAM_KP" \
  --no-auto-extend \
  "$SO"

solana program show -u "$URL" "$PROGRAM_ID"

# Verify: deployed program bytes == local build (the dump is the ProgramData payload, max_len bytes).
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
solana program dump -u "$URL" "$PROGRAM_ID" "$TMP/deployed.so" >/dev/null
LOCAL_LEN=$(wc -c <"$SO" | tr -d ' ')
head -c "$LOCAL_LEN" "$TMP/deployed.so" >"$TMP/deployed.trim.so"
LOCAL_SHA=$(shasum -a 256 "$SO" | awk '{print $1}')
DEPLOYED_SHA=$(shasum -a 256 "$TMP/deployed.so" | awk '{print $1}')
TRIM_SHA=$(shasum -a 256 "$TMP/deployed.trim.so" | awk '{print $1}')
echo "local    sha256: $LOCAL_SHA ($LOCAL_LEN bytes)"
echo "deployed sha256: $DEPLOYED_SHA ($(wc -c <"$TMP/deployed.so" | tr -d ' ') bytes)"
if [ "$LOCAL_SHA" = "$DEPLOYED_SHA" ]; then
  echo "MATCH: deployed bytes == local build"
elif [ "$LOCAL_SHA" = "$TRIM_SHA" ] && [ -z "$(tail -c +"$((LOCAL_LEN + 1))" "$TMP/deployed.so" | tr -d '\0')" ]; then
  echo "MATCH: deployed bytes == local build (+ zero padding up to max_len)"
else
  echo "MISMATCH" >&2
  exit 1
fi
