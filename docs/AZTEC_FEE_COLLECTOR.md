# Aztec fee collector + bridge URL

## Two different addresses (do not mix)

| Role | Chain | Env / constant | Purpose |
|------|-------|----------------|---------|
| **L1 protocol fee (5%)** | Ethereum | `BRIDGE_FEE_RECIPIENT` / `VITE_BRIDGE_FEE_RECIPIENT` | Anonymous Trezor treasury — skim on every bridge |
| **DF Sponsored FPC** | Aztec L2 | `VITE_SPONSORED_FPC_ADDRESS` (default canonical) | Fee Juice *recipient* when funding DF sponsor mode |

Canonical Sponsored FPC (salt-derived, matches DF Aztec / `@aztec/constants`):

`0x1441491b59934ec64f8c98f17c91f23c01ca2a45dbb35caf123146ec76f9970c`

In the web UI use **Fund DF Sponsored FPC** to set the L2 recipient to that address. That deposits Fee Juice *onto the FPC* so DF can sponsor txs — it does **not** replace the L1 5% Trezor fee.

## L1 fee (shipped)

Every bridge skims **5%** (`BRIDGE_FEE_BPS = 500`) of the gross Fee Juice / AZTEC amount:

- **Net (95%)** → Aztec Fee Juice portal deposit for the L2 recipient (user account **or** Sponsored FPC)
- **Fee (5%)** → `BRIDGE_FEE_RECIPIENT` / `VITE_BRIDGE_FEE_RECIPIENT` (your anonymous Trezor on Ethereum)

Portal path: ERC-20 `transfer` of the fee, then `depositToAztecPublic(net)`.  
GoBridge path: fee is enforced inside the contract (`feeRecipient` immutable).

Set both L1 env vars to the **same** checksummed address before Netlify build / `pnpm deploy-l1-bridge`.

## Aztec-side collector (next)

An Aztec.nr contract can later:

1. Record fee acknowledgements / bridge session ids privately
2. Expose a public note linking to the bridge DApp URL (`VITE_BRIDGE_PUBLIC_URL`)
3. Match L1 fee txs observed via an oracle / portal message

Until that contract ships, the web UI links:

- Bridge atlas style: [df-atlas.onchainreality.xyz](https://df-atlas.onchainreality.xyz/)
- Game entry: [aztec.dfpunk.xyz/play](https://aztec.dfpunk.xyz/play/0x1682cd593daddec05d1cb5440bd67af7d1fb7bfb27711ee94ad08c6fc277ece1)
- Tx / block analysis: [aztecscan.xyz](https://aztecscan.xyz/) (see [NETWORK_INTEGRITY.md](./NETWORK_INTEGRITY.md))
- Sponsored FPC on Scan: `/address/0x1441…9970c`

Do **not** put the Trezor private key anywhere in the repo — only the public address.
