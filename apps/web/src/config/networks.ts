import type { Hex } from "viem";
import type { L1Addresses, L1BridgeBackend } from "@df-bridge/browser-sdk";

export interface WebNetworkConfig {
  id: string;
  name: string;
  aztecNodeUrl: string;
  l1RpcUrl: string;
  l1ChainId: number;
  bridgeTiming: "poll" | "warp";
  l1Backend: L1BridgeBackend;
  l1Addresses: L1Addresses;
  /** Block explorer origin, used to link users to the L1 Fee Juice token. */
  l1ExplorerUrl?: string;
  /** Aztec Scan origin for L2 txs / blocks (https://aztecscan.xyz). */
  aztecExplorerUrl?: string;
}

/**
 * Static network presets for the web app (no API required for bridge).
 * L1 Fee Juice / Portal addresses are protocol contracts and rarely change.
 * Override URLs via VITE_*_AZTEC_NODE_URL / VITE_*_L1_RPC_URL at build time if needed.
 */
const NETWORKS_BASE: Record<string, WebNetworkConfig> = {
  testnet: {
    id: "testnet",
    name: "Aztec Testnet (Sepolia)",
    aztecNodeUrl: "https://v5.testnet.rpc.aztec-labs.com",
    l1RpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    l1ChainId: 11155111,
    bridgeTiming: "poll",
    l1Backend: "portal",
    l1ExplorerUrl: "https://sepolia.etherscan.io",
    aztecExplorerUrl: "https://testnet.aztecscan.xyz",
    l1Addresses: {
      l1ChainId: 11155111,
      feeJuicePortal: "0xb4a9f8eadc8ca944729d61e59a9f491faff237a3" as Hex,
      feeJuice: "0x762c132040fda6183066fa3b14d985ee55aa3c18" as Hex,
      feeAssetHandler: "0x5602c39a6e9c5ace589f64f754927bcda4f4bfc9" as Hex,
    },
  },
  mainnet: {
    id: "mainnet",
    name: "Aztec Alpha (Mainnet)",
    // Public endpoint in source. Optional keyed lb.drpc.live URL via VITE_MAINNET_AZTEC_NODE_URL only.
    aztecNodeUrl: "https://aztec-mainnet.drpc.org",
    l1RpcUrl: "https://ethereum-rpc.publicnode.com",
    l1ChainId: 1,
    bridgeTiming: "poll",
    l1Backend: "portal",
    l1ExplorerUrl: "https://etherscan.io",
    aztecExplorerUrl: "https://aztecscan.xyz",
    l1Addresses: {
      l1ChainId: 1,
      feeJuicePortal: "0xaf73dd51d1eb8a079bb097f39c832cdd00ac691c" as Hex,
      feeJuice: "0xa27ec0006e59f245217ff08cd52a7e8b169e62d2" as Hex,
      feeAssetHandler: null,
    },
  },
  local: {
    id: "local",
    name: "Local Network",
    aztecNodeUrl: "http://localhost:8080",
    l1RpcUrl: "http://localhost:8545",
    l1ChainId: 31337,
    bridgeTiming: "warp",
    l1Backend: "portal",
    /** In-app AztecScan-shaped explorer served by Vite (`pnpm dev`). */
    aztecExplorerUrl: "http://localhost:5173",
    // Sandbox L1 addresses vary by version — override if your local deploy differs.
    l1Addresses: {
      l1ChainId: 31337,
      feeJuicePortal: "0x0000000000000000000000000000000000000000" as Hex,
      feeJuice: "0x0000000000000000000000000000000000000000" as Hex,
      feeAssetHandler: null,
    },
  },
};

function envOverride(key: string): string | undefined {
  const v = (import.meta.env as Record<string, string | undefined>)[key]?.trim();
  return v || undefined;
}

/** Apply optional build-time URL overrides from VITE_* env. */
export function getNetwork(id: string): WebNetworkConfig {
  const base = NETWORKS_BASE[id];
  if (!base) throw new Error(`Unknown network "${id}"`);

  const prefix = id.toUpperCase().replace(/-/g, "_");
  return {
    ...base,
    aztecNodeUrl: envOverride(`VITE_${prefix}_AZTEC_NODE_URL`) ?? base.aztecNodeUrl,
    l1RpcUrl: envOverride(`VITE_${prefix}_L1_RPC_URL`) ?? base.l1RpcUrl,
  };
}

export function listNetworkIds(): string[] {
  return Object.keys(NETWORKS_BASE);
}

const L1_CHAIN_LABELS: Record<number, string> = {
  1: "Ethereum",
  11155111: "Sepolia",
  31337: "Local Network",
};

export function l1ChainLabel(chainId: number): string {
  return L1_CHAIN_LABELS[chainId] ?? `chain ${chainId}`;
}

export const DEFAULT_NETWORK_ID = "mainnet";
