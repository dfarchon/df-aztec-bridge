# Education guides (plain language)

These pages explain **how this dapp works**, what is **private vs public**, and how **hardening** protects you — without assuming you already know Aztec jargon.

Start here if you are new. Use [SECURITY.md](../../SECURITY.md) when you need the production control checklist.

| Guide | What you learn |
|-------|----------------|
| [01 — What is this dapp?](./01-WHAT-IS-THIS-DAPP.md) | Monorepo map, who signs what, routes |
| [02 — Bridge flow (L1 → L2)](./02-BRIDGE-FLOW.md) | Fee Juice deposit, claim secret, browser claim |
| [03 — Privacy and trust](./03-PRIVACY-AND-TRUST.md) | What stays secret, what the chain sees |
| [04 — Vault and keys](./04-VAULT-AND-KEYS.md) | Password vault, CEK, idle lock, passkey |
| [05 — Hardening](./05-HARDENING.md) | CSP, `VITE_*`, API, pnpm, Netlify, DevGate |
| [06 — Recovery](./06-RECOVERY.md) | Claim JSON, Recover tab, sessions |
| [07 — UI signals](./07-UI-SIGNALS.md) | Progress panel, dapp log, block estimate |

## Related ops / reference docs

- [SECURITY.md](../../SECURITY.md) — secrets policy, production posture, C-01
- [PNPM_HARDENING.md](../PNPM_HARDENING.md) — install / supply-chain pins
- [NETWORK_INTEGRITY.md](../NETWORK_INTEGRITY.md) — explorers, tip checks, privacyFetch
- [AZTEC_FEE_COLLECTOR.md](../AZTEC_FEE_COLLECTOR.md) — L1 fee skim vs Sponsored FPC
- [OPS.md](../OPS.md) — what to watch in production
- [README.md](../../README.md) — quick start commands

## Branch note

This education set matches the **bridge + vault + hardening** product on the current branch. A separate **private chat** line of work may live on another branch; it is **not** documented here as shipped UI.
