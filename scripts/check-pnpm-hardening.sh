#!/usr/bin/env bash
# Assert pnpm supply-chain posture (no network, no install).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "OK: $*"; }

[[ -f pnpm-lock.yaml ]] || fail "missing pnpm-lock.yaml"
[[ ! -e .nvmrc ]] || fail ".nvmrc must not exist; Node pin is package.json#engines.node"
[[ -f package.json ]] || fail "missing package.json"
[[ -f scripts/enforce-pnpm.mjs ]] || fail "missing scripts/enforce-pnpm.mjs"

PM="$(node -p "require('./package.json').packageManager||''")"
if [[ ! "$PM" =~ ^pnpm@[0-9]+\.[0-9]+\.[0-9]+\+sha512\.[a-f0-9]{128}$ ]]; then
  fail "packageManager must be pnpm@<ver>+sha512.<128-hex> (got: ${PM:-empty})"
fi
ok "packageManager=$PM (Corepack sha512 pinned)"

NODE_PIN="$(node -p "require('./package.json').engines?.node||''")"
[[ "$NODE_PIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "engines.node must be an exact x.y.z (got: ${NODE_PIN:-empty})"
ok "engines.node=$NODE_PIN"

# Netlify does not read engines.node. NODE_VERSION in netlify.toml must match it.
NETLIFY_NODE="$(node <<'EOF'
const fs = require("fs");
const text = fs.readFileSync("netlify.toml", "utf8");
const m = text.match(/^\s*NODE_VERSION\s*=\s*"([^"]+)"/m);
if (!m) {
  console.error("netlify.toml [build.environment] must set NODE_VERSION");
  process.exit(2);
}
process.stdout.write(m[1]);
EOF
)" || fail "netlify.toml NODE_VERSION missing or unreadable"
[[ "$NETLIFY_NODE" == "$NODE_PIN" ]] || fail "netlify.toml NODE_VERSION=$NETLIFY_NODE must equal engines.node=$NODE_PIN"
ok "netlify NODE_VERSION=$NETLIFY_NODE matches engines.node"

# pnpm 12 (pmOnFail) prepends an env document. The project graph is the last document.
LOCK_VER="$(node <<'EOF'
const fs = require("fs");
const text = fs.readFileSync("pnpm-lock.yaml", "utf8");
const docs = text.startsWith("---\n")
  ? text.split(/\n---\n/).map((part, i) => (i === 0 ? part.replace(/^---\n/, "") : part))
  : [text];
const project = docs[docs.length - 1];
const m = project.match(/^lockfileVersion:\s*['"]?([^'"\n]+)/);
process.stdout.write(m ? m[1] : "");
EOF
)"
[[ "$LOCK_VER" == "9.0" ]] || fail "unexpected lockfileVersion=$LOCK_VER"
ok "lockfileVersion=$LOCK_VER"

# No exotic resolutions in the lockfile (git/github/tarball/directory).
# Use grep (not ripgrep) so CI / fresh clones work without installing rg.
if grep -nE "type: (git|directory|tarball)|git\\+|github:|bitbucket:|gitlab:" pnpm-lock.yaml >/dev/null; then
  fail "exotic (git/tarball/directory) resolutions found in pnpm-lock.yaml"
fi
ok "no exotic git/tarball/directory resolutions"

# Every packages: resolution must carry integrity: sha512- (100% coverage).
node <<'EOF' || fail "lockfile integrity coverage incomplete"
const fs = require("fs");
const text = fs.readFileSync("pnpm-lock.yaml", "utf8");
const docs = text.startsWith("---\n")
  ? text.split(/\n---\n/).map((part, i) => (i === 0 ? part.replace(/^---\n/, "") : part))
  : [text];
const sections = [];
for (const doc of docs) {
  const packagesIdx = doc.indexOf("\npackages:\n");
  if (packagesIdx < 0) continue;
  const snapIdx = doc.indexOf("\nsnapshots:\n", packagesIdx);
  sections.push(doc.slice(packagesIdx, snapIdx > 0 ? snapIdx : undefined));
}
if (!sections.length) { console.error("no packages: section"); process.exit(2); }
const section = sections.join("\n");
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

node <<'EOF' || fail "pnpm-workspace.yaml hardening + allowBuilds + preinstall enforce-pnpm required"
const fs = require("fs");
const text = fs.readFileSync("pnpm-workspace.yaml", "utf8");
const need = [
  "registry: https://registry.npmjs.org/",
  "saveExact: true",
  "preferFrozenLockfile: true",
  "lockfile: true",
  "pmOnFail: error",
  "strictDepBuilds: true",
  "minimumReleaseAge: 1440",
  "blockExoticSubdeps: true",
  "trustPolicy: no-downgrade",
  "trustLockfile: true",
  "verifyDepsBeforeRun: error",
  "shamefullyHoist: false",
  "strictStorePkgContentCheck: true",
  "allowBuilds:",
];
for (const k of need) {
  if (!text.includes(k)) {
    console.error("pnpm-workspace.yaml missing: " + k);
    process.exit(2);
  }
}
if (/^confirmModulesPurge\s*:/m.test(text)) {
  console.error("confirmModulesPurge is pnpm 11 only; pnpm 12 rejects it");
  process.exit(2);
}
const builds = [
  "esbuild: true",
  "leveldown: true",
  "lmdb: true",
  "msgpackr-extract: true",
  "protobufjs: true",
  '"@reown/appkit": true',
];
for (const b of builds) {
  if (!text.includes(b)) {
    console.error("allowBuilds missing: " + b);
    process.exit(3);
  }
}
const p = require("./package.json");
if (p.pnpm) {
  console.error("package.json#pnpm must be removed; settings live in pnpm-workspace.yaml");
  process.exit(4);
}
const nodePin = p.engines?.node;
const engineKeys = Object.keys(p.engines || {});
if (!/^\d+\.\d+\.\d+$/.test(String(nodePin || "")) || engineKeys.length !== 1 || engineKeys[0] !== "node") {
  console.error("package.json#engines must be { node: \"<exact x.y.z>\" } only; pnpm stays in packageManager");
  process.exit(6);
}
const pre = p.scripts?.preinstall || "";
if (!pre.includes("enforce-pnpm")) process.exit(5);
if (p.scripts?.["check:toolchain"]) {
  console.error("check:toolchain was removed; use preinstall + check:pnpm");
  process.exit(7);
}
EOF
ok "pnpm-workspace.yaml hardened + allowBuilds + preinstall enforce-pnpm present"

for f in .github/workflows/ci.yml netlify.toml README.md; do
  grep -qF 'pnpm install --frozen-lockfile' "$f" || fail "$f must use pnpm install --frozen-lockfile"
done
grep -qF 'corepack prepare' netlify.toml || fail "netlify.toml must corepack-prepare packageManager"
ok "CI / Netlify / README enforce frozen-lockfile"

# Discourage bare pnpm i / npm install in project docs & workflows (allow comments).
if grep -nE '^\s*(run:\s*)?(pnpm i\b|pnpm install[^-]|npm i\b|npm install\b|yarn install\b)' \
  .github/workflows/ci.yml netlify.toml 2>/dev/null | grep -v 'frozen-lockfile'; then
  fail "non-frozen install command found in CI/Netlify"
fi
ok "no non-frozen install in CI/Netlify"

# Direct deps: exact versions in package.json, matching lockfile importer specifiers.
node <<'EOF' || fail "direct dependency specifiers are not exact or drift from lockfile"
const fs = require("fs");
const exact = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.]+)*$/;
const pkgs = [
  { rel: "package.json", importer: "." },
  { rel: "apps/web/package.json", importer: "apps/web" },
  { rel: "packages/browser-sdk/package.json", importer: "packages/browser-sdk" },
];

function collect(p) {
  return { ...(p.dependencies || {}), ...(p.devDependencies || {}) };
}

function projectLockfile(text) {
  if (!text.startsWith("---\n")) return text;
  const docs = text.split(/\n---\n/).map((part, i) => (i === 0 ? part.replace(/^---\n/, "") : part));
  return docs[docs.length - 1];
}

function parseImporters(text) {
  const project = projectLockfile(text);
  const start = project.indexOf("\nimporters:\n");
  const end = project.indexOf("\npackages:\n");
  if (start < 0 || end < 0) throw new Error("lockfile missing importers/packages");
  const block = project.slice(start + "\nimporters:\n".length, end);
  const lines = block.split("\n");
  const out = {};
  let current = null;
  let name = null;
  for (const line of lines) {
    const importer = line.match(/^  (\S+):$/);
    if (importer) {
      current = importer[1];
      out[current] = {};
      name = null;
      continue;
    }
    const dep = line.match(/^      (\S+):$/);
    if (dep && current) {
      name = dep[1].replace(/^['"]|['"]$/g, "");
      continue;
    }
    const spec = line.match(/^        specifier: (.+)$/);
    if (spec && current && name) {
      out[current][name] = spec[1];
    }
  }
  return out;
}

const importers = parseImporters(fs.readFileSync("pnpm-lock.yaml", "utf8"));
for (const { rel, importer } of pkgs) {
  const p = JSON.parse(fs.readFileSync(rel, "utf8"));
  if (rel !== "package.json" && p.engines) {
    console.error(rel + " must not set engines; Node pin is the root package.json");
    process.exit(2);
  }
  const deps = collect(p);
  const lockSpecs = importers[importer] || {};
  for (const [name, spec] of Object.entries(deps)) {
    if (String(spec).startsWith("workspace:")) {
      if (lockSpecs[name] !== spec) {
        console.error(rel + " " + name + " lock specifier want " + spec + " got " + lockSpecs[name]);
        process.exit(2);
      }
      continue;
    }
    if (!exact.test(spec)) {
      console.error(rel + " " + name + " must be an exact version, got " + spec);
      process.exit(2);
    }
    if (lockSpecs[name] !== spec) {
      console.error(rel + " " + name + " lock specifier want " + spec + " got " + lockSpecs[name]);
      process.exit(2);
    }
  }
  for (const name of Object.keys(lockSpecs)) {
    if (!(name in deps)) {
      console.error(rel + " missing " + name + " present in lockfile importer " + importer);
      process.exit(2);
    }
  }
}
console.log("OK: direct dependency specifiers are exact and match the lockfile");
EOF

echo "pnpm hardening check passed."
