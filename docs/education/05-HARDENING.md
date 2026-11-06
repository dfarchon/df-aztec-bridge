# 05 — Hardening (dapp, deps, host)

“Hardening” means: make the **default path** hard to abuse, and make mistakes **fail closed**.

## Layers schema

```text
┌─────────────────────────────────────────────────────────────┐
│  Browser tab                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Vault CEK   │  │ CSP allow   │  │ Toast redaction +   │ │
│  │ idle lock   │  │ list        │  │ explorer links      │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└───────────────────────────┬─────────────────────────────────┘
                            │ only to allowlisted hosts
┌───────────────────────────▼─────────────────────────────────┐
│  Netlify / Vite host                                         │
│  HTTPS · COOP/COEP · CSP headers · frozen pnpm build         │
│  VITE_* baked into JS (treat as PUBLIC)                      │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  Supply chain                                                │
│  pnpm frozen lockfile · allowBuilds · audit · toolchain pins │
└─────────────────────────────────────────────────────────────┘
```

## 1) `VITE_*` is public

Anything starting with `VITE_` is compiled into the JavaScript everyone downloads.

```text
VITE_BRIDGE_PUBLIC_URL
VITE_ENABLE_BROWSER_CLAIM
VITE_MAINNET_AZTEC_NODE_URL=https://aztec-mainnet.drpc.org
```

A keyed node URL is rejected for every `VITE_*` RPC variable. `MAINNET_AZTEC_NODE_URL` is injected into local `pnpm dev` only when it is a pinned public or loopback URL, so a path key never reaches the browser.

## 2) Content Security Policy (CSP)

The browser will only let the page talk to an **allowlist** of hosts (Aztec RPC, explorers, WalletConnect, CRS proving files, etc.).

```text
Page JS ──connect-src──► allowlisted HTTPS hosts
         ──✕──────────► random.com   (blocked)
```

Source of truth: `apps/web/src/lib/csp.ts` must match `netlify.toml` headers.  
No open `https:` / `wss:` wildcards (except required WalletConnect / Reown patterns).

CRS hosts (`crs.aztec-cdn.foundation`, `crs.aztec-labs.com`) are required for browser proving.

## 3) DevGate vs real access control

```text
Netlify edge function (netlify/edge-functions/preview-gate.js)
   = lock for branch deploys and deploy previews
   = password is DEV_GATE_PASSWORD in the Netlify UI (not a VITE_ variable)
   = missing or short password fails closed (503) before the app bundle
   = production host and localhost are not gated

Netlify visitor password
   = optional extra CDN lock the repo cannot turn on
```

## 4) pnpm / supply chain

Always:

```bash
pnpm install --frozen-lockfile
```

Never bare `pnpm i` / `npm install` in this repo. Details: [PNPM_HARDENING.md](../PNPM_HARDENING.md).

## 5) RPC overrides

Users may override node URLs only with **localhost** or an **exact public RPC** (no path, query, or `lb.drpc.live`). A path on that host can select someone else's node.

## 6) Production funds gate

[SECURITY.md](../../SECURITY.md) still says: do **not** use production funds until Critical/High findings + **C-01** key rotation are confirmed. Hardening helps; process gates still apply.

Next: [06 — Recovery](./06-RECOVERY.md).
