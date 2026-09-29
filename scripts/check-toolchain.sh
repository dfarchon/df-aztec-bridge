#!/usr/bin/env bash
# Verify Node (.nvmrc) + pnpm (packageManager sha512) pins against TOOLCHAIN.pins.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "OK: $*"; }

PINS="$ROOT/TOOLCHAIN.pins"
[[ -f "$PINS" ]] || fail "missing $PINS"
# shellcheck disable=SC1090
source "$PINS"

[[ -f .nvmrc ]] || fail "missing .nvmrc"
[[ -f .node-version ]] || fail "missing .node-version"
NVM_VER="$(tr -d '[:space:]' < .nvmrc)"
NODE_FILE_VER="$(tr -d '[:space:]' < .node-version)"
[[ "$NVM_VER" == "$NODE_VERSION" ]] || fail ".nvmrc=$NVM_VER ≠ pins NODE_VERSION=$NODE_VERSION"
[[ "$NODE_FILE_VER" == "$NODE_VERSION" ]] || fail ".node-version=$NODE_FILE_VER ≠ pins"
ok "nvm / node-version pinned to $NODE_VERSION"

PM="$(node -p "require('./package.json').packageManager||''")"
[[ "$PM" == "$PNPM_PACKAGE_MANAGER" ]] || fail "package.json packageManager mismatch
  got:  $PM
  want: $PNPM_PACKAGE_MANAGER"
ok "packageManager Corepack sha512 pin matches TOOLCHAIN.pins"

# Re-derive Corepack hex from npm integrity and compare
DERIVED_HEX="$(node -e "const i=process.argv[1]; if(!i.startsWith('sha512-')) process.exit(2); process.stdout.write(Buffer.from(i.slice(7),'base64').toString('hex'));" "$PNPM_NPM_INTEGRITY")"
EXPECTED_HEX="${PNPM_PACKAGE_MANAGER#*+sha512.}"
[[ "$DERIVED_HEX" == "$EXPECTED_HEX" ]] || fail "pnpm sha512 hex does not match npm integrity derivation"
ok "pnpm sha512 hex ↔ npm integrity consistent"

ENG_NODE="$(node -p "require('./package.json').engines?.node||''")"
ENG_PNPM="$(node -p "require('./package.json').engines?.pnpm||''")"
[[ "$ENG_NODE" == "$NODE_VERSION" ]] || fail "engines.node=$ENG_NODE want $NODE_VERSION"
[[ "$ENG_PNPM" == "$PNPM_VERSION" ]] || fail "engines.pnpm=$ENG_PNPM want $PNPM_VERSION"
ok "engines.node / engines.pnpm exact"

# Root devDependencies exact + sha512 hex consistent with npm integrity pins
TSX_PKG="$(node -p "require('./package.json').devDependencies?.tsx||''")"
TS_PKG="$(node -p "require('./package.json').devDependencies?.typescript||''")"
[[ "$TSX_PKG" == "$TSX_VERSION" ]] || fail "devDependencies.tsx=$TSX_PKG want $TSX_VERSION"
[[ "$TS_PKG" == "$TYPESCRIPT_VERSION" ]] || fail "devDependencies.typescript=$TS_PKG want $TYPESCRIPT_VERSION"
DERIVED_TSX="$(node -e "const i=process.argv[1]; if(!i.startsWith('sha512-')) process.exit(2); process.stdout.write(Buffer.from(i.slice(7),'base64').toString('hex'));" "$TSX_NPM_INTEGRITY")"
DERIVED_TS="$(node -e "const i=process.argv[1]; if(!i.startsWith('sha512-')) process.exit(2); process.stdout.write(Buffer.from(i.slice(7),'base64').toString('hex'));" "$TYPESCRIPT_NPM_INTEGRITY")"
[[ "$DERIVED_TSX" == "$TSX_SHA512_HEX" ]] || fail "tsx sha512 hex ≠ npm integrity derivation"
[[ "$DERIVED_TS" == "$TYPESCRIPT_SHA512_HEX" ]] || fail "typescript sha512 hex ≠ npm integrity derivation"
ok "devDependencies tsx@$TSX_VERSION / typescript@$TYPESCRIPT_VERSION sha512 pinned"

# Running toolchain (warn if mismatch; fail in CI)
if [[ "${REQUIRE_RUNTIME_MATCH:-}" == "1" || "${CI:-}" == "true" ]]; then
  RUN_NODE="$(node -p "process.versions.node")"
  RUN_PNPM="$(pnpm --version 2>/dev/null || true)"
  [[ "$RUN_NODE" == "$NODE_VERSION" ]] || fail "running node $RUN_NODE ≠ pinned $NODE_VERSION (nvm use / setup-node)"
  [[ "$RUN_PNPM" == "$PNPM_VERSION" ]] || fail "running pnpm $RUN_PNPM ≠ pinned $PNPM_VERSION (corepack prepare)"
  ok "runtime node $RUN_NODE / pnpm $RUN_PNPM"
else
  ok "skip runtime match (set REQUIRE_RUNTIME_MATCH=1 or CI=true to enforce)"
fi

# .npmrc must force package manager strictness
rg -qF 'package-manager-strict=true' .npmrc || rg -qF 'pmOnFail: error' pnpm-workspace.yaml || fail "missing pmOnFail: error (pnpm v11) / legacy package-manager-strict"
rg -qF 'package-manager-strict-version=true' .npmrc || rg -qF 'pmOnFail: error' pnpm-workspace.yaml || fail "missing pmOnFail: error (pnpm v11)"
ok "package-manager strict via pmOnFail: error"

echo "toolchain pin check passed."
