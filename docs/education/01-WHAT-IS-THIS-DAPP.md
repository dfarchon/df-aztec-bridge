# 01 — What is this dapp?

**In one sentence:** this dapp moves **Fee Juice** from Ethereum (L1) to Aztec (L2) so your Aztec account can pay for private transactions.

## Who does what?

```text
┌──────────────────────────────────────────────────────────┐
│                        YOU                               │
│  • L1 wallet signs the Ethereum deposit                  │
│  • Aztec account keys unlock the L2 claim                │
└────────────────────────────┬─────────────────────────────┘
                             ▼
                    ┌─────────────────┐
                    │    apps/web     │
                    │  DF Archon UI   │
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐
                    │  browser-sdk    │
                    │ wallet + claim  │
                    └─────────────────┘
```

| Piece | Plain meaning |
|-------|----------------|
| `apps/web` | The website you open. Never asks for an **L1 private key**. |
| `packages/browser-sdk` | Browser wallet connect, L1 bridge, and in-browser L2 claim (PXE). |
| `apps/web/src/config/networks.ts` | Presets for local / testnet / mainnet URLs and contract addresses. |

## What you do in the web UI

Typical path:

1. Connect an Ethereum wallet.
2. Import or unlock an Aztec account (vault).
3. Bridge Fee Juice on L1 (wallet popup).
4. Wait for Aztec to see the L1→L2 message.
5. Claim on L2 (proving runs **in your browser** on Netlify builds).
6. If something interrupts you → **Recover** tab + `claim-*.json`.

Routes (this branch):

| Path | Job |
|------|-----|
| `/bridge` | Deposit Fee Juice |
| `/recover` | Finish an unfinished claim / import claim JSON |
| `/vault` | Password vault for keys + sessions |
| `/explorer` | Local tip viewer (`pnpm dev`) |

## Two secrets people confuse

```text
CLAIM SECRET          ≠          AZTEC ACCOUNT SECRET
─────────────                    ────────────────────
Unlocks THIS deposit             Controls the L2 address
Created at L1 bridge time        Created when you make/import account
Saved in claim-*.json            Saved in vault (encrypted) or DF Punk JSON
Anyone with it can claim         Anyone with it owns the account
  that one Fee Juice note
```

Losing either can lose funds or leave Fee Juice stuck. Treat both like passwords.

## Networks

| Network | Feeling |
|---------|---------|
| **local** | Your machine (`pnpm dev`). Fast, for learning. |
| **testnet** | Public Aztec testnet + Sepolia. Practice without mainnet money. |
| **mainnet** | Real Ethereum + Aztec Alpha. **Do not use production funds until SECURITY.md gates are clear.** |

## Honest limits

- This is a **bridge dapp**. You keep custody of keys.
- L1 deposits are **public** on Ethereum.
- Aztec privacy applies to **L2 private activity** after you have Fee Juice — the bridge deposit itself is still an L1 transaction.
- Hardening reduces attack surface; it does not make a compromised browser safe while the vault is unlocked.

Next: [02 — Bridge flow](./02-BRIDGE-FLOW.md).
