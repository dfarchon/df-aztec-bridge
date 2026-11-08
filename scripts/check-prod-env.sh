#!/usr/bin/env bash
# Assert production / Netlify env posture (no network, no install).
# Blocks remote claim API bases, accidental maintenance bricking, fee/FPC pin drift,
# and CSP drift between apps/web/src/lib/csp.ts and netlify.toml.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "OK: $*"; }

[[ -f netlify.toml ]] || fail "missing netlify.toml"
[[ -f .env.example ]] || fail "missing .env.example"
[[ -f apps/web/src/lib/fee-recipient.ts ]] || fail "missing fee-recipient.ts"
[[ -f apps/web/src/lib/sponsored-fpc.ts ]] || fail "missing sponsored-fpc.ts"
[[ -f apps/web/src/lib/csp.ts ]] || fail "missing csp.ts"

# --- netlify.toml [build.environment] ---
CLAIM="$(node <<'EOF'
const fs = require("fs");
const text = fs.readFileSync("netlify.toml", "utf8");
const m = text.match(/^\s*VITE_ENABLE_BROWSER_CLAIM\s*=\s*"([^"]*)"/m);
if (!m) process.exit(2);
process.stdout.write(m[1]);
EOF
)" || fail "netlify.toml must set VITE_ENABLE_BROWSER_CLAIM"
[[ "$CLAIM" == "true" ]] || fail "netlify.toml VITE_ENABLE_BROWSER_CLAIM must be \"true\" (got: $CLAIM)"
ok "netlify VITE_ENABLE_BROWSER_CLAIM=true"

if grep -E '^\s*VITE_MAINTENANCE_MODE\s*=\s*"true"' netlify.toml >/dev/null; then
  fail "netlify.toml must not bake VITE_MAINTENANCE_MODE=true into the default production build"
fi
ok "netlify does not pin VITE_MAINTENANCE_MODE=true"

if grep -E '^\s*VITE_API_BASE\s*=' netlify.toml >/dev/null; then
  API_BASE="$(node <<'EOF'
const fs = require("fs");
const text = fs.readFileSync("netlify.toml", "utf8");
const m = text.match(/^\s*VITE_API_BASE\s*=\s*"([^"]*)"/m);
if (!m) process.exit(2);
process.stdout.write(m[1]);
EOF
)" || fail "unreadable VITE_API_BASE in netlify.toml"
  case "$API_BASE" in
    /api|/api/*) ;;
    http://127.0.0.1*|http://localhost*|https://127.0.0.1*|https://localhost*) ;;
    *) fail "netlify.toml VITE_API_BASE must be /api or loopback (got: $API_BASE)" ;;
  esac
  ok "netlify VITE_API_BASE=$API_BASE"
else
  ok "netlify omits VITE_API_BASE (defaults to /api)"
fi

# --- Pinned fee recipient + Sponsored FPC (code constants ≡ netlify.toml ≡ .env.example) ---
node <<'EOF' || fail "pinned fee / Sponsored FPC / CSP checks failed"
const fs = require("fs");

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}
function ok(msg) {
  console.log("OK:", msg);
}

function extractExportedString(src, name) {
  const re = new RegExp(
    String.raw`export\s+const\s+${name}\s*=\s*\n?\s*"([^"]+)"`,
  );
  const m = src.match(re);
  if (!m) fail(`could not parse export const ${name} from source`);
  return m[1];
}

function extractStringArray(src, name) {
  const re = new RegExp(
    String.raw`export\s+const\s+${name}\s*=\s*\[([\s\S]*?)\]\s*as\s+const`,
  );
  const m = src.match(re);
  if (!m) fail(`could not parse export const ${name} array from csp.ts`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

function tomlEnv(text, key) {
  const m = text.match(new RegExp(String.raw`^\s*${key}\s*=\s*"([^"]*)"`, "m"));
  return m ? m[1] : null;
}

function exampleEnv(text, key) {
  const m = text.match(new RegExp(String.raw`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : null;
}

const feeSrc = fs.readFileSync("apps/web/src/lib/fee-recipient.ts", "utf8");
const fpcSrc = fs.readFileSync("apps/web/src/lib/sponsored-fpc.ts", "utf8");
const cspSrc = fs.readFileSync("apps/web/src/lib/csp.ts", "utf8");
const toml = fs.readFileSync("netlify.toml", "utf8");
const example = fs.readFileSync(".env.example", "utf8");

const CANONICAL_FEE = extractExportedString(feeSrc, "CANONICAL_BRIDGE_FEE_RECIPIENT");
const CANONICAL_FPC = extractExportedString(fpcSrc, "CANONICAL_SPONSORED_FPC_ADDRESS");

const netlifyFee = tomlEnv(toml, "VITE_BRIDGE_FEE_RECIPIENT");
if (!netlifyFee) fail('netlify.toml must set VITE_BRIDGE_FEE_RECIPIENT');
if (netlifyFee.toLowerCase() !== CANONICAL_FEE.toLowerCase()) {
  fail(
    `netlify.toml VITE_BRIDGE_FEE_RECIPIENT=${netlifyFee} must equal CANONICAL_BRIDGE_FEE_RECIPIENT=${CANONICAL_FEE}`,
  );
}
ok(`netlify VITE_BRIDGE_FEE_RECIPIENT pinned (${CANONICAL_FEE})`);

const netlifyFpc = tomlEnv(toml, "VITE_SPONSORED_FPC_ADDRESS");
if (!netlifyFpc) fail('netlify.toml must set VITE_SPONSORED_FPC_ADDRESS');
if (netlifyFpc.toLowerCase() !== CANONICAL_FPC.toLowerCase()) {
  fail(
    `netlify.toml VITE_SPONSORED_FPC_ADDRESS=${netlifyFpc} must equal CANONICAL_SPONSORED_FPC_ADDRESS=${CANONICAL_FPC}`,
  );
}
ok(`netlify VITE_SPONSORED_FPC_ADDRESS pinned (${CANONICAL_FPC.slice(0, 10)}…)`);

const exampleFee = exampleEnv(example, "VITE_BRIDGE_FEE_RECIPIENT");
if (exampleFee && exampleFee.toLowerCase() !== CANONICAL_FEE.toLowerCase()) {
  fail(`.env.example VITE_BRIDGE_FEE_RECIPIENT=${exampleFee} must be empty or ${CANONICAL_FEE}`);
}
ok(".env.example VITE_BRIDGE_FEE_RECIPIENT empty or canonical");

const exampleFpc = exampleEnv(example, "VITE_SPONSORED_FPC_ADDRESS");
if (exampleFpc && exampleFpc.toLowerCase() !== CANONICAL_FPC.toLowerCase()) {
  fail(`.env.example VITE_SPONSORED_FPC_ADDRESS must be empty or canonical`);
}
ok(".env.example VITE_SPONSORED_FPC_ADDRESS empty or canonical");

const baseM = cspSrc.match(/const\s+CSP_BASE\s*=\s*\n?\s*"([^"]+)"/);
if (!baseM) fail("could not parse CSP_BASE from csp.ts");
const connectHosts = extractStringArray(cspSrc, "CSP_CONNECT_HOSTS");
const frameHosts = extractStringArray(cspSrc, "CSP_FRAME_HOSTS");
if (connectHosts.length < 10) fail("CSP_CONNECT_HOSTS parse looks incomplete");
if (frameHosts.length < 2) fail("CSP_FRAME_HOSTS parse looks incomplete");

const expectedCsp = `${baseM[1]}; connect-src ${connectHosts.join(" ")}; frame-src ${frameHosts.join(" ")}`;
const cspM = toml.match(/Content-Security-Policy\s*=\s*"([^"]+)"/);
if (!cspM) fail("netlify.toml must declare Content-Security-Policy");
if (cspM[1] !== expectedCsp) {
  fail(
    "netlify.toml Content-Security-Policy does not match buildProductionCsp() from apps/web/src/lib/csp.ts",
  );
}
ok("netlify.toml Content-Security-Policy ≡ csp.ts buildProductionCsp()");
EOF

# --- .env.example template ---
EXAMPLE_CLAIM="$(grep -E '^VITE_ENABLE_BROWSER_CLAIM=' .env.example | head -1 | cut -d= -f2- || true)"
[[ "$EXAMPLE_CLAIM" == "true" ]] || fail ".env.example VITE_ENABLE_BROWSER_CLAIM must be true (got: ${EXAMPLE_CLAIM:-empty})"
ok ".env.example VITE_ENABLE_BROWSER_CLAIM=true"

EXAMPLE_MAINT="$(grep -E '^VITE_MAINTENANCE_MODE=' .env.example | head -1 | cut -d= -f2- || true)"
[[ "$EXAMPLE_MAINT" != "true" ]] || fail ".env.example must not set VITE_MAINTENANCE_MODE=true"
ok ".env.example does not enable maintenance mode"

if grep -E '^VITE_API_BASE=' .env.example >/dev/null; then
  EXAMPLE_API="$(grep -E '^VITE_API_BASE=' .env.example | head -1 | cut -d= -f2-)"
  case "$EXAMPLE_API" in
    ""|/api|/api/*) ;;
    http://127.0.0.1*|http://localhost*|https://127.0.0.1*|https://localhost*) ;;
    *) fail ".env.example VITE_API_BASE must be empty, /api, or loopback (got: $EXAMPLE_API)" ;;
  esac
fi
ok "production env templates reject remote claim API bases"

echo "check-prod-env: all checks passed"
