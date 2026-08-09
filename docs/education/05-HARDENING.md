# 05 — Hardening (dapp, API, deps, host)

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
│  Optional local API (loopback)                               │
│  Auth token · claim off by default · /v1/bridge always 403   │
└─────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  Supply chain                                                │
│  pnpm frozen lockfile · allowBuilds · audit · toolchain pins │
└─────────────────────────────────────────────────────────────┘
```

## 1) `VITE_*` is public

Anything starting with `VITE_` is compiled into the JavaScript everyone downloads.

```text
GOOD                          BAD
────                          ───
VITE_BRIDGE_PUBLIC_URL        VITE_MAINNET_AZTEC_NODE_URL=
VITE_ENABLE_BROWSER_CLAIM       https://lb.drpc.live/.../<API_KEY>
Public RPC:
  https://aztec-mainnet.drpc.org

Keyed RPC only in:            (Vite would bake the key into the client)
  MAINNET_AZTEC_NODE_URL
  (CLI / API / private env)
```

The build **refuses** keyed `lb.drpc.live/...` values in `VITE_MAINNET_AZTEC_NODE_URL` (`vite.config.ts`).

## 2) Content Security Policy (CSP)

The browser will only let the page talk to an **allowlist** of hosts (Aztec RPC, explorers, WalletConnect, CRS proving files, etc.).

```text
Page JS ──connect-src──► allowlisted HTTPS hosts
         ──✕──────────► random.com   (blocked)
```

Source of truth: `apps/web/src/lib/csp.ts` must match `netlify.toml` headers.  
No open `https:` / `wss:` wildcards (except required WalletConnect / Reown patterns).

CRS hosts (`crs.aztec-cdn.foundation`, `crs.aztec-labs.com`) are required for browser proving.

## 3) API posture

| Rule | Meaning |
|------|---------|
| `API_AUTH_TOKEN` ≥ 32 chars | Required for `/v1/*` |
| `POST /v1/bridge` | Always **403** |
| `POST /v1/claim` | Off unless `API_ENABLE_CLAIM=true` **and** loopback host |
| Bind `127.0.0.1` | Default; non-loopback needs an explicit danger flag |
| Vite `/api` proxy | Injects auth from **server** env — never put the token in `VITE_*` |

Remote claim API bases are rejected so you cannot accidentally bake a token into the client.

## 4) DevGate vs real access control

```text
DevGate (client hash check)
   = speed bump on /dev hosts
   ≠ security boundary

Netlify visitor password
   = real gate for closed previews
```

## 5) pnpm / supply chain

Always:

```bash
pnpm install --frozen-lockfile
```

Never bare `pnpm i` / `npm install` in this repo. Details: [PNPM_HARDENING.md](../PNPM_HARDENING.md).

## 6) RPC overrides

Users may override node URLs only if they are **localhost** or on the **official HTTPS allowlist**. Random HTTPS hosts are rejected (stops “helpful” malicious RPC phishing).

## 7) Production funds gate

[SECURITY.md](../../SECURITY.md) still says: do **not** use production funds until Critical/High findings + **C-01** key rotation are confirmed. Hardening helps; process gates still apply.

Next: [06 — Recovery](./06-RECOVERY.md).
