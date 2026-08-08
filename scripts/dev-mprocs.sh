#!/usr/bin/env bash
# Entry for `pnpm dev`: mprocs TUI (aztec + web panes).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v mprocs >/dev/null 2>&1; then
  echo "mprocs not found on PATH (expected system binary, e.g. /usr/local/bin/mprocs)."
  echo "Install mprocs, or use the non-TUI fallback:"
  echo "  pnpm run dev:shell"
  exit 1
fi

export PATH="${HOME}/.aztec/bin:${HOME}/.aztec/current/bin:${PATH}"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
if command -v nvm >/dev/null 2>&1; then
  nvm use 24.12.0 >/dev/null 2>&1 || nvm use >/dev/null 2>&1 || true
fi

exec mprocs -c "${ROOT}/mprocs.yaml"
