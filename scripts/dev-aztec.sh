#!/usr/bin/env bash
# mprocs pane: Aztec 5.2 local network on :8080 (anvil :8545).
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev-common.sh"

require_aztec_cli

if node_up; then
  echo "Aztec local network already up at ${AZTEC_URL}"
  echo "Keeping this pane alive; stop mprocs (or kill the existing node) to restart fresh."
  echo "Note: SEQ_* / drift env only apply to nodes we start here — restart aztec to pick them up."
  while node_up; do
    sleep 5
  done
  echo "Local node at ${AZTEC_URL} went away."
  exit 1
fi

echo "Starting Aztec 5.2 local network on :${AZTEC_PORT} …"
echo "MAX_ALLOWED_ETH_CLIENT_DRIFT_SECONDS=${MAX_ALLOWED_ETH_CLIENT_DRIFT_SECONDS} (local anvil idle / WSL clock)"
echo "SEQ_BUILD_CHECKPOINT_IF_EMPTY=${SEQ_BUILD_CHECKPOINT_IF_EMPTY} SEQ_MIN_TX_PER_BLOCK=${SEQ_MIN_TX_PER_BLOCK} (idle L1/L2 ticks)"
exec aztec start --local-network --port "${AZTEC_PORT}" \
  --sequencer.buildCheckpointIfEmpty "${SEQ_BUILD_CHECKPOINT_IF_EMPTY}" \
  --sequencer.minTxsPerBlock "${SEQ_MIN_TX_PER_BLOCK}"
