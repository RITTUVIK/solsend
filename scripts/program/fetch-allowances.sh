#!/usr/bin/env bash
# Dump the REAL Solana Subscriptions & Allowances program from devnet for the LiteSVM tests.
# Output: target/fixtures/subscriptions_devnet.so (gitignored: target/ and **/*.so). Never commit it.
# CP0b reference sha256 (devnet build): 2675ad1d…ddbf (the mainnet build differs: af3cefa5…).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${ALLOWANCES_SO:-$ROOT/target/fixtures/subscriptions_devnet.so}"
PROGRAM_ID="De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44"

mkdir -p "$(dirname "$OUT")"
solana program dump -u devnet "$PROGRAM_ID" "$OUT" >/dev/null
SHA="$(shasum -a 256 "$OUT" | awk '{print $1}')"
echo "allowances program: $PROGRAM_ID"
echo "dumped to:          $OUT"
echo "sha256:             $SHA"
case "$SHA" in
  2675ad1d*ddbf) echo "matches the CP0b devnet hash (2675ad1d…ddbf)" ;;
  *) echo "WARNING: sha256 differs from the CP0b devnet hash 2675ad1d…ddbf (devnet program was upgraded?)" >&2 ;;
esac
