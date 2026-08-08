#!/usr/bin/env bash
# mprocs pane: mine/warp local Aztec every LOCAL_TICK_INTERVAL_MS (default 16s).
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev-common.sh"

if [[ "${SKIP_LOCAL_TICK:-0}" == "1" ]]; then
  echo "SKIP_LOCAL_TICK=1 — not starting local network ticker."
  exit 0
fi

wait_for_node || exit 1
echo "Starting local-network tick (interval ${LOCAL_TICK_INTERVAL_MS:-16000}ms)…"
exec node --import tsx scripts/local-network-tick.ts
