# pnpm supply-chain hardening

Pinned manager: **`pnpm@10.33.2`** (`packageManager` + `engines.pnpm`).  
This is past **CVE-2025-69264** (git-dep lifecycle bypass fixed in **10.26.0**).

## Install rule (everywhere)

```bash
nvm install   # reads .nvmrc → Node 22.23.2
nvm use
corepack enable
corepack prepare "$(node -p "require('./package.json').packageManager")" --activate
pnpm install --frozen-lockfile
pnpm check:toolchain
pnpm check:pnpm
```

Pinned versions + SHA512 digests live in [`tooling/TOOLCHAIN.pins`](../tooling/TOOLCHAIN.pins).
`package.json#packageManager` embeds the Corepack **sha512 hex** pin for pnpm.
Root `devDependencies` **`tsx@4.23.1`** and **`typescript@5.7.3`** are exact (no `^`/`~`); their npm `sha512-` integrity + hex digests are pinned in `TOOLCHAIN.pins` and checked against `pnpm-lock.yaml` by `pnpm check:pnpm`.

## Consumer defenses (`.npmrc`)

| Knob | Purpose |
|------|---------|
| `strict-dep-builds=true` | Fail if a dep wants install scripts but is not allowlisted |
| `pnpm.onlyBuiltDependencies` | Allowlist: `esbuild`, `leveldown`, `lmdb`, `msgpackr-extract`, `protobufjs`, `@reown/appkit` |
| `minimum-release-age=1440` | **Quarantine-ready**: ignore publishes younger than 24h on *new* resolutions |
| `block-exotic-subdeps=true` | Block transitive git/tarball/directory deps |
| `trust-policy=no-downgrade` | Block publish-trust downgrades (OIDC/provenance → token) |
| `verify-deps-before-run=error` | Fail scripts if `node_modules` ≠ lockfile |
| `strict-store-pkg-content-check=true` | Re-verify store tarball bytes vs lockfile integrity |
| `manage-package-manager-versions=true` | Keep packageManager / Corepack pin aligned |
| `package-manager-strict=true` | Require the pinned pnpm |
| `package-manager-strict-version=true` | Exact pnpm version (no drift) |
| `shamefully-hoist=false` | No phantom root deps |
| `registry=https://registry.npmjs.org/` | HTTPS only |
| `scripts.preinstall` → `enforce-pnpm.mjs` | Block npm/yarn; require sha512-pinned pnpm UA |

Every lockfile `packages:` resolution must carry `integrity: sha512-` (`pnpm check:pnpm` enforces **100%** coverage). Workspace `package.json` files pin `engines.node` / `engines.pnpm` to the same exact versions.

Frozen installs skip re-resolution, so quarantine/trust apply when the lockfile is updated.

Also enforced: `.github/workflows/ci.yml`, `netlify.toml` (`NODE_VERSION=22.23.2`), README, `.npmrc` `prefer-frozen-lockfile=true`. Never use bare `pnpm i` / `npm install`.

## Checks

```bash
pnpm check:toolchain     # .nvmrc + packageManager sha512 vs tooling/TOOLCHAIN.pins
pnpm check:pnpm          # lockfile / .npmrc / frozen-install surface
pnpm audit --prod        # advisory scan (transitive Aztec stack may still report highs)
```

## Not covered by package-manager knobs

- Malicious code in an already-locked, allowlisted package with valid provenance
- Runtime compromise after install
- New direct dependencies (require explicit approval + lockfile PR)

See also [SECURITY.md](../SECURITY.md) and [Mondoo / pnpm consumer defenses](https://mondoo.com/blog/npm-supply-chain-security-package-manager-defenses-2026).
