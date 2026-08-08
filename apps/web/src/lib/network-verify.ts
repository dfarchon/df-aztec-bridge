import type { Hex } from "viem";
import type { WebNetworkConfig } from "../config/networks.ts";
import {
  OFFICIAL_DOCS_NETWORKS,
  OFFICIAL_TIP_CHECK_RPC,
  aztecScanBlockUrl,
  isOfficialHttpsUrl,
} from "./official-links.ts";
import { privacyFetch, privacyWarn } from "./privacy.ts";

/** Must match @aztec/* pins and docs.aztec.network/networks. */
export const SUPPORTED_AZTEC_CLIENT_VERSION = "5.1.0";

export interface NodeInfoSnapshot {
  nodeVersion: string;
  l1ChainId: number;
  rollupVersion?: number | string;
  feeJuice?: string;
  feeJuicePortal?: string;
}

export interface NetworkVerifyResult {
  clientVersion: string;
  node: NodeInfoSnapshot | null;
  primaryBlock: number | null;
  crosscheckBlock: number | null;
  blockDelta: number | null;
  addressMatch: boolean | null;
  versionMatch: boolean | null;
  officialRpcHost: boolean;
  aztecScanLatestBlockUrl: string | null;
  docsNetworksUrl: string;
  errors: string[];
  checkedAt: string;
}

async function jsonRpc<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await privacyFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new Error(`RPC HTTP ${res.status} for ${method}`);
  }
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) {
    throw new Error(body.error.message ?? `RPC error for ${method}`);
  }
  return body.result as T;
}

function normalizeAddr(a: string | undefined | null): string {
  return (a ?? "").toLowerCase();
}

export async function verifyNetworkAgainstOfficial(
  network: WebNetworkConfig,
): Promise<NetworkVerifyResult> {
  const errors: string[] = [];
  const clientVersion = SUPPORTED_AZTEC_CLIENT_VERSION;
  const officialRpcHost = isOfficialHttpsUrl(network.aztecNodeUrl);

  let node: NodeInfoSnapshot | null = null;
  let primaryBlock: number | null = null;
  let crosscheckBlock: number | null = null;
  let addressMatch: boolean | null = null;
  let versionMatch: boolean | null = null;

  try {
    const info = await jsonRpc<{
      nodeVersion: string;
      l1ChainId: number;
      rollupVersion?: number | string;
      l1ContractAddresses?: {
        feeJuiceAddress?: string;
        feeJuicePortalAddress?: string;
      };
    }>(network.aztecNodeUrl, "node_getNodeInfo");

    node = {
      nodeVersion: String(info.nodeVersion ?? "").replace(/^v/, ""),
      l1ChainId: Number(info.l1ChainId),
      rollupVersion: info.rollupVersion,
      feeJuice: info.l1ContractAddresses?.feeJuiceAddress,
      feeJuicePortal: info.l1ContractAddresses?.feeJuicePortalAddress,
    };

    versionMatch = node.nodeVersion === clientVersion;
    if (!versionMatch) {
      errors.push(
        `Client ${clientVersion} ≠ node ${node.nodeVersion}. See ${OFFICIAL_DOCS_NETWORKS}`,
      );
    }
    if (node.l1ChainId !== network.l1ChainId) {
      errors.push(`Node L1 chain ${node.l1ChainId} ≠ config ${network.l1ChainId}`);
    }

    if (node.feeJuice && node.feeJuicePortal) {
      addressMatch =
        normalizeAddr(node.feeJuice) === normalizeAddr(network.l1Addresses.feeJuice) &&
        normalizeAddr(node.feeJuicePortal) === normalizeAddr(network.l1Addresses.feeJuicePortal);
      if (!addressMatch) {
        errors.push("Node Fee Juice / portal addresses do not match baked-in official addresses.");
      }
    }
  } catch (e) {
    privacyWarn("network-verify/nodeInfo", e);
    errors.push(e instanceof Error ? e.message : String(e));
  }

  try {
    primaryBlock = Number(await jsonRpc<number>(network.aztecNodeUrl, "node_getBlockNumber"));
  } catch (e) {
    privacyWarn("network-verify/block", e);
    errors.push(`Primary tip unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }

  const crossRpc = OFFICIAL_TIP_CHECK_RPC[network.id];
  if (crossRpc && crossRpc !== network.aztecNodeUrl) {
    try {
      crosscheckBlock = Number(await jsonRpc<number>(crossRpc, "node_getBlockNumber"));
    } catch (e) {
      privacyWarn("network-verify/crosscheck", e);
      // Soft failure — primary tip still useful.
    }
  } else if (primaryBlock !== null) {
    crosscheckBlock = primaryBlock;
  }

  const blockDelta =
    primaryBlock !== null && crosscheckBlock !== null ? Math.abs(primaryBlock - crosscheckBlock) : null;
  if (blockDelta !== null && blockDelta > 32) {
    errors.push(
      `Block tip skew ${blockDelta} between primary RPC and official cross-check — verify node sync.`,
    );
  }

  const tipForScan = primaryBlock ?? crosscheckBlock;
  return {
    clientVersion,
    node,
    primaryBlock,
    crosscheckBlock,
    blockDelta,
    addressMatch,
    versionMatch,
    officialRpcHost,
    aztecScanLatestBlockUrl:
      tipForScan !== null
        ? aztecScanBlockUrl(network.id, tipForScan, network.aztecExplorerUrl)
        : aztecScanBlockUrl(network.id, 0, network.aztecExplorerUrl),
    docsNetworksUrl: OFFICIAL_DOCS_NETWORKS,
    errors,
    checkedAt: new Date().toISOString(),
  };
}

/** Type re-export helper for fee juice hex checks. */
export type FeeJuiceHex = Hex;
