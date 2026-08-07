# Operational monitoring (P2)

Watch these signals when running the API or any server-held keys (prefer none):

- **API bind address** — must stay on `127.0.0.1` unless `API_ALLOW_NON_LOOPBACK=true` is intentional
- **Job volume / concurrency** — spikes in `DATA_DIR` file count or `API_MAX_CONCURRENT_JOBS` 429s
- **Disk growth** under `DATA_DIR` (jobs expire via `API_JOB_TTL_MS`)
- **RPC errors / rate limits** from Aztec node and L1 providers
- **Failed claim jobs** — unexpected recipient or secret validation failures
- **CORS denials** — unexpected `Origin` headers mean misconfig or probing
- **Rate-limit keys** — hashed client identities only; never log raw `X-Forwarded-For`
- **Network integrity** — web app tips / address checks; see [NETWORK_INTEGRITY.md](./NETWORK_INTEGRITY.md) and [Aztec Scan](https://aztecscan.xyz/)

HTTP `POST /v1/bridge` is disabled. Do not re-enable without auth, spend limits, and secret handling review.

SBOM / provenance: export from the lockfile with `pnpm licenses list` or your CI SBOM exporter; keep `pnpm install --frozen-lockfile`. See [PNPM_HARDENING.md](./PNPM_HARDENING.md).
