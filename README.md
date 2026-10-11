# DF Archon — Aztec Fee Juice bridge

A browser dapp that moves **Fee Juice** from Ethereum to an Aztec account so private L2 activity can pay for itself.

You connect a wallet, unlock a local vault, sign the L1 deposit, and claim on Aztec **in the same tab**. The page never asks for an Ethereum private key. Proving stays on your machine.

**Live app:** [https://aztec-dfarchon-kit.netlify.app/](https://aztec-dfarchon-kit.netlify.app/)

Longer walkthroughs: [docs/education/](docs/education/README.md).

## How to use it

1. Open the site and connect MetaMask or a WalletConnect wallet.
2. Unlock the vault (or import an Aztec account). The vault encrypts keys in the browser.
3. On **Bridge**, enter the amount and the Aztec address that should receive Fee Juice. Confirm the Ethereum transaction in your wallet.
4. Wait until Aztec sees the L1 message, then let the in-browser claim finish. Keep the tab open while a proof is running.
5. If you leave early, open **Recover** and use the saved `claim-*.json`. That file plus the Aztec account secret are what finish the claim.

Two secrets are easy to mix up:

- **Claim secret** — unlocks this one deposit. Anyone with it can claim that note.
- **Aztec account secret** — controls the L2 address. Anyone with it owns the account.

## Look and sound

The UI is the DF Archon theme, not a generic wallet chrome.

- Void black background, pale ink, and a magenta accent (`#ff4dac`) for lines, progress, and success.
- A light theme is one toggle away. The choice is stored in the browser.
- Pixel cursors for hover, click, text, resize, and wait.
- Optional background music and short UI sounds.
- Decode and ASCII flourishes on headings and empty fields.

Fonts stay on the system stack (no remote font CDN).

## What is in this repo

```text
apps/web              React UI
packages/browser-sdk Wallet connect, L1 bridge, in-browser claim
```

Network addresses the page uses live in `apps/web/src/config/networks.ts`. GoBridge bytecode the browser signs against is vendored in `packages/browser-sdk`.

## Run it locally

Node is the exact version in `package.json#engines.node` (`24.19.0`). pnpm is the Corepack pin in `package.json#packageManager`. Dependencies are exact versions in each `package.json`, resolved by `pnpm-lock.yaml`.

```bash
nvm install 24.19.0 && nvm use 24.19.0
corepack enable
corepack prepare "$(node -p "require('./package.json').packageManager")" --activate
pnpm install --frozen-lockfile
cp .env.example .env
pnpm web
```

`packages/browser-sdk/dist` is not in git. The first `pnpm web` or `pnpm dev` compiles that package so Vite can load `@df-bridge/browser-sdk/claim-lazy`. If the dev server was already started without that build, stop it, run `pnpm build:libs`, then start it again.

Vite prints a local URL (default `http://localhost:5173`). Restart it after changing any `VITE_*` value.

WalletConnect QR needs a Reown project id in `.env`:

```env
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
```

Create the project at [cloud.reown.com](https://cloud.reown.com).

## Netlify

[`netlify.toml`](netlify.toml) installs with a frozen lockfile, builds `@df-bridge/browser-sdk`, then builds the web app, and publishes `apps/web/dist`.

Shared build env (including the public site URL and browser claim) is in that file. Optional UI overrides belong in the Netlify dashboard as `VITE_*` keys. After changing them: **Clear cache and deploy**.

Do not put private keys or keyed RPC URLs in `VITE_*`. Those values are compiled into the public bundle.

## Scripts

| Command | What it does |
|---------|----------------|
| `pnpm web` / `pnpm dev` | Dev server (builds the SDK first if `dist` is missing) |
| `pnpm build` | Production build of the SDK and the web app |
| `pnpm typecheck` | Typecheck both packages |
| `pnpm check:pnpm` | Lockfile, exact specifiers, and install hardening |
| `pnpm audit` | Production dependency audit |
