/**
 * Canonical official Aztec / explorer links (allowlist).
 * Double-check against https://docs.aztec.network/networks
 * Explorer UX: https://aztecscan.xyz/ (Alpha) and https://testnet.aztecscan.xyz
 */

export const OFFICIAL_DOCS_NETWORKS = "https://docs.aztec.network/networks";
export const OFFICIAL_DOCS_FEE_JUICE =
  "https://docs.aztec.network/participate/basics/fees#what-is-fee-juice";
export const OFFICIAL_AZTEC_JS = "https://docs.aztec.network/developers/docs/aztec-js";

export const AZTECSCAN_MAINNET = "https://aztecscan.xyz";
export const AZTECSCAN_TESTNET = "https://testnet.aztecscan.xyz";

/** Hosts we treat as official / expected for RPC and explorers. */
export const OFFICIAL_HTTPS_HOST_ALLOWLIST = new Set([
  "docs.aztec.network",
  "aztec.network",
  "aztecscan.xyz",
  "testnet.aztecscan.xyz",
  "devnet.aztecscan.xyz",
  "aztec-testnet.drpc.org",
  "aztec-mainnet.drpc.org",
  "ethereum-rpc.publicnode.com",
  "ethereum-sepolia-rpc.publicnode.com",
  "etherscan.io",
  "sepolia.etherscan.io",
  "df-atlas.onchainreality.xyz",
  "aztec.dfpunk.xyz",
]);

/**
 * Public RPC endpoints the UI may select. Hostname alone is not enough:
 * These pinned endpoints do not accept a path, query, or userinfo.
 * The separately validated dRPC Mainnet endpoint is also supported.
 */
export const PINNED_PUBLIC_RPC_URLS = new Set([
  "https://aztec-mainnet.drpc.org",
  "https://aztec-testnet.drpc.org",
  "https://ethereum-rpc.publicnode.com",
  "https://ethereum-sepolia-rpc.publicnode.com",
]);

function rpcUrlParts(url: string): URL | null {
  try {
    const u = new URL(url.trim());
    if (u.username || u.password || u.search || u.hash) return null;
    if (u.pathname !== "/" && u.pathname !== "") return null;
    return u;
  } catch {
    return null;
  }
}

/** Exact public HTTPS RPC (no path key). */
export function isPinnedPublicRpcUrl(url: string): boolean {
  const u = rpcUrlParts(url);
  if (!u || u.protocol !== "https:") return false;
  return PINNED_PUBLIC_RPC_URLS.has(`${u.protocol}//${u.host}`);
}

/** Loopback RPC for `pnpm dev` / local sandbox. No credentials or query string. */
export function isLoopbackRpcUrl(url: string): boolean {
  const u = rpcUrlParts(url);
  if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) return false;
  const host = u.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/** dRPC's keyed Aztec Mainnet endpoint. The path selects the network and account. */
export function isDrpcAztecMainnetUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" && u.host === "lb.drpc.live" &&
      !u.username && !u.password && !u.search && !u.hash &&
      /^\/aztec-mainnet\/[A-Za-z0-9_-]+$/.test(u.pathname);
  } catch {
    return false;
  }
}

/** Build-time and runtime RPC config: pinned public HTTPS, dRPC Mainnet, or loopback. */
export function isSafeConfiguredRpcUrl(url: string): boolean {
  return isPinnedPublicRpcUrl(url) || isDrpcAztecMainnetUrl(url) || isLoopbackRpcUrl(url);
}

export function assertSafeConfiguredRpcUrl(url: string, label: string): void {
  if (!isSafeConfiguredRpcUrl(url)) {
    throw new Error(
      `${label} must be a pinned public RPC, a dRPC Aztec Mainnet URL, or http(s) loopback.`,
    );
  }
}

export function isOfficialHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return OFFICIAL_HTTPS_HOST_ALLOWLIST.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function assertOfficialHttpsUrl(url: string, label: string): void {
  if (!isOfficialHttpsUrl(url)) {
    throw new Error(
      `${label} is not on the official HTTPS allowlist: ${url}. See ${OFFICIAL_DOCS_NETWORKS}`,
    );
  }
}

export function aztecScanOrigin(networkId: string): string {
  if (networkId === "testnet") return AZTECSCAN_TESTNET;
  return AZTECSCAN_MAINNET;
}

/** Loopback HTTP origins for the in-app local explorer (pnpm dev). */
export function isLocalExplorerOrigin(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

/** Prefer network preset explorer URL when provided. */
export function resolveAztecScanOrigin(
  networkId: string,
  aztecExplorerUrl?: string,
): string {
  if (aztecExplorerUrl) {
    try {
      const u = new URL(aztecExplorerUrl);
      if (u.protocol === "https:") return u.origin;
      // Local in-app explorer only (never other http hosts).
      if (isLocalExplorerOrigin(aztecExplorerUrl)) return u.origin;
    } catch {
      /* fall through */
    }
  }
  return aztecScanOrigin(networkId);
}

export function aztecScanBlockUrl(
  networkId: string,
  blockNumber: number | bigint,
  aztecExplorerUrl?: string,
): string {
  return `${resolveAztecScanOrigin(networkId, aztecExplorerUrl)}/blocks/${blockNumber}`;
}

export function aztecScanTxEffectUrl(
  networkId: string,
  txHash: string,
  aztecExplorerUrl?: string,
): string {
  const hash = txHash.startsWith("0x") ? txHash : `0x${txHash}`;
  return `${resolveAztecScanOrigin(networkId, aztecExplorerUrl)}/tx-effects/${hash}`;
}

export function aztecScanAddressUrl(
  networkId: string,
  address: string,
  aztecExplorerUrl?: string,
): string {
  return `${resolveAztecScanOrigin(networkId, aztecExplorerUrl)}/address/${address}`;
}

/** Label for L2 explorer links (public Aztec Scan vs local Vite explorer). */
export function aztecExplorerLinkLabel(aztecExplorerUrl?: string): string {
  if (aztecExplorerUrl && isLocalExplorerOrigin(aztecExplorerUrl)) {
    return "Local explorer";
  }
  return "Aztec Scan";
}

export function l1TxUrl(explorerOrigin: string | undefined, txHash: string): string | null {
  if (!explorerOrigin) return null;
  try {
    const base = explorerOrigin.replace(/\/$/, "");
    const u = new URL(`${base}/tx/${txHash}`);
    if (u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** L1 contract page. HTTPS explorer origins only (etherscan.io / sepolia.etherscan.io). */
export function l1AddressUrl(explorerOrigin: string | undefined, address: string): string | null {
  if (!explorerOrigin || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  try {
    const base = explorerOrigin.replace(/\/$/, "");
    const u = new URL(`${base}/address/${address}`);
    if (u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Human label for L1 explorer toast / analysis links. */
export function l1ExplorerLinkLabel(explorerOrigin: string | undefined): string {
  if (!explorerOrigin) return "L1 explorer";
  try {
    const host = new URL(explorerOrigin).hostname.toLowerCase();
    if (host === "etherscan.io" || host.endsWith(".etherscan.io")) {
      if (host.startsWith("sepolia.")) return "Sepolia Etherscan";
      return "Etherscan";
    }
  } catch {
    /* fall through */
  }
  return "L1 explorer";
}

export function l1TokenUrl(explorerOrigin: string | undefined, token: string): string | null {
  if (!explorerOrigin) return null;
  try {
    const base = explorerOrigin.replace(/\/$/, "");
    return `${base}/token/${token}`;
  } catch {
    return null;
  }
}

/** Secondary official RPC used only for tip double-check (never for secrets). */
export const OFFICIAL_TIP_CHECK_RPC: Record<string, string> = {
  mainnet: "https://aztec-mainnet.drpc.org",
  testnet: "https://aztec-testnet.drpc.org",
};

/**
 * Aztec Mainnet node defaults (public). Optional keyed provider URLs belong in
 * VITE_MAINNET_AZTEC_NODE_URL / Netlify UI — never commit path credentials as source defaults.
 */
export const AZTEC_MAINNET_NODE_PUBLIC = "https://aztec-mainnet.drpc.org";
export const AZTEC_MAINNET_NODE_DEFAULT = AZTEC_MAINNET_NODE_PUBLIC;
