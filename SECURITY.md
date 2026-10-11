# Security Policy

## Reporting

Report vulnerabilities privately to the maintainers. Do not open public issues that include private keys, claim secrets, or exploit PoCs against live funds.

## Secrets

Never commit:

- L1 / L2 private keys or secret keys
- `account.json` / `account*.json` exports and `claim-*.json`
- `.env` files (templates `.env.example` and `.env.netlify.example` are the only env files in git)
- Netlify CLI link state under `.netlify/` (site id)
- Keyed dRPC path URLs in `VITE_*` (Vite bakes them into the browser). Public default: `https://aztec-mainnet.drpc.org`.

If secrets were ever committed, **deleting the files does not revoke them**. Rotate accounts / provider keys, move assets from a clean machine, and treat the old keys as burned.

### C-01 rotation checklist (mainnet L2 accounts previously in git history)

1. From a clean machine, inventory balances and permissions for any account whose secret appeared in old `account.json` / `account1.json` exports (including git history from the former CLI).
2. Move assets and revoke authorities to fresh accounts.
3. Inspect onchain / app activity since first exposure (commit `aebfbe8`, 21 July 2026).
4. Only after rotation, consider history rewriting with coordinated disclosure.

## Production posture (app controls — re-verified)

| Control | Status |
|---------|--------|
| Browser claim (Netlify) | `VITE_ENABLE_BROWSER_CLAIM=true`; remote claim API bases are rejected |
| CSP | Explicit allowlist (`csp.ts` ≡ `netlify.toml`); no bare `https:`/`wss:`; no `*.drpc.*` / `*.publicnode.com`. WC/Reown wildcards remain (required) |
| RPC overrides | Localhost or `OFFICIAL_HTTPS_HOST_ALLOWLIST` only |
| Vault | Meta AES-GCM at rest; idle 15m / tab-hidden 5m auto-lock |
| DevGate | Client defense-in-depth; **Netlify visitor password required** on preview hosts |

This kit must not be used with production funds until Critical and High findings from the security review are remediated, C-01 rotation is confirmed, and controls are independently re-tested.

## Dependency / pnpm posture

- Always `pnpm install --frozen-lockfile` (CI, Netlify, local).
- Pin Node in root `package.json#engines.node` (exact `x.y.z`); pin pnpm via Corepack `packageManager` **sha512**. Direct deps are exact versions in each `package.json`; bytes are pinned in `pnpm-lock.yaml`.
- Lifecycle scripts only via `allowBuilds` in `pnpm-workspace.yaml`; see [docs/PNPM_HARDENING.md](docs/PNPM_HARDENING.md).
- Audit overrides in `pnpm-workspace.yaml#overrides` force patched transitive versions (`hono`, `@hono/node-server`, `undici`, `ws`, `axios`, … plus Vite toolchain `postcss@8.5.23`, `nanoid@3.3.18`).
- CI / local gate: `pnpm audit --prod --audit-level=high` (must stay clean). Root script: `pnpm audit` → `--prod`.
- Run `pnpm check:pnpm` after changing `engines.node`, `packageManager`, `pnpm-workspace.yaml`, the lockfile, or install docs.

### Audit status (2026-08-08)

| Scope | Result |
|-------|--------|
| `pnpm audit --prod` | **No known vulnerabilities** |
| `pnpm audit --prod --audit-level=high` | **Clean** |
| `pnpm audit` (includes dev) | **1 low** residual: `elliptic@≤6.6.1` via `vite-plugin-node-polyfills` → `crypto-browserify` ([GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84)). Advisory lists patch `≥6.6.2`, but **6.6.2 is not on npm yet** — accepted until published; then add an override. |

**Cleared this pass (dev/build chain):**

- High [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) `nanoid` → override `3.3.18`
- Moderate [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) / CVE-2026-69153 `postcss` → override `8.5.23`

Re-check after dependency bumps: `pnpm audit --prod` and `pnpm audit`.

See also [docs/OPS.md](docs/OPS.md) for monitoring signals.
