# 02 — Bridge flow (L1 → L2 Fee Juice)

## Goal

Put **Fee Juice** on your Aztec address so you can pay for L2 work (including private apps later).

## Big picture schema

```text
 Ethereum L1                         Aztec L2
 ───────────                         ────────
 Your wallet                         Your Aztec account
      │                                     ▲
      │ 1. Pay fee skim (5% of AZTEC)       │
      │ 2. Approve Fee Juice                │
      │ 3. depositToAztecPublic(            │
      │      recipient,                     │
      │      netAmount,                     │
      │      secretHash )                   │
      ▼                                     │
 FeeJuicePortal ── L1→L2 message ───────────┤
      │                                     │
      │ emits event with secretHash         │
      │                                     │
      ▼                                     │
 claim-*.json  (claimSecret + hashes)       │
      │                                     │
      └──── 4. Browser PXE proves claim ────┘
            (needs claimSecret + account keys)
```

## Step by step (plain text)

1. **You choose** an Aztec **recipient** address (usually your DF Punk / vault account).
2. **App creates** a random **claim secret** and computes **secretHash** (hash goes onchain; secret stays with you).
3. **Wallet signs** L1 txs: optional mint (testnets), fee skim, approve, deposit.
4. **Browser saves** claim credentials (encrypted vault when unlocked) and offers a **download** of `claim-*.json`.
5. **Aztec** needs time to ingest the L1→L2 message (often several minutes on public nets).
6. **Claim** runs in the tab (browser claim): register account in PXE → wait for message → prove → submit L2 tx.
7. **Done** when L2 confirms; Fee Juice balance rises on Aztec.

## Fee skim (not Aztec privacy)

On every bridge, a **5%** cut of the AZTEC amount goes to the configured fee recipient on **Ethereum**. That is public L1 economics, documented in [AZTEC_FEE_COLLECTOR.md](../AZTEC_FEE_COLLECTOR.md). Mainnet may also charge a small **ETH** service fee to the same address.

```text
Gross amount you type
        │
        ├── 5% ──► fee recipient (L1, public)
        └── 95% ─► your Aztec recipient (after claim)
```

## How you claim

The claim runs in the browser. Secrets stay in the tab and the vault. Proving uses the in-browser PXE. There is no remote claim server in this repo.

## Progress UI (what the stepper means)

While claiming, the UI shows steps roughly like:

```text
[1] Check L1→L2 message
[2] Start in-browser prover (PXE)
[3] Register Aztec account
[4] Wait for message on Aztec     ← often the long wait
[5] Generate proof + submit claim ← heavy on your CPU
[6] Wait for L2 confirmation
[7] Fee Juice claimed
```

Do **not** refresh during proving (steps that run only in the tab). After the L2 tx is submitted, Recover can finish waiting.

## Local vs public timing

| | Local | Testnet / mainnet |
|--|-------|-------------------|
| Bridge timing | Can “warp” / tick faster | Poll / wait real time |
| Proving | Often lighter / off for local | Full browser proving |
| Explorer | In-app `/explorer` | Aztec Scan links |

Next: [03 — Privacy and trust](./03-PRIVACY-AND-TRUST.md).
