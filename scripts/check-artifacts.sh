#!/usr/bin/env bash
# Vendored GoBridge bytecode the browser SDK ships. Solidity sources are not in this repo.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ART="$ROOT/packages/browser-sdk/src/vendor/gobridge/bridge-contract-artifacts.ts"
if [[ ! -s "$ART" ]]; then
  echo "Missing GoBridge artifact: $ART" >&2
  exit 1
fi
if ! grep -q 'BRIDGE_CONTRACT_BYTECODE' "$ART"; then
  echo "GoBridge artifact missing BRIDGE_CONTRACT_BYTECODE: $ART" >&2
  exit 1
fi
echo "GoBridge browser artifact present."
