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
VITE_MAINNET_AZTEC_NODE_URL=https://lb.drpc.live/aztec-mainnet/<API_KEY>
```

A keyed `https://lb.drpc.live/aztec-mainnet/...` value in `VITE_MAINNET_AZTEC_NODE_URL` is accepted. Vite bakes that URL into the client, so the path key is visible to anyone who loads the page.

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
DevGate (client hash check)
   = speed bump on /dev hosts
   ≠ security boundary

Netlify visitor password
   = real gate for closed previews
```

## 4) pnpm / supply chain

Always:

```bash
pnpm install --frozen-lockfile
```

Never bare `pnpm i` / `npm install` in this repo. Details: [PNPM_HARDENING.md](../PNPM_HARDENING.md).

## 5) RPC overrides

Users may override node URLs only if they are **localhost** or on the **official HTTPS allowlist**. Random HTTPS hosts are rejected (stops “helpful” malicious RPC phishing).

## 6) Production funds gate

[SECURITY.md](../../SECURITY.md) still says: do **not** use production funds until Critical/High findings + **C-01** key rotation are confirmed. Hardening helps; process gates still apply.

Next: [06 — Recovery](./06-RECOVERY.md).
