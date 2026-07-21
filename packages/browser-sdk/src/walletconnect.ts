import type { EIP1193Provider, Hex } from "viem";
import { EthereumProvider } from "@walletconnect/ethereum-provider";
import { connectWithProvider, withTimeout, type ConnectedWallet } from "./wallet.js";

export type WalletConnectUriHandler = (uri: string) => void;

export interface ConnectWalletConnectParams {
  projectId: string;
  /** Primary chain to request (e.g. Sepolia 11155111). */
  chainId: number;
  /** Optional additional chains. */
  optionalChainIds?: number[];
  /** RPC URLs keyed by chain id — improves session reliability. */
  rpcMap?: Record<number, string>;
  /** Called with the WalletConnect URI so the UI can render a QR code. */
  onDisplayUri?: WalletConnectUriHandler;
  metadata?: {
    name: string;
    description: string;
    url: string;
    icons: string[];
  };
}

let activeWcProvider: Awaited<ReturnType<typeof EthereumProvider.init>> | null = null;

/**
 * Opens a WalletConnect v2 session (mobile wallet scans QR).
 * Returns an EIP-1193-compatible ConnectedWallet for L1 bridging.
 */
export async function connectWalletConnect(
  params: ConnectWalletConnectParams,
): Promise<ConnectedWallet> {
  const {
    projectId,
    chainId,
    optionalChainIds = [1, 11155111, 31337],
    rpcMap,
    onDisplayUri,
    metadata = {
      name: "DF Aztec Bridge",
      description: "Fee Juice L1→L2 bridge",
      url: typeof window !== "undefined" ? window.location.origin : "https://localhost",
      icons: [],
    },
  } = params;

  if (!projectId.trim()) {
    throw new Error(
      "Missing WalletConnect projectId. Set VITE_WALLETCONNECT_PROJECT_ID (https://cloud.reown.com).",
    );
  }

  if (activeWcProvider) {
    try {
      await activeWcProvider.disconnect();
    } catch {
      /* ignore */
    }
    activeWcProvider = null;
  }

  const provider = await EthereumProvider.init({
    projectId,
    metadata,
    showQrModal: !onDisplayUri,
    optionalChains: Array.from(new Set([chainId, ...optionalChainIds])) as [number, ...number[]],
    rpcMap: rpcMap
      ? Object.fromEntries(Object.entries(rpcMap).map(([k, v]) => [String(k), v]))
      : undefined,
  });

  if (onDisplayUri) {
    provider.on("display_uri", onDisplayUri);
  }

  await withTimeout(provider.connect(), 180_000, "WalletConnect");
  activeWcProvider = provider;

  // EthereumProvider is EIP-1193 compatible
  const connected = await connectWithProvider(provider as unknown as EIP1193Provider, {
    rdns: "walletconnect",
    name: "WalletConnect",
  });

  // Prefer the requested chain if the session supports it
  if (connected.chainId !== chainId) {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      });
      const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
      return {
        ...connected,
        chainId: Number.parseInt(chainIdHex, 16),
        address: connected.address as Hex,
      };
    } catch {
      return connected;
    }
  }

  return connected;
}

export async function disconnectWalletConnect(): Promise<void> {
  if (!activeWcProvider) return;
  try {
    await activeWcProvider.disconnect();
  } finally {
    activeWcProvider = null;
  }
}
