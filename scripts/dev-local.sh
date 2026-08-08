#!/usr/bin/env bash
# Non-TUI fallback (single shell): same flow as mprocs without the split panes.
# Prefer `pnpm dev` (mprocs). Use this via `pnpm run dev:shell`.
#
#   SKIP_POST_DEPLOY=1 bash scripts/dev-local.sh
#   LIVE_DEPLOY_CHAT=1 bash scripts/dev-local.sh
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev-common.sh"

require_aztec_cli

AZTEC_PID=""
TICK_PID=""
WEB_PID=""
STARTED_AZTEC=0

cleanup() {
  if [[ -n "${WEB_PID}" ]] && kill -0 "${WEB_PID}" 2>/dev/null; then
    kill "${WEB_PID}" 2>/dev/null || true
  fi
  if [[ -n "${TICK_PID}" ]] && kill -0 "${TICK_PID}" 2>/dev/null; then
    kill "${TICK_PID}" 2>/dev/null || true
  fi
  if [[ "${STARTED_AZTEC}" -eq 1 ]] && [[ -n "${AZTEC_PID}" ]] && kill -0 "${AZTEC_PID}" 2>/dev/null; then
    kill "${AZTEC_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if node_up; then
  echo "Aztec local network already up at ${AZTEC_URL}"
else
  echo "Starting Aztec 5.1 local network on :${AZTEC_PORT} …"
  aztec start --local-network --port "${AZTEC_PORT}" \
    --sequencer.buildCheckpointIfEmpty "${SEQ_BUILD_CHECKPOINT_IF_EMPTY}" \
    --sequencer.minTxsPerBlock "${SEQ_MIN_TX_PER_BLOCK}" &
  AZTEC_PID=$!
  STARTED_AZTEC=1
fi

wait_for_node || exit 1
if [[ "${STARTED_AZTEC}" -eq 1 ]] && [[ -n "${AZTEC_PID}" ]] && ! kill -0 "${AZTEC_PID}" 2>/dev/null; then
  echo "Aztec local network exited early."
  exit 1
fi

if [[ "${SKIP_POST_DEPLOY:-0}" != "1" ]]; then
  post_deploy_vite_client
  post_deploy_example
  post_deploy_local_juice
else
  echo "SKIP_POST_DEPLOY=1 — skipping client build / deploy / juice steps."
fi

if [[ "${SKIP_LOCAL_TICK:-0}" != "1" ]]; then
  echo "Starting local-network tick (every ${LOCAL_TICK_INTERVAL_MS:-16000}ms)…"
  node --import tsx scripts/local-network-tick.ts &
  TICK_PID=$!
fi

echo ""
echo "Starting web on local Aztec…"
pnpm --filter @df-bridge/web run dev &
WEB_PID=$!

echo ""
echo "Ready:"
echo "  Aztec node:  ${AZTEC_URL}"
echo "  Vite:        http://localhost:5173/"
echo "  Chat local:  http://localhost:5173/chat/local"
echo ""

wait "${WEB_PID}"
