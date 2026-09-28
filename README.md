# df-aztec-bridge-kit

Fee Juice **L1 → L2** bridge monorepo: shared core, headless CLI/API, and a web UI that bridges via **MetaMask / EIP-1193** wallets.

**Learn the product in plain language:** [docs/education/](docs/education/README.md) — privacy, vault, hardening, bridge flow, recovery (with ASCII schemas).

## Workspace layout

```text
apps/
  cli/              # `df-bridge` CLI (L1 private key)
  api/              # HTTP API (async bridge / claim jobs)
  web/              # React UI — wallet-connected L1 bridge
packages/
  core/             # Pipeline, claim, config, GoBridge (Node)
  browser-sdk/      # Wallet + L1 GoBridge for browsers
config/networks/    # Network presets (shared)
```

## Quick start

```bash
nvm install && nvm use          # .nvmrc → Node 24.12.0
corepack enable
corepack prepare "$(node -p "require('./package.json').packageManager")" --activate
pnpm install --frozen-lockfile
cp .env.example .env   # if present
pnpm check:toolchain   # nvm + pnpm sha512 pins
pnpm check:pnpm        # supply-chain / frozen-lockfile posture
```

See [docs/PNPM_HARDENING.md](docs/PNPM_HARDENING.md) and [tooling/TOOLCHAIN.pins](tooling/TOOLCHAIN.pins) for Node/pnpm SHA512 digests.

### CLI (unchanged behaviour)

```bash
# Create Aztec L2 account only (for testing / front-end recipient)
pnpm cli --network testnet create-account -o account.json

# Fixed salt (default is 0 if omitted)
pnpm cli --network testnet create-account --salt 0x01 -o account.json

# Random salt — must save the printed salt to reopen / claim later
pnpm cli --network testnet create-account --random-salt -o account.json

# Full pipeline: L1 bridge → wait → L2 claim
pnpm cli --network testnet run --amount 1000 --create-account

# Bridge to an existing Aztec address (use secret from create-account)
pnpm cli --network testnet run --amount 1000 \
  --recipient 0x... \
  --l2-secret 0x...

# L1 only, then claim later
pnpm cli --network testnet l1-bridge --amount 1000 --recipient 0x... -o claim.json
pnpm cli --network testnet claim -c claim.json --l2-secret 0x...
```

### API + Web (wallet bridge)

Terminal 1 — API (loads `.env` from repo root when started from `apps/api`; run from root via script):

```bash
pnpm api
```

Terminal 2 — Web (proxies `/api` → `http://127.0.0.1:8787`):

```bash
pnpm web
```

Open the Vite URL (default `http://localhost:5173`):

1. Connect MetaMask (or any EIP-1193 wallet).
2. Enter the **Aztec L2 address** to fund.
3. Sign the L1 bridge transaction in the wallet.
4. Auto-claim runs in the browser (default). It needs the **L2 secret** for that Aztec account, kept in the vault — not sent to a public API.

The web app never asks for an L1 private key.

### WalletConnect QR (mobile)

1. Create a project at [cloud.reown.com](https://cloud.reown.com) and copy the **Project ID**.
2. Add to repo-root `.env`:

```env
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
```

3. Restart `pnpm web` (Vite only reads `VITE_*` at startup).
4. Click **Connect wallet** → **Scan QR with mobile wallet**.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Build libs + all apps |
| `pnpm typecheck` | Build libs, then typecheck all packages |
| `pnpm cli …` | Run CLI (`apps/cli`) |
| `pnpm api` | Start API dev server |
| `pnpm web` | Start Vite dev server |
| `pnpm deploy-l1-bridge sepolia` | Deploy GoBridge (CREATE2) on Sepolia |
| `DEPLOYER_KEY=0x… pnpm deploy-l1-bridge mainnet` | Deploy GoBridge on Ethereum mainnet (required before mainnet web/CLI bridge) |

## Environment

Place `.env` at the **repository root**. Used by CLI, API, and core config resolution.

Prefer **per-network** vars so the web UI can switch `testnet` / `mainnet` without one RPC overwriting the other:

| Variable | Used by |
|----------|---------|
| `NETWORK` | Default CLI/API preset when `-n` omitted |
| `TESTNET_L1_RPC_URL`, `MAINNET_L1_RPC_URL`, `LOCAL_L1_RPC_URL` | L1 RPC for that network (API → frontend) |
| `TESTNET_AZTEC_NODE_URL`, `MAINNET_AZTEC_NODE_URL`, … | Aztec node for that network |
| `TESTNET_L1_CHAIN_ID`, `MAINNET_L1_CHAIN_ID`, … | L1 chain id overrides |
| `L1_RPC_URL`, `AZTEC_NODE_URL` | Only applied when loading the active `NETWORK` preset |
| `L1_PRIVATE_KEY` | CLI / API full pipeline (not browser wallet) |
| `API_HOST`, `API_PORT`, `DATA_DIR` | API |
| `VITE_WALLETCONNECT_PROJECT_ID` | Web WalletConnect |

JSON defaults live in `config/networks/*.json` (currently publicnode L1 RPCs). After changing `.env`, restart `pnpm api`.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/networks` | Network ids (requires `API_AUTH_TOKEN`) |
| GET | `/v1/networks/:id` | Network config + L1 contract addresses |
| POST | `/v1/bridge` | **Disabled (403)** — use CLI or browser wallet; never send L1 keys over HTTP |
| POST | `/v1/claim` | L2 wait + claim — **off by default**; requires `API_ENABLE_CLAIM=true`, loopback `API_HOST`, and auth. Prefer browser claim on Netlify |
| GET | `/v1/jobs/:id` | Job status (no L2 secrets in public job JSON) |

## Packages

- **`@df-bridge/core`** — `runBridgePipeline`, `bridgeL1Only`, claim helpers, network config.
- **`@df-bridge/browser-sdk`** — `connectEvmWallet`, `bridgeFromConnectedWallet` for dApps.
- **`@df-bridge/cli`** — Commander entrypoint.
- **`@df-bridge/api`** — Hono server.
- **`@df-bridge/web`** — Vite + React UI.

## Deploy notes

- **Git:** private monorepo [`Stx69/df-aztec-bridge`](https://github.com/Stx69/df-aztec-bridge) — default branch `main` (not public).
- **Static-only (Netlify):** networks + L1 addresses live in `apps/web/src/config/networks.ts`.
  Deploy with [`netlify.toml`](netlify.toml) (`pnpm install --frozen-lockfile`, HTTPS + CSP headers).
  **Same env for all builds:** `[build.environment]` in `netlify.toml` + template [`.env.netlify.example`](.env.netlify.example)
  (production / deploy-preview / branch-deploy). Web needs `VITE_*` keys only.
  In Netlify UI you may paste the same keys under **Environment variables** (All scopes) —
  UI values override `netlify.toml` if both are set.
  After env changes: **Clear cache and deploy**.
  Local `pnpm web`: copy `.env.example` → `.env`, restart Vite (Netlify UI env does not apply).
  Git ignores `.env`, `.env.*` (except the two `*.example` templates), `.netlify/`, `account*.json`, and `claim-*.json`. Do not force-add them. Netlify must not receive `L1_PRIVATE_KEY`, `API_AUTH_TOKEN`, or a keyed dRPC URL in any `VITE_*` variable — those values are baked into the public bundle.
  Private GitHub ≠ private site URL: enable Netlify **visitor password / access control** if the live app must stay closed.
  Browser claim is enabled by default, so auto-claim does not need an API.
- Auto-claim **API** (`VITE_ENABLE_BROWSER_CLAIM=false`): local loopback only — needs `API_AUTH_TOKEN`, `API_ENABLE_CLAIM=true`, and `VITE_API_BASE=/api` (remote bases are rejected).
- Optional URL overrides: `VITE_TESTNET_AZTEC_NODE_URL`, `VITE_MAINNET_L1_RPC_URL`, etc.
- Browser claim needs COOP/COEP headers (Vite / Netlify set them when the flag is on).

