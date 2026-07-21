import type { Hex } from "viem";

export type BridgeTimingMode = "warp" | "poll";

/** L1 deposit path: `gobridge` matches aztec-kit UI; `portal` uses Aztec.js portal manager only. */
export type L1Backend = "portal" | "gobridge";

export interface NetworkConfig {
  id: string;
  name: string;
  aztecNodeUrl: string;
  l1RpcUrl: string;
  l1ChainId: number;
  bridgeTiming: BridgeTimingMode;
  l1Backend?: L1Backend;
  apiKey?: string;
}

export interface ClaimCredentials {
  claimSecret: string;
  claimSecretHash: string;
  messageHash: string;
  messageLeafIndex: string;
  claimAmount: string;
  recipient: string;
}

export interface BridgeJobResult {
  networkId: string;
  recipient: string;
  l1TxHash?: string;
  claimCredentials: ClaimCredentials;
  l2TxHash?: string;
  aztecAddress?: string;
  l2SecretKey?: string;
}

export interface RuntimeSecrets {
  l1PrivateKey?: Hex;
  aztecApiKey?: string;
}
