#!/bin/sh
# Fetch third-party artifacts for the Allowances spike (NOT committed; see .gitignore).
#  - Dumps the Solana Subscriptions & Allowances program actually deployed on devnet
#  - Fetches its Codama IDL + design docs pinned to an exact upstream commit
set -eu
PROGRAM_ID=De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44
UPSTREAM=solana-foundation/subscriptions
PIN=57290f41e42606696e70d5cf703df6bbc88301ea   # main HEAD on 2026-11-17 (IDL == program-v0.5.0 + reclaimExcessRent)
DIR="$(cd "$(dirname "$0")/.." && pwd)/vendor"
mkdir -p "$DIR"
solana program dump "$PROGRAM_ID" "$DIR/subscriptions_devnet.so" --url devnet
for p in idl/subscriptions.json docs/001-program-architecture.md docs/005-transfer-context.md; do
  curl -sSfL "https://raw.githubusercontent.com/$UPSTREAM/$PIN/$p" -o "$DIR/$(basename "$p" .json)$( [ "${p##*.}" = json ] && echo .main.json || echo '')"
done
shasum -a 256 "$DIR/subscriptions_devnet.so"
