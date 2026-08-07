/**
 * Canonical official Aztec / explorer links (allowlist).
 * Double-check against https://docs.aztec.network/networks
 * Explorer UX: https://aztecscan.xyz/ (Alpha) and https://testnet.aztecscan.xyz
 */

export const OFFICIAL_DOCS_NETWORKS = "https://docs.aztec.network/networks";
export const OFFICIAL_DOCS_FEE_JUICE =
  "https://docs.aztec.network/participate/basics/fees#what-is-fee-juice";
export const OFFICIAL_AZTEC_JS = "https://docs.aztec.network/developers/docs/aztec-js";
/** Chainlist Aztec Mainnet RPC directory (community registry). */
export const OFFICIAL_CHAINLIST_AZTEC = "https://chainlist.org/chain/677868";

export const AZTECSCAN_MAINNET = "https://aztecscan.xyz";
export const AZTECSCAN_TESTNET = "https://testnet.aztecscan.xyz";

/** Hosts we treat as official / expected for RPC and explorers. */
export const OFFICIAL_HTTPS_HOST_ALLOWLIST = new Set([
  "docs.aztec.network",
  "aztec.network",
  "aztecscan.xyz",
  "testnet.aztecscan.xyz",
  "devnet.aztecscan.xyz",
  "v5.testnet.rpc.aztec-labs.com",
  "aztec-mainnet.drpc.org",
  "ethereum-rpc.publicnode.com",
  "ethereum-sepolia-rpc.publicnode.com",
  "etherscan.io",
  "sepolia.etherscan.io",
  "df-atlas.onchainreality.xyz",
  "aztec.dfpunk.xyz",
  "chainlist.org",
]);

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

/** Prefer network preset explorer URL when provided. */
export function resolveAztecScanOrigin(
  networkId: string,
  aztecExplorerUrl?: string,
): string {
  if (aztecExplorerUrl) {
    try {
      const u = new URL(aztecExplorerUrl);
      if (u.protocol === "https:") return u.origin;
    } catch {
      /* fall through */
    }
  }
  return aztecScanOrigin(networkId);
}

export function aztecScanBlockUrl(networkId: string, blockNumber: number | bigint): string {
  return `${aztecScanOrigin(networkId)}/blocks/${blockNumber}`;
}

export function aztecScanTxEffectUrl(networkId: string, txHash: string): string {
  const hash = txHash.startsWith("0x") ? txHash : `0x${txHash}`;
  return `${aztecScanOrigin(networkId)}/tx-effects/${hash}`;
}

export function aztecScanAddressUrl(networkId: string, address: string): string {
  return `${aztecScanOrigin(networkId)}/address/${address}`;
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
  testnet: "https://v5.testnet.rpc.aztec-labs.com",
};
