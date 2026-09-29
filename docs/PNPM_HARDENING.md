# pnpm supply-chain hardening

Pinned manager: **`pnpm@11.20.0`** (`packageManager` + `engines.pnpm`).

## Install rule (everywhere)

```bash
nvm install   # reads .nvmrc → Node 24.12.0
nvm use
corepack enable
corepack prepare "$(node -p "require('./package.json').packageManager")" --activate
pnpm install --frozen-lockfile
pnpm check:toolchain
pnpm check:pnpm
```

Pinned versions + SHA512 digests live in [`TOOLCHAIN.pins`](../TOOLCHAIN.pins).
`package.json#packageManager` embeds the Corepack **sha512 hex** pin for pnpm.
Root `devDependencies` **`tsx@4.23.1`** and **`typescript@5.7.3`** are exact (no `^`/`~`); their npm `sha512-` integrity + hex digests are pinned in `TOOLCHAIN.pins` and checked against `pnpm-lock.yaml` by `pnpm check:pnpm`.

## Consumer defenses (`pnpm-workspace.yaml` + `.npmrc`)

pnpm **v11+** reads hardening from `pnpm-workspace.yaml`. `.npmrc` is **registry/auth only**.

| Knob | Purpose |
|------|---------|
| `strictDepBuilds: true` | Fail if a dep wants install scripts but is not allowlisted |
| `allowBuilds` | Allowlist lifecycle scripts (`esbuild`, `leveldown`, …) |
| `minimumReleaseAge: 1440` | **Quarantine-ready**: ignore publishes younger than 24h on *new* resolutions |
| `blockExoticSubdeps: true` | Block transitive git/tarball/directory deps |
| `trustPolicy: no-downgrade` | Block publish-trust downgrades on *new* resolutions |
| `trustLockfile: true` | Trust committed `pnpm-lock.yaml` (skip live re-verify of old pins) |
| `verifyDepsBeforeRun: error` | Fail scripts if `node_modules` ≠ lockfile |
| `strictStorePkgContentCheck: true` | Re-verify store tarball bytes vs lockfile integrity |
| `pmOnFail: error` | Exact Corepack `packageManager` pin |
| `shamefullyHoist: false` | No phantom root deps |
| `.npmrc` `registry=https://registry.npmjs.org/` | HTTPS only |
| `scripts.preinstall` → `enforce-pnpm.mjs` | Block npm/yarn; require sha512-pinned pnpm UA |

Every lockfile `packages:` resolution must carry `integrity: sha512-` (`pnpm check:pnpm` enforces **100%** coverage). Workspace `package.json` files pin `engines.node` / `engines.pnpm` to the same exact versions.

Frozen installs skip re-resolution, so quarantine/trust apply when the lockfile is updated.

Also enforced: `.github/workflows/ci.yml`, `netlify.toml` (`NODE_VERSION=24.12.0`), README, `preferFrozenLockfile: true`. Never use bare `pnpm i` / `npm install`.

## Checks

```bash
pnpm check:toolchain     # .nvmrc + packageManager sha512 vs TOOLCHAIN.pins
pnpm check:pnpm          # lockfile / .npmrc / frozen-install surface
pnpm audit --prod        # advisory scan (transitive Aztec stack may still report highs)
```

## Not covered by package-manager knobs

- Malicious code in an already-locked, allowlisted package with valid provenance
- Runtime compromise after install
- New direct dependencies (require explicit approval + lockfile PR)

See also [SECURITY.md](../SECURITY.md) and [Mondoo / pnpm consumer defenses](https://mondoo.com/blog/npm-supply-chain-security-package-manager-defenses-2026).
