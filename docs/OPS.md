# Operational monitoring

This repo ships a static browser dapp. There is no API process to watch.

- **RPC errors / rate limits** from the Aztec node and L1 providers the page is configured to use
- **Network integrity** — web app tip and address checks; see [NETWORK_INTEGRITY.md](./NETWORK_INTEGRITY.md) and [Aztec Scan](https://aztecscan.xyz/)
- **Claim interruptions** — users recover with `claim-*.json` plus the Aztec account secret (see [education/06-RECOVERY.md](./education/06-RECOVERY.md))
- **Netlify** — HTTPS, CSP, and COOP/COEP headers in `netlify.toml` must stay aligned with `apps/web/src/lib/csp.ts`

SBOM / provenance: export from the lockfile with `pnpm licenses list` or your CI SBOM exporter; keep `pnpm install --frozen-lockfile`. See [PNPM_HARDENING.md](./PNPM_HARDENING.md).
