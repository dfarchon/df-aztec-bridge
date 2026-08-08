#!/usr/bin/env bash
# mprocs pane: wait for Aztec → fund local Fee Juice address list → exit.
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev-common.sh"

wait_for_node || exit 1

if [[ "${SKIP_POST_DEPLOY:-0}" == "1" || "${SKIP_LOCAL_JUICE:-0}" == "1" ]]; then
  echo "Skipping local Fee Juice fund (SKIP_POST_DEPLOY / SKIP_LOCAL_JUICE)."
  exit 0
fi

post_deploy_local_juice
