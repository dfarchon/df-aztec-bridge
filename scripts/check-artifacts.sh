#!/usr/bin/env bash
# Fail if vendor GoBridge artifacts drift from the Solidity-generated source of truth.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/contracts/ethereum/generated/bridge-contract-artifacts.ts"
for dest in \
  "$ROOT/packages/core/src/vendor/gobridge/bridge-contract-artifacts.ts" \
  "$ROOT/packages/browser-sdk/src/vendor/gobridge/bridge-contract-artifacts.ts"
do
  if ! cmp -s "$SRC" "$dest"; then
    echo "Artifact drift: $dest does not match $SRC" >&2
    echo "Run: cd contracts/ethereum/solidity && ./generate-artifacts.sh" >&2
    exit 1
  fi
done
echo "GoBridge artifacts in sync."
