# Security Policy

## Reporting

Report vulnerabilities privately to the maintainers. Do not open public issues that include private keys, claim secrets, or exploit PoCs against live funds.

## Secrets

Never commit:

- L1 / L2 private keys or secret keys
- `account.json` / `account*.json` exports and `claim-*.json`
- `.env` files (templates `.env.example` and `.env.netlify.example` are the only env files in git)
- Netlify CLI link state under `.netlify/` (site id)
- Keyed dRPC path URLs in source control. A `VITE_*` URL is baked into the browser bundle and visible to visitors; the public default is `https://aztec-mainnet.drpc.org`.

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
| CSP | Explicit allowlist (`csp.ts` ≡ `netlify.toml`); no bare `https:`/`wss:`; `lb.drpc.live/aztec-mainnet/` is allowed; no `*.drpc.*` / `*.publicnode.com`. WC/Reown wildcards remain (required) |
| RPC overrides | Localhost, an exact `PINNED_PUBLIC_RPC_URLS` entry, or a keyed `lb.drpc.live/aztec-mainnet/` URL. Query strings and userinfo are rejected |
| Vault | Meta AES-GCM at rest; PBKDF2-SHA-256 × 600,000 on create and on the next unlock of an older vault; idle 15m / tab-hidden 5m auto-lock also clears in-memory claim and account secrets. A passkey with WebAuthn PRF wraps the CEK so the password alone cannot decrypt. A passkey without PRF stays password-only |
| Plaintext leftovers | Boot deletes pre-vault `localStorage` account / claim blobs without reading them into the UI. Recovery is the downloaded claim JSON |
| Fee recipient | Pinned to `0x33D5928E1c66E831Eb250D1250bf2CfF9eACa370`. A different `VITE_BRIDGE_FEE_RECIPIENT` fails the build |
| Preview gate | Netlify edge function on `/*` for branch and deploy-preview hosts. Password is `DEV_GATE_PASSWORD` (HttpOnly HMAC cookie, 12+ characters). Missing password fails closed with 503 before the bundle. Production host is not gated. Netlify visitor password remains an optional extra CDN lock |

This kit must not be used with production funds until Critical and High findings from the security review are remediated, C-01 rotation is confirmed, and controls are independently re-tested.

## Dependency / pnpm posture

- Always `pnpm install --frozen-lockfile` (CI, Netlify, local).
- Pin Node in root `package.json#engines.node` (exact `x.y.z`); pin pnpm via Corepack `packageManager` **sha512**. Direct deps are exact versions in each `package.json`; bytes are pinned in `pnpm-lock.yaml`.
- Lifecycle scripts only via `allowBuilds` in `pnpm-workspace.yaml`; see [docs/PNPM_HARDENING.md](docs/PNPM_HARDENING.md).
- Audit overrides in `pnpm-workspace.yaml#overrides` force patched transitive versions (`hono`, `@hono/node-server`, `undici`, `ws`, `axios`, `zod@<4.6.6` → `4.6.7`, `qs@6.16.1`, `fast-copy@4.3.1`, `glob@14.0.4`, … plus Vite toolchain `postcss@8.5.23`, `nanoid@3.3.18`, `browserslist@4.29.5`, `source-map-js@1.2.2`). Direct `vite` is `6.4.5`.
- CI / local gate: `pnpm audit --prod --audit-level=high` (the job must fail on high; do not set `continue-on-error`). Root script: `pnpm audit` → `--prod`.
- Run `pnpm check:pnpm` after changing `engines.node`, `packageManager`, `pnpm-workspace.yaml`, the lockfile, or install docs.

### Audit status (2026-11-06)

| Scope | Result |
|-------|--------|
| `pnpm audit --prod --audit-level=high` | **No high.** `zod@<4.6.6` is overridden to `4.6.7`. `qs@6.16.1`, `fast-copy@4.3.1`, and `glob@14.0.4` clear the previous production moderates. |
| `pnpm audit` (includes dev) | **No high.** Production tree is clean. Dev-only remainder: 4 moderate (`vitest` / `@vitest/mocker`, `pbkdf2` under `vite-plugin-node-polyfills`) and 1 low (`elliptic`, no patched release). |

**Cleared this pass (production tree):**

- Moderate `qs` ([GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g), [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw)) → override `6.16.1`
- Moderate `fast-copy` ([GHSA-jggr-w7fw-pc2j](https://github.com/advisories/GHSA-jggr-w7fw-pc2j)) → override `4.3.1`
- Moderate `glob` / nested `minimatch` ([GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)) → override `glob@14.0.4`

Earlier this review: `nanoid@3.3.18`, `postcss@8.5.23`, `zod@4.6.7`, `vite@6.4.5`.

Re-check after dependency bumps: `pnpm audit --prod` and `pnpm audit`.

See also [docs/OPS.md](docs/OPS.md) for monitoring signals.
