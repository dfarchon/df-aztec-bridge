# 03 — Privacy and trust

## What “privacy” means here

Aztec’s strength is **private L2 execution** once you have an account and Fee Juice.  
This bridge kit still uses **public Ethereum** for the deposit. So:

```text
PUBLIC (anyone can see)              PROTECTED (you must keep)
───────────────────────              ─────────────────────────
L1 deposit tx                        Claim secret (claim-*.json)
Amount / fee skim on L1              Aztec secretKey / salt / signingKey
Recipient Aztec address (on L1)      Vault password
Which RPC IP you used                Passkey / device unlock
That you visited the website         Unlocked browser session memory
```

**Hardening** reduces leaks and malware surface. It does **not** hide the L1 bridge from the world.

## Trust model (who can hurt you)

```text
                        ┌──────────────────┐
                        │   Your browser   │
                        │  (while unlocked)│
                        └────────┬─────────┘
                                 │ XSS / malware / shoulder surf
                                 ▼
              Can read CEK, secrets, claim JSON in memory
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
  Netlify host              RPC provider              Wallet extension
  (serves JS)               (sees IP + public         (signs L1 txs;
  must stay clean            RPC traffic)              you approve)
```

| Actor | What they can do | What they should not get |
|-------|------------------|---------------------------|
| You | Unlock vault, sign L1, claim | — |
| Website host (Netlify) | Change JS if compromised | Your password (unless you type into a fake page) |
| Aztec / L1 RPC | See your IP and public calls | Claim secret / account secret (unless you paste into wrong place) |
| Wallet | Sign what you approve | L2 secrets (unless you paste them) |
| Random website | Nothing if CSP holds | — |

## Client privacy habits (already in the kit)

From [NETWORK_INTEGRITY.md](../NETWORK_INTEGRITY.md) and `privacy.ts`:

- No third-party analytics / Google Fonts CDN in production posture.
- `privacyFetch`: no cookies, no-referrer, fixed `Accept-Language: en`, strip client-IP headers.
- Logs / toasts: full 32-byte hex is **not** dumped to console; toasts show **short** ids + explorer links.
## CROPS-style snapshot (honest)

| Pillar | This kit |
|--------|----------|
| **C**ensorship resistance | You can self-host the static app + point at your own RPC (allowlisted). Netlify can still take the hosted URL down. |
| **O**pen / Free | Source is in the repo; verify what you run. |
| **P**rivacy | Vault encrypts secrets at rest. L1 bridge is public. Unlocked tab is trusted. |
| **S**ecurity | CSP, vault idle lock, frozen pnpm — see [05 — Hardening](./05-HARDENING.md). |

## What not to expect

- “Private bridge” in the sense of hiding that you deposited Fee Juice on L1.
- Safety if you unlock the vault on a shared / infected PC.
- DevGate alone protecting a public Netlify URL (it is only a soft gate; use Netlify visitor password).

Next: [04 — Vault and keys](./04-VAULT-AND-KEYS.md).
