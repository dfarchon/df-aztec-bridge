# 04 — Vault and keys

## Why a vault?

Browsers used to keep sensitive JSON in **plain localStorage**. That is easy to dump from DevTools.  
This dapp stores sensitive docs in **IndexedDB**, encrypted with a key derived from **your password**.

## Schema (mental model)

```text
┌──────────────────────────────────────────────────────────────┐
│                    Your password (memory)                     │
└────────────────────────────┬─────────────────────────────────┘
                             │ PBKDF2-SHA-256 (600k iterations, new vaults)
                             ▼
                      ┌─────────────┐
                      │     CEK     │  Content Encryption Key
                      │ (in RAM only│  while vault is unlocked)
                      └──────┬──────┘
                             │ AES-GCM
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
   wallets doc         bridge:* docs         rpc overrides
   (Aztec keys)        (claim sessions)      (optional URLs)
                             │
                             ▼
                    IndexedDB “df-bridge-vault”
                    (ciphertext at rest)

Profile meta (salt, verifier, passkey id)
  └─ wrapped with a per-origin device key (also IndexedDB)
```

| Term | Plain meaning |
|------|----------------|
| **CEK** | The key that encrypts your saved wallets / bridge sessions. Exists only in memory while unlocked. |
| **Verifier** | Check that the password is correct without storing the password. |
| **Passkey** | Optional WebAuthn check. When the authenticator supports the PRF extension, a random CEK is wrapped by the password and that passkey output together. The password alone cannot decrypt that vault. Older passkeys that cannot return a PRF stay password-only and are upgraded to 600k iterations on the next unlock. |
| **Idle lock** | After **15 min** idle or **5 min** with the tab hidden → CEK wiped, and in-memory claim / account secrets cleared. |

## What is stored when unlocked

- Aztec account material (`secretKey`, salt, signingKey, address)
- Unfinished bridge / claim sessions (including claim credentials)
- Optional custom RPC URLs (must pass allowlist)

## What is never the vault’s job

- Holding your **Ethereum** private key (that stays in MetaMask / your wallet).
- Making L1 private while you bridge (L1 is public).

## Unlock flow

```text
Open app
   │
   ├─ No profile yet ──► Import DF Punk / account JSON
   │                        │
   │                        └─► Setup password (+ optional passkey)
   │
   └─ Profile exists ──► Enter password
                            │
                            ├─ Passkey wraps the key? ──► OS biometric / phone (PRF)
                            │
                            └─ CEK in memory ──► menus / bridge / recover work
```

## Safety tips (plain)

1. Use a **strong** password. New vaults require at least 12 characters. Existing shorter passwords still unlock.
2. Download **claim-*.json** after L1 deposit and keep a copy offline.
3. Lock the vault when you walk away (or let idle lock do it).
4. Same-origin XSS while unlocked ≈ attacker can use your CEK. Keep the site + CSP healthy.

Code pointers: `apps/web/src/lib/vault.ts`, `vault-crypto.ts`, `vault-idb.ts`, `vault-idle-lock.ts`, `vault-passkey.ts`.

Next: [05 — Hardening](./05-HARDENING.md).
