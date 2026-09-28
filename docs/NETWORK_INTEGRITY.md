# Network integrity, privacy, explorers

## Aztec Scan (official explorer UX)

Public UI (no private API key from the DApp):

- Mainnet: [https://aztecscan.xyz/](https://aztecscan.xyz/)
- Testnet: [https://testnet.aztecscan.xyz](https://testnet.aztecscan.xyz)

**Local network (`pnpm dev`):** the Vite app serves an AztecScan-shaped explorer at `http://localhost:5173/explorer` (and `/blocks/{n}`, `/tx-effects/{0x…}`, `/address/{addr}`) against `http://localhost:8080`. Tip and route data refresh on the same cadence as mprocs `tick` / `local-network-tick` (`LOCAL_TICK_INTERVAL_MS` → `VITE_LOCAL_TICK_INTERVAL_MS`). Viewing the tip block follows the head as it advances. This is a lightweight JSON-RPC tip viewer — not the full [Chicmoz](https://github.com/aztec-scan/chicmoz) indexer stack.

Deep links used by the web app:

| Kind | Path |
|------|------|
| Block | `/blocks/{n}` |
| Tx effect | `/tx-effects/{0x…}` |
| L2 address | `/address/{addr}` |

Do **not** call `api.aztecscan.xyz` from the client (requires an API key). Tip / version checks use the configured Aztec node JSON-RPC (`node_getBlockNumber`, `node_getNodeInfo`) plus an official secondary tip RPC.

## Client double-check

`NetworkIntegrityPanel` (on `/bridge`) verifies on load and every 60s:

1. Client pin `5.2.0` vs node `nodeVersion`
2. Fee Juice + portal addresses vs baked official addresses
3. Primary tip vs secondary official RPC (warn if Δ > 32)
4. Links to Aztec Scan current block + [docs.aztec.network/networks](https://docs.aztec.network/networks)

Network / L1 backend selectors live in the **wallet manager** drawer (locked to mainnet + portal). RPC overrides remain in the gear settings modal.

## Privacy / localization

- No Google Fonts / third-party analytics (avoids IP + locale leakage to CDNs)
- `privacyFetch`: omit credentials, `no-referrer`, force `Accept-Language: en`, strip client-IP headers
- UI timestamps use ISO-8601 (not `toLocaleString`)
- API rate-limit keys are **SHA-256 truncated hashes** of the TCP peer address by default. `X-Forwarded-For` / `X-Real-IP` are used only when `API_TRUST_PROXY=true` (trusted reverse proxy). Raw IPs are never logged.
- Logs redact hex secrets and IP literals

## Official allowlist

See `apps/web/src/lib/official-links.ts` (`OFFICIAL_HTTPS_HOST_ALLOWLIST`). Custom RPC overrides must be localhost or on that allowlist (arbitrary `https://` / unlisted `*.drpc.*` hosts are rejected).
