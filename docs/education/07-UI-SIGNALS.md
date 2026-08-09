# 07 — UI signals (progress, toasts, block estimate)

## Progress panel

During bridge / claim, a stepper shows **where you are** and whether it is safe to leave the tab.

```text
┌──────────────────────────────────────────────┐
│ Claiming Fee Juice on Aztec L2     elapsed   │
│ Step 4 of 7 · Waiting for L1→L2 message      │
├──────────────────────────────────────────────┤
│ Aztec tip  #12345                            │
│ Next tip   3s · on time          [====----]  │
├──────────────────────────────────────────────┤
│ ⚠ Do not refresh…  (while proving locally)   │
│   or ✓ Safe to leave (after L2 tx submitted) │
├──────────────────────────────────────────────┤
│ ✓ …                                          │
│ ● Waiting for message…                       │
│ 5 Generate proof…                            │
└──────────────────────────────────────────────┘
```

Tracks: `bridge`, `claim`, `resume-l1`, `wait-l2` (`progress-track.ts`).

## Aztec block estimate

On claim / wait-L2 tracks the panel polls the Aztec node tip and estimates the next tip.

| Color | Meaning |
|-------|---------|
| **Green** | On time — countdown still comfortable before predicted tip |
| **Yellow** | Due soon — last portion of the interval |
| **Red** | Behind estimate — tip later than predicted (common under load) |

This is an **estimate for UX**, not a consensus guarantee. Public nets start from ~6s block sub-slot heuristics; local uses the tick interval.

## Dapp log (toasts)

Bottom/side **dapp log** shows short-lived activity:

| Kind | Examples |
|------|----------|
| `tx` | L1 bridge submitted, L2 claim confirmed (+ explorer link) |
| `info` | Phase messages |
| `error` | Failures (CSP, fetch, wallet reject, …) |
| `announce` | Session unlocked |

### Tx toasts with explorers

```text
TX · 02:14:01 PM
L2 claim confirmed
┌────────────────────────────────────────┐
│ 0xabcdabcd…ef0123   Aztec Scan ↗       │  ← click opens explorer
└────────────────────────────────────────┘
```

- **L1** → Etherscan / Sepolia Etherscan (`l1ExplorerUrl`)
- **L2** → Aztec Scan / local explorer (`aztecExplorerUrl`)
- Hash shown **abbreviated** in the toast; full hash is not sprayed into console logs

Duplicate info toasts that only repeat the same hash as a linked `tx` entry are skipped.

## Network integrity panel

On `/bridge`, a periodic check compares client pin vs node version, contract addresses, and tip drift vs a secondary official RPC. See [NETWORK_INTEGRITY.md](../NETWORK_INTEGRITY.md).

## Takeaway

The UI is trying to answer three questions:

1. **Where am I** in a long claim?
2. **Can I close the tab** without losing proving work?
3. **Where is the tx** on a public explorer?

Back to the [education index](./README.md).
