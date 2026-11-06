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
- CI / local gate: `pnpm audit --prod --audit-level=high` (the job must fail on high; do not set `continue-on-error`). Root script: `pnpm audit` → `--prod`.
- Run `pnpm check:pnpm` after changing `engines.node`, `packageManager`, `pnpm-workspace.yaml`, the lockfile, or install docs.

### Audit status (2026-11-06)

| Scope | Result |
|-------|--------|
| `pnpm audit --prod --audit-level=high` | **1 high** residual: `zod@<4.6.6` via viem → abitype and WalletConnect (`zod@3.22.4`, `zod@3.25.76`). Aztec's `zod@4.4.3` is overridden to `4.6.7`. No patched Zod 3 release exists, and `abitype@1.0.6` does not accept Zod 4, so those paths stay on Zod 3. |
| `pnpm audit` (includes dev) | **Not clean.** Same Zod 3 high, plus dev-only highs in `vite@<=6.4.3`, `browserslist@<=4.28.6`, and `source-map-js@<1.2.2`. Those dev pins were not part of the Aztec 6 bump. |

**Cleared this pass (dev/build chain):**

- High [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) `nanoid` → override `3.3.18`
- Moderate [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) / CVE-2026-69153 `postcss` → override `8.5.23`

Re-check after dependency bumps: `pnpm audit --prod` and `pnpm audit`.

See also [docs/OPS.md](docs/OPS.md) for monitoring signals.
