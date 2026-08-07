#!/usr/bin/env bash
# Assert pnpm supply-chain posture (no network, no install).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "OK: $*"; }

[[ -f pnpm-lock.yaml ]] || fail "missing pnpm-lock.yaml"
[[ -f .npmrc ]] || fail "missing .npmrc"
[[ -f package.json ]] || fail "missing package.json"
[[ -f tooling/TOOLCHAIN.pins ]] || fail "missing tooling/TOOLCHAIN.pins"
[[ -f scripts/enforce-pnpm.mjs ]] || fail "missing scripts/enforce-pnpm.mjs"

# shellcheck disable=SC1091
source tooling/TOOLCHAIN.pins

PM="$(node -p "require('./package.json').packageManager||''")"
ENG_PNPM="$(node -p "require('./package.json').engines?.pnpm||''")"
ENG_NODE="$(node -p "require('./package.json').engines?.node||''")"

if [[ ! "$PM" =~ ^pnpm@10\.33\.2\+sha512\.[a-f0-9]{128}$ ]]; then
  fail "packageManager must be pnpm@10.33.2+sha512.<128-hex> (got: ${PM:-empty})"
fi
[[ "$PM" == "$PNPM_PACKAGE_MANAGER" ]] || fail "packageManager != TOOLCHAIN.pins PNPM_PACKAGE_MANAGER"
ok "packageManager=$PM (Corepack sha512 pinned; CVE-2025-69264 fixed since 10.26)"

[[ "$ENG_PNPM" == "$PNPM_VERSION" ]] || fail "engines.pnpm=$ENG_PNPM want $PNPM_VERSION"
[[ "$ENG_NODE" == "$NODE_VERSION" ]] || fail "engines.node=$ENG_NODE want $NODE_VERSION"
ok "engines.node=$ENG_NODE engines.pnpm=$ENG_PNPM"

# sha512 hex ↔ npm integrity (base64) consistency
DERIVED_HEX="$(node -e "const i=process.argv[1]; if(!i.startsWith('sha512-')) process.exit(2); process.stdout.write(Buffer.from(i.slice(7),'base64').toString('hex'));" "$PNPM_NPM_INTEGRITY")"
EXPECTED_HEX="${PNPM_PACKAGE_MANAGER#*+sha512.}"
[[ "$DERIVED_HEX" == "$EXPECTED_HEX" ]] || fail "pnpm sha512 hex does not match npm integrity derivation"
[[ "$EXPECTED_HEX" == "${PM#*+sha512.}" ]] || fail "packageManager hex drift"
ok "pnpm sha512 hex ↔ npm integrity consistent"

LOCK_VER="$(node -p "require('fs').readFileSync('pnpm-lock.yaml','utf8').match(/^lockfileVersion:\\s*['\\\"]?([^'\\\"\\n]+)/)?.[1]||''")"
[[ "$LOCK_VER" == "9.0" ]] || fail "unexpected lockfileVersion=$LOCK_VER"
ok "lockfileVersion=$LOCK_VER"

# No exotic resolutions in the lockfile (git/github/tarball/directory).
if rg -n "type: (git|directory|tarball)|git\\+|github:|bitbucket:|gitlab:" pnpm-lock.yaml >/dev/null; then
  fail "exotic (git/tarball/directory) resolutions found in pnpm-lock.yaml"
fi
ok "no exotic git/tarball/directory resolutions"

# Every packages: resolution must carry integrity: sha512- (100% coverage).
node <<'EOF' || fail "lockfile integrity coverage incomplete"
const fs = require("fs");
const text = fs.readFileSync("pnpm-lock.yaml", "utf8");
const packagesIdx = text.indexOf("\npackages:\n");
if (packagesIdx < 0) { console.error("no packages: section"); process.exit(2); }
const snapIdx = text.indexOf("\nsnapshots:\n");
const section = text.slice(packagesIdx, snapIdx > 0 ? snapIdx : undefined);
const resolutions = [...section.matchAll(/^\s{2}\S.*:\n(?:.*\n)*?\s{4}resolution: \{([^}]+)\}/gm)];
let missing = 0, sha512 = 0, other = 0;
for (const m of resolutions) {
  const body = m[1];
  if (/integrity: sha512-/.test(body)) sha512++;
  else if (/integrity:/.test(body)) other++;
  else missing++;
}
if (!resolutions.length) { console.error("no resolutions parsed"); process.exit(2); }
if (missing || other) {
  console.error(JSON.stringify({ resolutions: resolutions.length, sha512, other, missing }));
  process.exit(2);
}
console.log(`OK: ${sha512}/${resolutions.length} packages resolutions have integrity sha512`);
EOF

for key in \
  prefer-frozen-lockfile=true \
  lockfile=true \
  package-manager-strict=true \
  package-manager-strict-version=true \
  strict-dep-builds=true \
  minimum-release-age=1440 \
  block-exotic-subdeps=true \
  trust-policy=no-downgrade \
  verify-deps-before-run=error \
  engine-strict=true \
  fund=false \
  shamefully-hoist=false \
  confirm-modules-purge=false \
  strict-store-pkg-content-check=true \
  manage-package-manager-versions=true \
  'registry=https://registry.npmjs.org/'
do
  rg -qF -- "$key" .npmrc || fail ".npmrc missing: $key"
done
ok ".npmrc hardened keys present"

node -e "
const p=require('./package.json');
const list=p.pnpm?.onlyBuiltDependencies;
if (!Array.isArray(list) || !list.length) process.exit(2);
const pre=p.scripts?.preinstall||'';
if (!pre.includes('enforce-pnpm')) process.exit(3);
" || fail "onlyBuiltDependencies allowlist + scripts.preinstall enforce-pnpm required"
ok "onlyBuiltDependencies allowlist + preinstall enforce-pnpm present"

for f in .github/workflows/ci.yml netlify.toml README.md; do
  rg -q 'pnpm install --frozen-lockfile' "$f" || fail "$f must use pnpm install --frozen-lockfile"
done
ok "CI / Netlify / README enforce frozen-lockfile"

# Discourage bare pnpm i / npm install in project docs & workflows (allow comments).
if rg -n '^\s*(run:\s*)?(pnpm i\b|pnpm install[^-]|npm i\b|npm install\b|yarn install\b)' \
  .github/workflows/ci.yml netlify.toml 2>/dev/null | rg -v 'frozen-lockfile'; then
  fail "non-frozen install command found in CI/Netlify"
fi
ok "no non-frozen install in CI/Netlify"

# Root devDependencies tsx / typescript: exact versions + lockfile integrity ↔ TOOLCHAIN.pins.
node -e '
const fs = require("fs");
const [wantTsx, wantTs, wantTsxInt, wantTsInt, wantTsxHex, wantTsHex] = process.argv.slice(1);
const root = JSON.parse(fs.readFileSync("package.json", "utf8"));
if (root.devDependencies?.tsx !== wantTsx) {
  console.error("package.json tsx want " + wantTsx + " got " + root.devDependencies?.tsx);
  process.exit(2);
}
if (root.devDependencies?.typescript !== wantTs) {
  console.error("package.json typescript want " + wantTs + " got " + root.devDependencies?.typescript);
  process.exit(2);
}
function hexFromIntegrity(i) {
  if (!i || !i.startsWith("sha512-")) process.exit(3);
  return Buffer.from(i.slice(7), "base64").toString("hex");
}
if (hexFromIntegrity(wantTsxInt) !== wantTsxHex) {
  console.error("TSX_SHA512_HEX != derivation from TSX_NPM_INTEGRITY");
  process.exit(2);
}
if (hexFromIntegrity(wantTsInt) !== wantTsHex) {
  console.error("TYPESCRIPT_SHA512_HEX != derivation from TYPESCRIPT_NPM_INTEGRITY");
  process.exit(2);
}
const lock = fs.readFileSync("pnpm-lock.yaml", "utf8");
function lockIntegrity(pkgVer) {
  const re = new RegExp(
    "^  " + pkgVer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":\\n    resolution: \\{integrity: (sha512-[A-Za-z0-9+/=]+)\\}",
    "m",
  );
  const m = lock.match(re);
  return m?.[1] || "";
}
const lockTsx = lockIntegrity("tsx@" + wantTsx);
const lockTs = lockIntegrity("typescript@" + wantTs);
if (lockTsx !== wantTsxInt) {
  console.error("lockfile tsx@" + wantTsx + " integrity drift");
  console.error("  lock: " + lockTsx);
  console.error("  pin:  " + wantTsxInt);
  process.exit(2);
}
if (lockTs !== wantTsInt) {
  console.error("lockfile typescript@" + wantTs + " integrity drift");
  console.error("  lock: " + lockTs);
  console.error("  pin:  " + wantTsInt);
  process.exit(2);
}
if (!new RegExp("tsx:\\n        specifier: " + wantTsx.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\n").test(lock)) {
  console.error("root importer tsx specifier must be exact " + wantTsx);
  process.exit(2);
}
if (!new RegExp("typescript:\\n        specifier: " + wantTs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\n").test(lock)) {
  console.error("root importer typescript specifier must be exact " + wantTs);
  process.exit(2);
}
console.log("OK: root tsx@" + wantTsx + " + typescript@" + wantTs + " sha512 pinned");
' \
  "$TSX_VERSION" \
  "$TYPESCRIPT_VERSION" \
  "$TSX_NPM_INTEGRITY" \
  "$TYPESCRIPT_NPM_INTEGRITY" \
  "$TSX_SHA512_HEX" \
  "$TYPESCRIPT_SHA512_HEX" \
  || fail "root tsx/typescript sha512 pins drift"

# Workspace packages must declare exact engines (inherit root pins).
node <<EOF || fail "workspace package engines incomplete"
const fs = require("fs");
const path = require("path");
const root = JSON.parse(fs.readFileSync("package.json","utf8"));
const wantNode = root.engines.node;
const wantPnpm = root.engines.pnpm;
const pkgs = [
  "apps/web/package.json",
  "apps/api/package.json",
  "apps/cli/package.json",
  "packages/core/package.json",
  "packages/browser-sdk/package.json",
];
for (const rel of pkgs) {
  const p = JSON.parse(fs.readFileSync(rel,"utf8"));
  if (p.engines?.node !== wantNode) {
    console.error(rel + " engines.node want " + wantNode + " got " + p.engines?.node);
    process.exit(2);
  }
  if (p.engines?.pnpm !== wantPnpm) {
    console.error(rel + " engines.pnpm want " + wantPnpm + " got " + p.engines?.pnpm);
    process.exit(2);
  }
}
console.log("OK: workspace engines.node/pnpm pinned on all packages");
EOF

echo "pnpm hardening check passed."
