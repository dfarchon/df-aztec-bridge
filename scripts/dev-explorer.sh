#!/usr/bin/env bash
# mprocs pane: local AztecScan-shaped explorer status (UI is Vite :5173).
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev-common.sh"

EXPLORER_ORIGIN="${LOCAL_EXPLORER_ORIGIN:-http://localhost:5173}"
# Same cadence as mprocs `tick` / Vite explorer (LOCAL_TICK_INTERVAL_MS).
POLL_MS="${LOCAL_EXPLORER_POLL_MS:-${LOCAL_TICK_INTERVAL_MS:-4000}}"
POLL_SEC="$(awk "BEGIN { printf \"%.3f\", ${POLL_MS}/1000 }")"
# Slight lag so mineBlock from tick has published before we read tip.
LAG_SEC="$(awk "BEGIN { lag=${POLL_MS}/5000; if (lag < 0.2) lag=0.2; if (lag > 0.75) lag=0.75; printf \"%.3f\", lag }")"

if [[ "${SKIP_EXPLORER:-0}" == "1" ]]; then
  echo "SKIP_EXPLORER=1 — local explorer status pane idle."
  echo "Open ${EXPLORER_ORIGIN}/explorer when Vite is up."
  while true; do sleep 3600; done
fi

wait_for_node || {
  echo "Aztec node not ready — explorer pane waiting forever for ${AZTEC_URL}"
  while ! node_up; do sleep 2; done
}

echo "=== Local explorer (in-app, not Chicmoz) ==="
echo "  Home:   ${EXPLORER_ORIGIN}/explorer"
echo "  Tip:    ${EXPLORER_ORIGIN}/blocks/<n>"
echo "  Tx:     ${EXPLORER_ORIGIN}/tx-effects/<0x…>"
echo "  Node:   ${AZTEC_URL}"
echo "  Poll:   every ${POLL_MS}ms (bound to local-network-tick)"
echo ""

sleep "${LAG_SEC}"
while true; do
  tip="$(
    curl -sf -X POST "${AZTEC_URL}" \
      -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","method":"node_getBlockNumber","params":[],"id":1}' \
      2>/dev/null | sed -n 's/.*"result"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1
  )" || tip=""
  if [[ -n "${tip}" ]]; then
    echo "[$(date -u +%H:%M:%SZ)] tip ${tip} → ${EXPLORER_ORIGIN}/blocks/${tip}"
  else
    echo "[$(date -u +%H:%M:%SZ)] tip unavailable (${AZTEC_URL})"
  fi
  sleep "${POLL_SEC}"
done
