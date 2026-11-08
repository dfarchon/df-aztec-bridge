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

### C-01 (closed for this kit)

Historical `account.json` / `account1.json` material in git history belonged to a prior developer leftover, **not** this kit’s production treasury or operator accounts. The rotation checklist below remains as historical guidance if those keys ever held assets. No history rewrite is required for this kit’s production-funds posture.

1. From a clean machine, inventory balances and permissions for any account whose secret appeared in old `account.json` / `account1.json` exports (including git history from the former CLI).
2. Move assets and revoke authorities to fresh accounts.
3. Inspect onchain / app activity since first exposure (commit `aebfbe8`, 21 July 2026).
4. Only after rotation, consider history rewriting with coordinated disclosure.

## Production posture (app controls — re-verified)

| Control | Status |
|---------|--------|
| Browser claim (Netlify) | `VITE_ENABLE_BROWSER_CLAIM=true`; remote claim API bases are rejected; CI `pnpm check:prod-env` asserts template posture, pinned fee/FPC, and CSP ≡ `csp.ts` |
| CSP | Explicit allowlist (`csp.ts` ≡ `netlify.toml`, tested); no bare `https:`/`wss:`; no `lb.drpc.live`; no `*.drpc.*` / `*.publicnode.com`. `style-src 'self' 'unsafe-inline'` (Vite/runtime styles; M-05 accepted). **WC/Reown wildcards remain (required)** — residual: post-XSS exfil to those registrable domains is accepted |
| RPC overrides | Localhost or an exact `PINNED_PUBLIC_RPC_URLS` entry (no path, query, or userinfo). Invalid vault blobs dropped on read. Integrity panel marks custom hosts bad |
| Vault | Meta AES-GCM at rest; PBKDF2-SHA-256 × 600,000 on create and on the next unlock of an older vault; idle 15m / tab-hidden 5m auto-lock clears in-memory claim and account secrets (paused while bridge/claim `runState === "running"`). A passkey with WebAuthn PRF wraps the CEK so the password alone cannot decrypt. A passkey without PRF stays password-only (UI nudge on Vault overview) |
| Device key | IDB device key obfuscates profile meta at rest; same-origin XSS can still invoke it. CEK still needs password (+ PRF when wrapped) |
| CryptoKey wipe | `lockVault` clears the CEK reference; Web Crypto / JS cannot zero key material — inherent residual |
| Plaintext leftovers | Boot deletes pre-vault `localStorage` account / claim blobs without reading them into the UI. Recovery is the downloaded claim JSON |
| Fee recipient | Pinned to `0x33D5928E1c66E831Eb250D1250bf2CfF9eACa370`. A different `VITE_BRIDGE_FEE_RECIPIENT` fails the build |
| Sponsored FPC | Pinned to `0x1441491b59934ec64f8c98f17c91f23c01ca2a45dbb35caf123146ec76f9970c`. A different `VITE_SPONSORED_FPC_ADDRESS` fails the build |
| ETH service fee | Live L1 fee × `BRIDGE_ETH_SERVICE_FEE_GAS` only; `VITE_BRIDGE_ETH_FEE_WEI` rejected at build; recipient remains the pinned treasury |
| HTTPS | Production builds hard-stop on non-loopback `http:` (HttpsRequiredPage) |
| Preview gate | Netlify edge function on `/*` for branch and deploy-preview hosts. Password is `DEV_GATE_PASSWORD` (HttpOnly HMAC cookie, 12+ characters). HTML messages escaped; failed POSTs rate-limited (5 / 60s per client IP, soft). Missing password fails closed with 503 before the bundle. **Production host is not gated** (by design). Netlify visitor password remains an optional extra CDN lock |
| Wallet sessions | EIP-6963 / WalletConnect only; anonymous `window.ethereum` rejected for bridge via `isTrustedConnector` |
| Maintenance | `VITE_MAINTENANCE_MODE` remains an ops kill-switch; default Netlify build must not bake `true` (`check:prod-env`) |
| Wallet backup | Plaintext L2 secrets by design for recovery; UI requires confirm before download |

### Accepted residuals (browser-class / dependency)

- **H-02**: WalletConnect / Reown `connect-src` wildcards are required for WC; any XSS can still talk to those domains within policy.
- **H-03**: L2 secrets exist in React / PXE memory while the vault is unlocked; same-origin XSS + unlocked vault remains Critical residual.
- **L-04**: Dev Vite HMR keeps `script-src 'unsafe-inline'` (not production Netlify headers).
- **L-06**: Dev-only audit remainder: `elliptic` (no patched release) under `vite-plugin-node-polyfills` — re-run `pnpm audit` after polyfill / `@aztec-labs/*` bumps.
- **L-10**: CryptoKey material cannot be zeroed after `lockVault`.
- **L-12**: Public production host serves the full bundle without DevGate.

This kit must not be used with production funds until Critical and High findings from the security review are remediated or explicitly risk-accepted, C-01 is closed for kit accounts, and controls are independently re-tested. After the remediations in this document: High code items are remediated or accepted as residuals above; independent re-test remains required before a “safe for funds” call.

## Dependency / pnpm posture

- Always `pnpm install --frozen-lockfile` (CI, Netlify, local).
- Pin Node in root `package.json#engines.node` (exact `x.y.z`); pin pnpm via Corepack `packageManager` **sha512**. Direct deps are exact versions in each `package.json`; bytes are pinned in `pnpm-lock.yaml`.
- Lifecycle scripts only via `allowBuilds` in `pnpm-workspace.yaml`; see [docs/PNPM_HARDENING.md](docs/PNPM_HARDENING.md).
- Audit overrides in `pnpm-workspace.yaml#overrides` force patched transitive versions (`hono`, `@hono/node-server`, `undici`, `ws`, `axios`, `zod@<4.6.6` → `4.6.7`, `qs@6.16.1`, `fast-copy@4.3.1`, `glob@14.0.4`, `pbkdf2@3.1.7`, … plus Vite toolchain `postcss@8.5.23`, `nanoid@3.3.18`, `browserslist@4.29.5`, `source-map-js@1.2.2`). Direct `vite` is `6.4.5`; direct `vitest` is `4.1.12`.
- CI / local gate: `pnpm audit --prod --audit-level=high` (the job must fail on high; do not set `continue-on-error`). Root script: `pnpm audit` → `--prod`.
- Run `pnpm check:pnpm` after changing `engines.node`, `packageManager`, `pnpm-workspace.yaml`, the lockfile, or install docs.
- Run `pnpm check:prod-env` after changing Netlify / `.env.example` production posture keys.

### Audit status (2026-11-08)

| Scope | Result |
|-------|--------|
| `pnpm audit --prod --audit-level=high` | **No known vulnerabilities.** |
| `pnpm audit` (includes dev) | **No high / moderate.** Dev-only remainder: 1 low (`elliptic` via `vite-plugin-node-polyfills` → `crypto-browserify`; no patched release). |

**Cleared this pass (dev tree):**

- Moderate `vitest` / `@vitest/mocker` ([GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9), [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)) → direct `vitest@4.1.12`
- Moderate `pbkdf2` ([GHSA-477h-4r7f-fvrx](https://github.com/advisories/GHSA-477h-4r7f-fvrx)) → override `3.1.7`

Earlier: `qs@6.16.1`, `fast-copy@4.3.1`, `glob@14.0.4`, `nanoid@3.3.18`, `postcss@8.5.23`, `zod@4.6.7`, `vite@6.4.5`.

Re-check after dependency bumps: `pnpm audit --prod` and `pnpm audit`.

See also [docs/OPS.md](docs/OPS.md) for monitoring signals.
