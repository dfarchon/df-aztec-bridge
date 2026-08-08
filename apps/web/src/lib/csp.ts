/**
 * Production CSP connect-src / frame-src allowlists.
 * Keep in sync with netlify.toml [[headers]] Content-Security-Policy.
 *
 * Intentionally NOT `https:` / `wss:` — XSS must not exfiltrate to arbitrary hosts.
 * Custom RPC overrides outside this list will be blocked by the browser.
 */

/** Official + WalletConnect / Reown hosts used by the bridge UI. */
export const CSP_CONNECT_HOSTS = [
  "'self'",
  "data:",
  "blob:",
  "https://docs.aztec.network",
  "https://aztec.network",
  "https://aztecscan.xyz",
  "https://testnet.aztecscan.xyz",
  "https://devnet.aztecscan.xyz",
  "https://v5.testnet.rpc.aztec-labs.com",
  "https://aztec-mainnet.drpc.org",
  "https://lb.drpc.live",
  "https://ethereum-rpc.publicnode.com",
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://etherscan.io",
  "https://sepolia.etherscan.io",
  "https://df-atlas.onchainreality.xyz",
  "https://aztec.dfpunk.xyz",
  "https://chainlist.org",
  "https://rpc.walletconnect.com",
  "https://rpc.walletconnect.org",
  "https://explorer-api.walletconnect.com",
  "https://pulse.walletconnect.org",
  "https://api.web3modal.org",
  "https://api.web3modal.com",
  // WalletConnect / Reown relay + verify hosts are dynamic; keep WC wildcards only.
  "https://*.walletconnect.com",
  "https://*.walletconnect.org",
  "wss://*.walletconnect.com",
  "wss://*.walletconnect.org",
  "https://*.reown.com",
  "wss://*.reown.com",
] as const;

export const CSP_FRAME_HOSTS = [
  "'self'",
  "https://verify.walletconnect.com",
  "https://verify.walletconnect.org",
  "https://secure.walletconnect.com",
  "https://secure.walletconnect.org",
] as const;

const CSP_BASE =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; child-src 'self' blob:; manifest-src 'self'";

/** Netlify / production CSP (no localhost). */
export function buildProductionCsp(): string {
  return `${CSP_BASE}; connect-src ${CSP_CONNECT_HOSTS.join(" ")}; frame-src ${CSP_FRAME_HOSTS.join(" ")}`;
}

/** Vite dev/preview: allow loopback RPC + slightly looser fonts/scripts for HMR. */
export function buildDevCsp(opts: { unsafeInlineScripts?: boolean }): string {
  const script = opts.unsafeInlineScripts
    ? "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'"
    : "script-src 'self' 'wasm-unsafe-eval'";
  const connect = [
    ...CSP_CONNECT_HOSTS,
    "http://127.0.0.1:*",
    "http://localhost:*",
    "ws://127.0.0.1:*",
    "ws://localhost:*",
  ].join(" ");
  return `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ${script}; worker-src 'self' blob:; connect-src ${connect}; frame-src ${CSP_FRAME_HOSTS.join(" ")}; child-src 'self' blob:`;
}
