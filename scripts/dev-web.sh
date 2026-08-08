#!/usr/bin/env bash
# mprocs pane: wait for Aztec → post-deploy → Vite (local chat).
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev-common.sh"

wait_for_node || exit 1

if [[ "${SKIP_POST_DEPLOY:-0}" != "1" ]]; then
  post_deploy_vite_client
  post_deploy_example
else
  echo "SKIP_POST_DEPLOY=1 — skipping client build / deploy steps."
fi

echo ""
echo "Starting web on local Aztec…"
echo "Ready:"
echo "  Aztec node:  ${AZTEC_URL}"
echo "  Vite:        http://localhost:5173/"
echo "  Chat local:  http://localhost:5173/chat/local"
echo ""

exec pnpm --filter @df-bridge/web run dev
