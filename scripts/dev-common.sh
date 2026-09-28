# Shared env / helpers for local Aztec + Vite (sourced by other scripts).
# shellcheck shell=bash

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="${HOME}/.aztec/bin:${HOME}/.aztec/current/bin:${PATH}"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
if command -v nvm >/dev/null 2>&1; then
  nvm use 24.12.0 >/dev/null 2>&1 || nvm use >/dev/null 2>&1 || true
fi

AZTEC_URL="${VITE_LOCAL_AZTEC_NODE_URL:-http://localhost:8080}"
L1_URL="${VITE_LOCAL_L1_RPC_URL:-http://localhost:8545}"
AZTEC_PORT="${AZTEC_PORT:-8080}"

export VITE_LOCAL_AZTEC_NODE_URL="${AZTEC_URL}"
export VITE_LOCAL_L1_RPC_URL="${L1_URL}"
export LOCAL_AZTEC_NODE_URL="${AZTEC_URL}"
export LOCAL_L1_RPC_URL="${L1_URL}"
# Hint for operators; /chat/local forces networkId=local regardless of bridge lock.
export VITE_CHAT_LOCAL=1

# Local anvil only advances timestamps when it mines. Idle gaps (or WSL clock jumps)
# trip Aztec's default 300s L1 drift check with noisy archiver errors / startup throws.
# 0 disables the check (Aztec treats 0 as off). Override if you need a custom bound.
export MAX_ALLOWED_ETH_CLIENT_DRIFT_SECONDS="${MAX_ALLOWED_ETH_CLIENT_DRIFT_SECONDS:-0}"

# AutomineSequencer only warps/mines L1 when it builds. Defaults are minTxs=1 and
# buildCheckpointIfEmpty=false, so after local-network setup L1 freezes (~block 44)
# until the next user tx — juice claims / archiver then stall. Publish empty
# checkpoints while idle so L1 keeps advancing (block 45+).
export SEQ_BUILD_CHECKPOINT_IF_EMPTY="${SEQ_BUILD_CHECKPOINT_IF_EMPTY:-true}"
export SEQ_MIN_TX_PER_BLOCK="${SEQ_MIN_TX_PER_BLOCK:-0}"
# mprocs `tick` pane / `pnpm tick:local` — aztecDebug_mineBlock interval (ms).
# Vite local explorer polls tip on the same cadence (VITE_LOCAL_TICK_INTERVAL_MS).
export LOCAL_TICK_INTERVAL_MS="${LOCAL_TICK_INTERVAL_MS:-4000}"
export VITE_LOCAL_TICK_INTERVAL_MS="${VITE_LOCAL_TICK_INTERVAL_MS:-$LOCAL_TICK_INTERVAL_MS}"

node_up() {
  curl -sf -X POST "${AZTEC_URL}" \
    -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","method":"node_getNodeInfo","params":[],"id":1}' \
    >/dev/null 2>&1
}

wait_for_node() {
  local max_attempts="${1:-180}"
  echo "Waiting for local node (${AZTEC_URL})…"
  for i in $(seq 1 "${max_attempts}"); do
    if node_up; then
      echo "Local Aztec node is up (attempt ${i})."
      return 0
    fi
    if [[ "$i" -eq "${max_attempts}" ]]; then
      echo "Timed out waiting for Aztec local network (~$((max_attempts * 2 / 60)) min)."
      return 1
    fi
    sleep 2
  done
}

require_aztec_cli() {
  if ! command -v aztec >/dev/null 2>&1; then
    echo "aztec CLI not found. Install Aztec 5.2.0:"
    echo "  aztec-up install 5.2.0 && aztec-up use 5.2.0"
    exit 1
  fi
  local ver
  ver="$(aztec --version 2>/dev/null | head -1 || true)"
  echo "Aztec CLI: ${ver}"
  if [[ "${ver}" != *5.2* ]]; then
    echo "Warning: expected Aztec 5.2.x (got '${ver}'). Continuing anyway."
  fi
}

post_deploy_vite_client() {
  echo ""
  echo "=== Post-deploy (Vite client) ==="
  echo "Building workspace libs (@df-bridge/core + browser-sdk)…"
  pnpm run build:libs

  # PrivateChat lives on privacyChat branches only — skip on bridge-only checkouts.
  if [[ -d contracts/aztec/private_chat ]]; then
    if [[ -f contracts/aztec/private_chat/target/private_chat_contract-PrivateChat.json ]]; then
      echo "PrivateChat artifact present."
    else
      echo "Compiling PrivateChat for client codegen…"
      pnpm run compile:private-chat
    fi

    echo "Updating config/deployments/chat.json + web generated pin (dry-run)…"
    pnpm run deploy-aztec-chat local --dry-run || true

    local digest meta cur
    digest="$(sha256sum packages/browser-sdk/src/generated/PrivateChat.json 2>/dev/null | awk '{print $1}' || true)"
    if [[ -n "${digest}" ]]; then
      meta="apps/web/src/chat/aztec/generated/privateChatMeta.ts"
      if [[ -f "${meta}" ]]; then
        cur="$(grep -oE 'sha256:[a-f0-9]+' "${meta}" | head -1 || true)"
        if [[ "${cur}" != "sha256:${digest}" ]]; then
          echo "Note: PRIVATE_CHAT_ARTIFACT_DIGEST is ${cur:-missing}; file digest sha256:${digest}"
          echo "      Bump privateChatMeta.ts after compile if you changed Noir."
        else
          echo "Client artifact digest matches privateChatMeta.ts."
        fi
      fi
    fi
    echo "Vite client will use ${AZTEC_URL} (open /chat/local if chat UI is present)."
  else
    echo "No contracts/aztec/private_chat — skipping PrivateChat compile (bridge-only checkout)."
    echo "Vite client will use ${AZTEC_URL}."
  fi
}

post_deploy_example() {
  echo ""
  echo "=== Post-deploy (example) ==="
  if [[ ! -d contracts/aztec/private_chat ]]; then
    echo "Skipping PrivateChat deploy example (contracts/aztec/private_chat not in this branch)."
    return 0
  fi
  echo "Example: after node is hot, pin / deploy PrivateChat for local:"
  echo "  pnpm deploy-aztec-chat local --dry-run"
  echo "  LIVE_DEPLOY_CHAT=1 pnpm deploy-aztec-chat local   # needs AZTEC_DEPLOYER_KEY + PXE"
  if [[ "${LIVE_DEPLOY_CHAT:-0}" == "1" ]]; then
    echo "LIVE_DEPLOY_CHAT=1 — attempting live local PrivateChat deploy…"
    pnpm run deploy-aztec-chat local || {
      echo "Live deploy failed (PXE/account). Continuing with Vite; chat still auto-deploys per wallet."
    }
  else
    echo "Skipping live example deploy (set LIVE_DEPLOY_CHAT=1 to enable)."
  fi
}

post_deploy_local_juice() {
  echo ""
  echo "=== Post-deploy (local Fee Juice) ==="
  echo "Funding addresses in config/local-juice-fund.json (test account #0 signer)…"
  if [[ "${SKIP_LOCAL_JUICE:-0}" == "1" ]]; then
    echo "SKIP_LOCAL_JUICE=1 — skipping."
    return 0
  fi
  pnpm run fund:local-juice || {
    echo "Warning: local Fee Juice fund failed (node/test accounts). Continuing."
    return 0
  }
}
