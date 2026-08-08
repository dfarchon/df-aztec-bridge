# Security Policy

## Reporting

Report vulnerabilities privately to the maintainers. Do not open public issues that include private keys, claim secrets, or exploit PoCs against live funds.

## Secrets

Never commit:

- L1 / L2 private keys or secret keys
- `account.json` / `account*.json` exports
- `.env` files
- API job dumps under `data/`

If secrets were ever committed, **deleting the files does not revoke them**. Rotate accounts, move assets from a clean machine, and treat the old keys as burned.

### C-01 rotation checklist (mainnet L2 accounts previously in git history)

1. From a clean machine, inventory balances and permissions for any account whose secret appeared in `apps/cli/account.json` or `apps/cli/account1.json`.
2. Move assets and revoke authorities to fresh accounts.
3. Inspect onchain / app activity since first exposure (commit `aebfbe8`, 21 July 2026).
4. Only after rotation, consider history rewriting with coordinated disclosure.

## Production posture

This kit must not be used with production funds until Critical and High findings from the security review are remediated and independently re-tested. The HTTP API must stay loopback-only (or offline) unless authentication, authorization, spend limits, and secret handling are verified.

## Dependency / pnpm posture

- Always `pnpm install --frozen-lockfile` (CI, Netlify, local).
- Pin Node via `.nvmrc` / `.node-version` → **24.12.0**; pnpm via Corepack `packageManager` **sha512** (see `tooling/TOOLCHAIN.pins`).
- Lifecycle scripts only via `allowBuilds` in `pnpm-workspace.yaml`; see [docs/PNPM_HARDENING.md](docs/PNPM_HARDENING.md).
- Audit overrides in `pnpm-workspace.yaml#overrides` force patched transitive versions (`hono`, `@hono/node-server`, `undici`, `systeminformation`, `ws`, `axios`, `brace-expansion`, OpenTelemetry, `uuid`). Keep majors compatible with `@aztec/*`.
- CI runs `pnpm audit --prod --audit-level=high` (fails the job on high/critical).
- Run `pnpm check:toolchain` and `pnpm check:pnpm` after changing toolchain pins, `.npmrc`, the lockfile, or install docs.

See also [docs/OPS.md](docs/OPS.md) for monitoring signals and [CODEOWNERS](CODEOWNERS) for review paths.
