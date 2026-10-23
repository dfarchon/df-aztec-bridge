# pnpm supply-chain hardening

Versions live in three places. Every install path reads those three and fails if they do not match.

| What | Where |
|------|--------|
| Node | root [`package.json`](../package.json) `engines.node` (exact) |
| pnpm | root `package.json#packageManager` (version + Corepack sha512) |
| npm packages | workspace `package.json` exact versions + [`pnpm-lock.yaml`](../pnpm-lock.yaml) sha512 |

## Install rule (everywhere)

```bash
nvm install 24.22.1 && nvm use 24.22.1   # package.json#engines.node
corepack enable
corepack prepare "$(node -p "require('./package.json').packageManager")" --activate
pnpm install --frozen-lockfile
pnpm check:pnpm
```

`scripts/preinstall` (`enforce-pnpm.mjs`) rejects npm/yarn, a Node version that is not `engines.node`, and a pnpm version that is not `packageManager`. Direct dependencies must be exact versions (no `^` / `~`); `pnpm add` writes exact versions because `pnpm-workspace.yaml` sets `saveExact: true`. Transitive versions stay in the lockfile and in `pnpm-workspace.yaml#overrides`.

## Four paths

- **Local `pnpm web`.** Same install command. `verifyDepsBeforeRun: error` fails if `node_modules` drifts from the lockfile.
- **GitHub CI.** `.github/workflows/ci.yml` uses `node-version-file: package.json` (reads `engines.node`), Corepack from `packageManager`, then `pnpm install --frozen-lockfile`.
- **Netlify from GitHub.** `netlify.toml` runs the same Corepack + frozen install + build. Netlify does not read `engines.node`; `[build.environment] NODE_VERSION` must equal it. Do not set `NODE_VERSION` or `PNPM_VERSION` in the Netlify UI (a UI value overrides the file).
- **Local build then `npx netlify deploy`.** Netlify uploads `apps/web/dist`. Consistency is the local install + build above.

## Consumer defenses (`pnpm-workspace.yaml`)

pnpm **v12** reads all hardening from `pnpm-workspace.yaml`.

| Knob | Purpose |
|------|---------|
| `registry: https://registry.npmjs.org/` | Force HTTPS npm registry; fail check if changed |
| `saveExact: true` | `pnpm add` writes exact versions |
| `strictDepBuilds: true` | Fail if a dep wants install scripts but is not allowlisted |
| `allowBuilds` | Allowlist lifecycle scripts (`esbuild`, `leveldown`, …) |
| `minimumReleaseAge: 1440` | Ignore publishes younger than 24h on *new* resolutions |
| `blockExoticSubdeps: true` | Block transitive git/tarball/directory deps |
| `trustPolicy: no-downgrade` | Block publish-trust downgrades on *new* resolutions |
| `trustLockfile: true` | Trust committed `pnpm-lock.yaml` |
| `verifyDepsBeforeRun: error` | Fail scripts if `node_modules` ≠ lockfile |
| `strictStorePkgContentCheck: true` | Re-verify store tarball bytes vs lockfile integrity |
| `pmOnFail: error` | Exact Corepack `packageManager` pin |
| `shamefullyHoist: false` | No phantom root deps |
| `scripts.preinstall` → `enforce-pnpm.mjs` | Block npm/yarn; require exact `engines.node` and sha512-pinned pnpm |

Every lockfile `packages:` resolution must carry `integrity: sha512-` (`pnpm check:pnpm` enforces **100%** coverage). pnpm 12 writes a leading env document in `pnpm-lock.yaml` (the package-manager pin); the project graph is the last document, and the check reads that one for importers.

Frozen installs skip re-resolution, so quarantine/trust apply when the lockfile is updated.

Never use bare `pnpm i` / `npm install`.

## Checks

```bash
pnpm check:pnpm          # lockfile / exact specifiers / frozen-install surface
pnpm audit --prod        # advisory scan (transitive Aztec stack may still report highs)
```

## Not covered by package-manager knobs

- Malicious code in an already-locked, allowlisted package with valid provenance
- Runtime compromise after install
- New direct dependencies (require explicit approval + lockfile PR)

See also [SECURITY.md](../SECURITY.md) and [Mondoo / pnpm consumer defenses](https://mondoo.com/blog/npm-supply-chain-security-package-manager-defenses-2026).
