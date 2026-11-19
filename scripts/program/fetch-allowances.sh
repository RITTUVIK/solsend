#!/usr/bin/env bash
# Dump the REAL Solana Subscriptions & Allowances program for the LiteSVM tests. Read-only RPC; nothing is sent.
#   bash scripts/program/fetch-allowances.sh            devnet build   -> target/fixtures/subscriptions_devnet.so
#   bash scripts/program/fetch-allowances.sh mainnet    mainnet build  -> target/fixtures/subscriptions_mainnet.so
# Output is gitignored (target/ and **/*.so). Never commit it.
#
# The two clusters run DIFFERENT builds of the program. Mainnet is the audited one: its bytes, with the trailing zero
# padding removed, hash to 056ca97c…0318, the hash OtterSec's service verified against the public source
# (https://verify.osec.io/status/De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44). Devnet runs a newer build.
# `pnpm test:program` uses the devnet build (what the deployed demo calls); `pnpm test:program:mainnet` runs the same
# tests against the mainnet build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROGRAM_ID="De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44"
CLUSTER="${1:-devnet}"

case "$CLUSTER" in
  devnet)  URL="devnet";       DEFAULT_OUT="$ROOT/target/fixtures/subscriptions_devnet.so";  EXPECT="2675ad1d2b5068d47fc5d169156cf4859a9c21c0406ce63e3828e3b7320fddbf" ;;
  mainnet) URL="mainnet-beta"; DEFAULT_OUT="$ROOT/target/fixtures/subscriptions_mainnet.so"; EXPECT="af3cefa5947173e03298361b3f461e2a314382a7206c084f77ad9a40c8b18d3a" ;;
  *) echo "usage: fetch-allowances.sh [devnet|mainnet]" >&2; exit 2 ;;
esac
OUT="${ALLOWANCES_SO:-$DEFAULT_OUT}"

mkdir -p "$(dirname "$OUT")"
solana program dump -u "$URL" "$PROGRAM_ID" "$OUT" >/dev/null
SHA="$(shasum -a 256 "$OUT" | awk '{print $1}')"
echo "allowances program: $PROGRAM_ID ($CLUSTER)"
echo "dumped to:          $OUT"
echo "sha256:             $SHA"
if [ "$SHA" = "$EXPECT" ]; then
  echo "matches the $CLUSTER build these tests were last run against (${EXPECT:0:8}…${EXPECT: -4})"
else
  echo "WARNING: sha256 differs from the $CLUSTER build these tests were last run against (${EXPECT:0:8}…${EXPECT: -4}); the program was upgraded" >&2
fi
