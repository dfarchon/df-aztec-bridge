# 06 — Recovery (claim JSON and unfinished sessions)

## Why recovery exists

Claiming Fee Juice can take minutes. Tabs close. Laptops sleep. Networks flake.  
Recovery lets you **finish a claim** without repeating the L1 deposit.

## Two artifacts

```text
┌─────────────────────┐         ┌──────────────────────────┐
│   claim-*.json      │         │   Vault bridge session   │
│   (download / CLI)  │         │   (this browser, locked) │
├─────────────────────┤         ├──────────────────────────┤
│ l1TxHash            │         │ same fields, encrypted   │
│ recipient           │         │ under your password      │
│ credentials:        │         │                          │
│   claimSecret       │         │                          │
│   claimSecretHash   │         │                          │
│   messageHash       │         │                          │
│   messageLeafIndex  │         │                          │
│   claimAmount       │         │                          │
│ networkId?          │         │                          │
└─────────────────────┘         └──────────────────────────┘
```

The **claim secret cannot be guessed** from the Aztec address. Without the JSON (or the vault session), that deposit may be unclaimable.

## Session phases (schema)

```text
l1-pending ──► ready-to-claim ──► claiming ──► claim-sent ──► (removed when done)
     │                │               │             │
     │                │               │             └─ wait for L2 confirm
     │                │               └─ proving / submit
     │                └─ have credentials; need account keys
     └─ waiting for L1 receipt / rebuild credentials
```

Failed claims can sit in `failed` with a stored error until you retry or discard.

## Recover tab — what to do

```text
Open /recover
     │
     ├─ Sessions listed from this browser’s vault
     │       │
     │       └─ Select one → follow “What to do next”
     │
     └─ No session? Import claim-*.json
             │
             ├─ Unlock vault (required to save)
             ├─ Session appears as ready-to-claim
             └─ Import matching Aztec account JSON / keys
                     │
                     └─ Resume L2 claim
```

### Account vs claim file

| File | Contains | Used for |
|------|----------|----------|
| `claim-*.json` | Claim secret + L1 tx identity | Prove you own **this deposit** |
| `dfpunk-account-*.json` | `secretKey` / salt / signingKey | Prove you own the **recipient account** |

You often need **both** on a new device.

## Safety

- Prefer downloading claim JSON **immediately** after L1 success.
- Store offline copies; do not paste claim secrets into chat apps.
- Vault must be unlocked to import / persist sessions.
- Explorer links in the UI / toasts help you verify the L1 or L2 tx, not recover the secret.

Code: `claim-credentials-import.ts`, `bridge-session.ts`, `claim-recovery.ts`, Recover UI in `BridgeWorkspace.tsx`.

Next: [07 — UI signals](./07-UI-SIGNALS.md).
